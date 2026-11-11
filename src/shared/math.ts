/**
 * Inline formula protection for full-text translation.
 *
 * A translated paragraph must keep its math verbatim: an LLM that "helpfully"
 * rewrites `w⊤φ(x) = Wx + b` into prose has destroyed the one part of the
 * sentence a reader checks against the original. Spans that look like a formula
 * or a citation are therefore replaced by `⟦n⟧` placeholders before the text is
 * sent, and put back afterwards. If any placeholder comes back missing or
 * duplicated the translation is rejected, so the block is retried instead of
 * being committed with a corrupted equation.
 *
 * Deliberately conservative: a false positive only makes one phrase stay in the
 * source language, while a false negative silently corrupts math.
 */

import type { GlossaryEntry } from './domain.js'

export interface MathSpan {
  /** Placeholder written into the prompt, e.g. `⟦0⟧`. */
  token: string
  /** Original source text restored into the translation. */
  text: string
}

export interface ProtectedText {
  text: string
  spans: MathSpan[]
}

const PLACEHOLDER = /⟦\s*(\d{1,3})\s*⟧/g
const MATH_GLYPH = /[=∑∫√±×÷·∞∂∇≤≥≈≠≡⊂⊆∈∉∪∩→←↔⇒⇔∼∝∅∀∃⊥⊤∥∠⊙⊗⊕]/
const CITATION = /\[\s*\d{1,3}(?:\s*[,，\-–—]\s*\d{1,3})*\s*\]/g
const DELIMITED = /\$\$[^$]{1,300}\$\$|\$[^$\n]{1,200}\$|\\\([^)]{1,200}\\\)|\\\[[\s\S]{1,300}?\\\]/g
/** A run of non-space characters that carries at least one math glyph. */
const MATH_RUN = /[A-Za-z0-9α-ωΑ-Ω₀-₉⁰-⁹⁺⁻ᵀ⊤φψθλμσ][^\s，。；：！？、,;:!?]{0,79}/g

export function isMathRun(value: string): boolean {
  if (value.length < 3) return false
  if (!MATH_GLYPH.test(value)) return false
  const glyphs = (value.match(new RegExp(MATH_GLYPH.source, 'g')) ?? []).length
  // Two operators, an equals sign or a sub/superscript make a formula; a lone
  // "×" inside a phrase ("2× faster", "3×3 conv") is prose and stays text.
  if (glyphs >= 2) return true
  if (/[=≈≠≤≥]/.test(value) || /[₀-₉⁰-⁹⁺⁻ᵀ⊤]/.test(value)) return true
  return !/[a-z]{3,}/.test(value)
}

export function protectMath(text: string): ProtectedText {
  const spans: MathSpan[] = []
  const ranges: Array<[number, number]> = []

  const collect = (pattern: RegExp, accept?: (value: string) => boolean): void => {
    pattern.lastIndex = 0
    for (;;) {
      const match = pattern.exec(text)
      if (!match) break
      const start = match.index
      const end = start + match[0].length
      if (ranges.some(([from, to]) => start < to && end > from)) continue
      if (accept && !accept(match[0])) continue
      ranges.push([start, end])
    }
  }

  collect(DELIMITED)
  collect(CITATION)
  collect(MATH_RUN, isMathRun)
  ranges.sort((a, b) => a[0] - b[0])

  if (ranges.length === 0) return { text, spans }

  let output = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start < cursor) continue
    output += text.slice(cursor, start)
    const token = `⟦${spans.length}⟧`
    spans.push({ token, text: text.slice(start, end) })
    output += token
    cursor = end
  }
  output += text.slice(cursor)
  return { text: output, spans }
}

/**
 * Put the protected spans back. Returns `null` when the reply dropped,
 * duplicated or invented a placeholder: the caller retries the block rather
 * than accepting a translation whose formulas no longer line up.
 */
export function restoreMath(value: string, spans: MathSpan[]): string | null {
  if (spans.length === 0) {
    PLACEHOLDER.lastIndex = 0
    return PLACEHOLDER.test(value) ? null : value
  }
  PLACEHOLDER.lastIndex = 0
  const seen: number[] = []
  let leftover = false
  for (;;) {
    const match = PLACEHOLDER.exec(value)
    if (!match) break
    const index = Number(match[1])
    if (!Number.isInteger(index) || index < 0 || index >= spans.length) {
      leftover = true
      break
    }
    seen.push(index)
  }
  if (leftover) return null
  if (seen.length !== spans.length) return null
  if (new Set(seen).size !== spans.length) return null
  if (!seen.every((index, position) => index === position)) return null

  let output = ''
  let cursor = 0
  PLACEHOLDER.lastIndex = 0
  for (;;) {
    const match = PLACEHOLDER.exec(value)
    if (!match) break
    output += value.slice(cursor, match.index)
    output += spans[Number(match[1])].text
    cursor = match.index + match[0].length
  }
  output += value.slice(cursor)
  return output
}

/**
 * Split protected text into provider-sized pieces without cutting a
 * placeholder in half. Used by every plain machine translator: the pieces are
 * translated independently and joined again before `restoreMath` validates
 * that every formula came back exactly once.
 */
export function splitProtected(text: string, limit: number): string[] {
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return [text]

  const insidePlaceholder = (index: number): boolean => {
    const open = text.lastIndexOf('⟦', index)
    const close = text.lastIndexOf('⟧', index)
    return open > close
  }
  const sentenceEnd = (index: number): boolean => {
    const previous = text[index - 1]
    if (!/[.!?。！？；;]/.test(previous)) return false
    const next = text[index]
    return next === undefined || /\s/.test(next) || /[\u3400-\u9fff]/.test(next)
  }

  const pieces: string[] = []
  let start = 0
  while (start < text.length) {
    if (text.length - start <= limit) {
      pieces.push(text.slice(start))
      break
    }
    const hardEnd = start + limit
    const floor = start + Math.max(1, Math.floor(limit * 0.4))
    let split = -1
    for (let index = hardEnd; index > floor; index -= 1) {
      if (!insidePlaceholder(index) && sentenceEnd(index)) {
        split = index
        break
      }
    }
    if (split < 0) {
      for (let index = hardEnd; index > floor; index -= 1) {
        if (!insidePlaceholder(index) && /\s/.test(text[index - 1])) {
          split = index
          break
        }
      }
    }
    if (split < 0) {
      split = hardEnd
      while (split > start && insidePlaceholder(split)) split -= 1
      if (split <= start) split = hardEnd
    }
    pieces.push(text.slice(start, split))
    start = split
  }
  return pieces
}

/** `glossary` block appended to the system prompt. Stable across a run. */
export function glossaryPrompt(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return ''
  return [
    '术语表（必须按此译法，大小写与词形变化可调整）：',
    ...entries.slice(0, 60).map((entry) => `${entry.en} -> ${entry.zh}`),
  ].join('\n')
}
