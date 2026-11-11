/**
 * Re-typesetting a translated paragraph into the box the original occupied.
 *
 * The reader never rewrites the PDF: it paints the original page as a bitmap
 * and lays the Chinese text back over each paragraph box. That only looks like
 * the original when the font size, line height and line breaks are chosen from
 * the *source* geometry instead of guessed in CSS — which is what this module
 * does. It is deliberately pure: the caller injects a text measurer, so the
 * algorithm runs in the browser (canvas metrics), in tests (a fake font), and
 * can be reasoned about without a DOM.
 *
 * The search mirrors what layout-preserving PDF translators do (BabelDOC's
 * "adaptive typesetting"): start at the source size, and only shrink when the
 * paragraph really cannot fit the box plus whatever blank space follows it.
 */

import type { BlockKind } from './domain.js'

export interface TypesetRequest {
  text: string
  /** Text column width, px. */
  width: number
  /** Height of the original paragraph box, px. */
  height: number
  /** Font size of the original block, px, already scaled for the display. */
  baseSize: number
  /** Baseline-to-baseline distance of the original paragraph, px. */
  leading?: number
  kind?: BlockKind
  /** Blank space below the box the paragraph may expand into, px. */
  grow?: number
  /** Smallest acceptable font size as a fraction of `baseSize`. */
  minScale?: number
}

export interface TypesetResult {
  fontSize: number
  lineHeight: number
  /** Wrapped lines; used for diagnostics, tests and line counts. */
  lines: string[]
  /** Height the paragraph needs at this size. */
  height: number
  /** `fontSize / baseSize`. */
  scale: number
  /** True when even `minScale` does not fit; the caller may clip or warn. */
  overflow: boolean
}

/** Width of `text` at `size` px. Must be pure and deterministic. */
export type Measure = (text: string, size: number) => number

interface Token {
  text: string
  space: boolean
}

const CJK = /[\u00b7\u2000-\u206f\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/
/** Punctuation that may not open a line (CJK 禁则). */
const NO_LINE_START = /^[，。、；：！？）》」』】〕’”%‰℃…·,.;:!?)\]}]/

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalize(text: string): string {
  return text.replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim()
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let word = ''
  const flush = (): void => {
    if (word !== '') {
      tokens.push({ text: word, space: false })
      word = ''
    }
  }
  for (const char of text) {
    if (/\s/.test(char)) {
      flush()
      tokens.push({ text: ' ', space: true })
      continue
    }
    if (CJK.test(char)) {
      flush()
      tokens.push({ text: char, space: false })
      continue
    }
    word += char
  }
  flush()
  return tokens
}

/**
 * Greedy line breaking with the rule that matters for Chinese: closing
 * punctuation never opens a line. Latin words are kept whole; a word longer
 * than the column is left to overflow (CSS breaks it, and a one-line estimate
 * error is cheaper than mangling every paragraph).
 */
export function wrapTokens(tokens: Token[], widths: number[], width: number): string[] {
  const lines: string[] = []
  let line = ''
  let used = 0
  let pendingSpace = false
  let spaceWidth = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.space) {
      if (line !== '') {
        pendingSpace = true
        spaceWidth = widths[index] || 0
      }
      continue
    }
    const gap = pendingSpace ? spaceWidth : 0
    const candidate = used + gap + widths[index]
    if (line !== '' && candidate > width && !NO_LINE_START.test(token.text)) {
      lines.push(line)
      line = token.text
      used = widths[index]
      pendingSpace = false
      continue
    }
    line += (pendingSpace ? ' ' : '') + token.text
    used = candidate
    pendingSpace = false
  }
  if (line !== '') lines.push(line)
  return lines.filter((value) => value !== '')
}

export function fitText(request: TypesetRequest, measure: Measure): TypesetResult {
  const text = normalize(request.text)
  const base = Math.max(4, request.baseSize)
  const width = Math.max(12, request.width)
  const boxHeight = Math.max(4, request.height)
  const allowed = boxHeight + Math.max(0, request.grow ?? 0)
  const minScale = clamp(request.minScale ?? 0.62, 0.4, 1)

  if (text === '') {
    return {
      fontSize: base,
      lineHeight: base * 1.38,
      lines: [],
      height: 0,
      scale: 1,
      overflow: false,
    }
  }

  const tokens = tokenize(text)
  // Advance widths scale linearly with the font size, so measure once.
  const baseWidths = tokens.map((token) => (token.space ? 0 : measure(token.text, base)))
  const spaceWidth = measure(' ', base)

  const layout = (scale: number): Omit<TypesetResult, 'scale' | 'overflow'> => {
    const size = base * scale
    const natural = request.leading && request.leading > 0
      ? request.leading * scale
      : size * 1.38
    const lineHeight = clamp(natural, size * 1.18, size * 1.62)
    const widths = baseWidths.map((value) => value * scale)
    const scaledSpace = spaceWidth * scale
    const lines = wrapTokens(
      tokens,
      tokens.map((token, index) => (token.space ? scaledSpace : widths[index])),
      width,
    )
    return { fontSize: size, lineHeight, lines, height: lines.length * lineHeight }
  }

  const fitsAt = (scale: number, limit: number): boolean => layout(scale).height <= limit + 0.5

  // Shrink a little before spilling into the gap below: body text is set with
  // one leading of space between paragraphs, so a longer translation that
  // grows instead of shrinking lands on top of the next paragraph.
  const comfortable = 0.78
  let scale: number
  let overflow = false
  if (fitsAt(1, boxHeight)) {
    scale = 1
  } else if (fitsAt(comfortable, boxHeight)) {
    let lo = comfortable
    let hi = 1
    for (let iteration = 0; iteration < 7; iteration += 1) {
      const mid = (lo + hi) / 2
      if (fitsAt(mid, boxHeight)) lo = mid
      else hi = mid
    }
    scale = lo
  } else if (fitsAt(comfortable, allowed)) {
    let lo = minScale
    let hi = comfortable
    for (let iteration = 0; iteration < 7; iteration += 1) {
      const mid = (lo + hi) / 2
      if (fitsAt(mid, allowed)) lo = mid
      else hi = mid
    }
    scale = lo
  } else {
    scale = minScale
    overflow = !fitsAt(minScale, allowed)
  }

  const result = layout(scale)
  // A paragraph that uses fewer lines than the original leaves a hole at the
  // bottom of the box. Loosening the leading a little closes most of it without
  // turning the text into double spacing; the growable part of the box is
  // deliberately not filled, or the last line would sit on the next block.
  if (!overflow && result.lines.length > 1) {
    const target = Math.min(
      result.fontSize * 1.62,
      result.lineHeight * 1.2,
      boxHeight / result.lines.length,
    )
    if (target > result.lineHeight + 0.05) {
      result.lineHeight = target
      result.height = result.lines.length * target
    }
  }

  return { ...result, scale, overflow }
}
