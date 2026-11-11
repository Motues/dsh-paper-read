/** Geometry and text normalization for selections inside the PDF text layer. */

export type SelectionRect = [number, number, number, number]

export interface BubblePlacement {
  left: number
  top: number
  maxHeight: number
}

/**
 * Keep the marginal-note bubble inside the viewport. Large translations grow
 * downward while streaming; without a viewport-aware max height their footer
 * (and the end of the text) ends up below the screen.
 */
export function placeBubble(
  anchor: { right: number; top: number },
  viewport: { w: number; h: number },
  width = 316,
): BubblePlacement {
  const preferred = Math.min(Math.round(viewport.h * 0.46), 460)
  const top = Math.min(
    Math.max(72, anchor.top - 4),
    Math.max(72, viewport.h - preferred - 18),
  )
  const maxHeight = Math.max(96, Math.min(preferred, viewport.h - top - 18))
  return {
    left: Math.min(Math.max(12, anchor.right + 14), Math.max(12, viewport.w - width - 20)),
    top,
    maxHeight,
  }
}

export interface TextSelection {
  quote: string
  rect: DOMRect
  rects: SelectionRect[]
}

interface Piece {
  text: string
  top: number
  left: number
  right: number
  height: number
}

/** A whitespace-only text item: bridges word gaps, never sizes a highlight. */
interface Gap {
  top: number
  left: number
  right: number
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * The PDF text box is the full em square; the visible ink is shorter. The band
 * hugs ascenders at the top and reaches past the baseline at the bottom, so
 * descenders (p, g, y) are covered instead of being sliced off at 0.78 of the
 * line box. Measured on the rendered page, glyph ink spans roughly 0.24–1.20 of
 * the line box, so the band leaves a hairline margin on both sides. Values are
 * fractions of the line box.
 */
const INK_TOP = 0.22
const INK_HEIGHT = 1.02

export function inkRect(rect: number[]): SelectionRect {
  const [x, y, width, height] = rect.map(Number)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return [0, 0, 0, 0]
  }
  return [
    round(x),
    round(y + height * INK_TOP),
    round(width),
    round(height * INK_HEIGHT),
  ]
}

/**
 * PDF text content splits words and spaces into separate items, and line breaks
 * are not present in the DOM. Collapse whitespace, remove the space that often
 * precedes punctuation, and strip zero-width characters.
 */
export function cleanSelectionText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]}])/g, '$1')
    .replace(/([(\[{])\s+/g, '$1')
    .trim()
}

function needsSpace(previous: string, next: string): boolean {
  if (previous === '' || /\s$/.test(previous) || /^\s/.test(next)) return false
  if (/[-/([{]$/.test(previous)) return false
  return true
}

/**
 * Trim the blank margins of a selected fragment. A whitespace-only fragment has
 * no glyphs and therefore no box: the wide space items some PDFs put at the end
 * of a line must never stretch a highlight into the margin.
 */
export function trimWhitespaceBounds(text: string): [number, number] | null {
  const start = text.search(/\S/)
  if (start < 0) return null
  let end = text.length
  while (end > start && /\s/.test(text[end - 1])) end -= 1
  return [start, end]
}

/**
 * Build one merged rectangle per selected line segment. Raw Range rects contain
 * both the text box and a taller line box (and overlap at word boundaries),
 * which is why highlights used to look too tall and striped.
 *
 * Geometry only ever comes from glyphs. Blank text items are kept for the copied
 * text (and to bridge justified word gaps) but never widen a rectangle.
 */
export function readSelection(range: Range, page: HTMLElement, scale: number): TextSelection | null {
  if (range.collapsed) return null

  const bounds = page.getBoundingClientRect()
  const pieces: Piece[] = []
  const gaps: Gap[] = []
  let raw = ''
  let previousTop: number | null = null

  for (const span of Array.from(page.querySelectorAll<HTMLElement>('.pr-textlayer span'))) {
    if (!range.intersectsNode(span)) continue
    const node = span.firstChild
    if (!node || node.nodeType !== Node.TEXT_NODE) continue
    const length = node.textContent?.length ?? 0
    let start = 0
    let end = length
    if (span.contains(range.startContainer)) start = range.startOffset
    if (span.contains(range.endContainer)) end = range.endOffset
    if (end <= start) continue

    const fragment = node.textContent?.slice(start, end) ?? ''
    if (!fragment) continue
    const spanRect = span.getBoundingClientRect()
    const ink = trimWhitespaceBounds(fragment)
    let box: { left: number; right: number } | null = null
    if (ink) {
      const pieceRange = document.createRange()
      try {
        pieceRange.setStart(node, start + ink[0])
        pieceRange.setEnd(node, start + ink[1])
        const pieceRect = pieceRange.getBoundingClientRect()
        if (pieceRect.width >= 0.5 && spanRect.height >= 0.5) {
          box = { left: pieceRect.left, right: pieceRect.right }
        }
      } catch {
        box = null
      }
    } else if (spanRect.width >= 0.5 && spanRect.height >= 0.5) {
      gaps.push({ top: spanRect.top, left: spanRect.left, right: spanRect.right })
    }

    if (previousTop !== null && Math.abs(spanRect.top - previousTop) > 2 && needsSpace(raw, fragment)) {
      raw += ' '
    }
    raw += fragment
    previousTop = spanRect.top
    if (!box) continue
    pieces.push({
      text: fragment,
      top: spanRect.top,
      left: box.left,
      right: box.right,
      height: spanRect.height,
    })
  }

  if (pieces.length === 0) return null
  const quote = cleanSelectionText(raw)
  if (quote.length < 2) return null

  const lines: Piece[][] = []
  for (const piece of pieces) {
    const line = lines.find((group) => (
      Math.abs(group[0].top - piece.top) <= 1.5
      && Math.abs(group[0].height - piece.height) <= 1.5
    ))
    if (line) line.push(piece)
    else lines.push([piece])
  }

  const merged: Array<{ left: number; right: number; top: number; height: number }> = []
  for (const group of lines) {
    group.sort((a, b) => a.left - b.left)
    let current = {
      left: group[0].left,
      right: group[0].right,
      top: group[0].top,
      height: group[0].height,
    }
    for (const piece of group.slice(1)) {
      // PDF text items often leave a visible word gap even though a narrow
      // space item exists. Merge normal word gaps, bridge a justified gap when a
      // blank item really sits between the two words, but keep column gutters apart.
      const bridged = gaps.some((gap) => (
        Math.abs(gap.top - current.top) <= 1.5
        && gap.left <= current.right + 1
        && gap.right >= piece.left - 1
        && gap.right - gap.left <= Math.max(6, piece.height * 6)
      ))
      if (bridged || piece.left <= current.right + Math.max(6, piece.height * 0.65)) {
        current.right = Math.max(current.right, piece.right)
      } else {
        merged.push(current)
        current = { left: piece.left, right: piece.right, top: piece.top, height: piece.height }
      }
    }
    merged.push(current)
  }

  merged.sort((a, b) => a.top - b.top || a.left - b.left)
  const rects: SelectionRect[] = merged
    .map((item) => [
      round((item.left - bounds.left) / scale),
      round((item.top - bounds.top) / scale),
      round((item.right - item.left) / scale),
      round(item.height / scale),
    ] as SelectionRect)
    .filter(([, , width, height]) => width > 0.5 && height > 0.5)

  if (rects.length === 0) return null

  const left = Math.min(...merged.map((item) => item.left))
  const right = Math.max(...merged.map((item) => item.right))
  const top = Math.min(...merged.map((item) => item.top))
  const bottom = Math.max(...merged.map((item) => item.top + item.height))

  return {
    quote,
    rect: new DOMRect(left, top, right - left, bottom - top),
    rects,
  }
}

export interface CompactLayer {
  text: string
  /** Client-space top of the item, used to tell a line break from a word gap. */
  top: number
}

export interface CompactText {
  text: string
  /** Index into the source layers for every character of `text`. */
  layer: number[]
  /** Character offset inside that layer for every character of `text`. */
  offset: number[]
}

const isBlank = (char: string): boolean => /\s/.test(char)
const isZeroWidth = (char: string): boolean => /[\u200B-\u200D\uFEFF\u00AD]/.test(char)

/**
 * Flatten text-layer spans into one comparison string. Whitespace is dropped so
 * a query still matches when the PDF splits words into separate items or omits
 * the spaces entirely. A hyphen that only exists because a word wrapped to the
 * next line is dropped too, mirroring how the extractor joins lines.
 */
export function compactText(layers: CompactLayer[]): CompactText {
  const chars: string[] = []
  const original: string[] = []
  const layer: number[] = []
  const offset: number[] = []
  const top: number[] = []
  for (let index = 0; index < layers.length; index += 1) {
    const source = layers[index].text
    for (let position = 0; position < source.length; position += 1) {
      const char = source[position]
      if (isBlank(char) || isZeroWidth(char)) continue
      chars.push(char.toLowerCase())
      original.push(char)
      layer.push(index)
      offset.push(position)
      top.push(layers[index].top)
    }
  }

  const text: string[] = []
  const keptLayer: number[] = []
  const keptOffset: number[] = []
  for (let index = 0; index < chars.length; index += 1) {
    // Mirror the extractor's joinLines: a word broken as "trans-" / "former"
    // becomes "transformer", but a hyphen before a capitalised next line stays.
    if (
      chars[index] === '-'
      && index > 0
      && /[a-z]/i.test(original[index - 1])
      && index + 1 < chars.length
      && layer[index] !== layer[index + 1]
      && Math.abs(top[index + 1] - top[index]) > 2
      && /^[a-z]$/.test(original[index + 1])
    ) continue
    text.push(chars[index])
    keptLayer.push(layer[index])
    keptOffset.push(offset[index])
  }
  return { text: text.join(''), layer: keptLayer, offset: keptOffset }
}

/** The same flattening for a query: case and whitespace never matter. */
export function compactNeedle(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function rectsForCompactRange(
  spans: HTMLElement[],
  compact: CompactText,
  start: number,
  end: number,
  page: HTMLElement,
  scale: number,
): SelectionRect[] | null {
  const first = spans[compact.layer[start]]
  const last = spans[compact.layer[end - 1]]
  const startNode = first?.firstChild
  const endNode = last?.firstChild
  if (!startNode || !endNode) return null
  const range = document.createRange()
  try {
    range.setStart(startNode, compact.offset[start])
    range.setEnd(endNode, compact.offset[end - 1] + 1)
  } catch {
    return null
  }
  return readSelection(range, page, scale)?.rects ?? null
}

/**
 * Locate one exact match on the mounted page and return its line boxes in PDF
 * points. Several occurrences are disambiguated by the block bbox the host
 * reported (the item that starts the match is the cheap proxy, the exact glyph
 * range is only built for the winner); `null` means the glyphs could not be
 * found and the caller should fall back to flashing the block.
 */
export function locateTextInPage(
  page: HTMLElement,
  needle: string,
  bbox: number[],
  scale: number,
): SelectionRect[] | null {
  const target = compactNeedle(needle)
  if (target.length < 2) return null
  const spans = Array.from(page.querySelectorAll<HTMLElement>('.pr-textlayer span'))
  if (spans.length === 0) return null
  const compact = compactText(spans.map((span) => ({
    text: span.textContent ?? '',
    top: span.getBoundingClientRect().top,
  })))
  if (compact.text.length === 0) return null

  const occurrences: number[] = []
  let from = 0
  for (;;) {
    const index = compact.text.indexOf(target, from)
    if (index < 0) break
    occurrences.push(index)
    from = index + 1
  }
  if (occurrences.length === 0) return null
  if (occurrences.length === 1) {
    return rectsForCompactRange(spans, compact, occurrences[0], occurrences[0] + target.length, page, scale)
  }

  const bounds = page.getBoundingClientRect()
  let best = occurrences[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const index of occurrences) {
    const span = spans[compact.layer[index]]
    if (!span) continue
    const rect = span.getBoundingClientRect()
    const top = (rect.top - bounds.top) / scale
    const left = (rect.left - bounds.left) / scale
    const score = Math.abs(top - Number(bbox[1] ?? 0)) + Math.abs(left - Number(bbox[0] ?? 0)) * 0.25
    if (score < bestScore) {
      bestScore = score
      best = index
    }
  }
  return rectsForCompactRange(spans, compact, best, best + target.length, page, scale)
}

/**
 * Older annotations stored both the text box and the taller line box for every
 * word. Keep the dominant (text) height per line and merge horizontal overlaps.
 */
export function mergeStoredRects(rects: number[][], gap = 2): SelectionRect[] {
  interface Row {
    center: number
    height: number
    rects: SelectionRect[]
  }

  const rows: Row[] = []
  for (const raw of rects) {
    if (!Array.isArray(raw) || raw.length < 4) continue
    const [x, y, width, height] = raw.map(Number)
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue
    const center = y + height / 2
    const row = rows.find((item) => (
      Math.abs(item.center - center) <= Math.max(2, Math.min(item.height, height) * 0.4)
    ))
    if (row) row.rects.push([x, y, width, height])
    else rows.push({ center, height, rects: [[x, y, width, height]] })
  }

  const result: SelectionRect[] = []
  for (const row of rows) {
    const heights = new Map<string, { height: number; count: number }>()
    for (const rect of row.rects) {
      const key = String(Math.round(rect[3] * 2) / 2)
      const current = heights.get(key) ?? { height: rect[3], count: 0 }
      current.count += 1
      heights.set(key, current)
    }
    const dominant = [...heights.values()]
      .sort((a, b) => b.count - a.count || a.height - b.height)[0]
    const kept = row.rects
      .filter((rect) => Math.abs(rect[3] - dominant.height) <= Math.max(0.5, dominant.height * 0.12))
      .sort((a, b) => a[0] - b[0])
    if (kept.length === 0) continue

    let current: SelectionRect = [...kept[0]]
    for (const rect of kept.slice(1)) {
      if (rect[0] <= current[0] + current[2] + gap) {
        const right = Math.max(current[0] + current[2], rect[0] + rect[2])
        current = [
          current[0],
          Math.min(current[1], rect[1]),
          right - current[0],
          Math.max(current[3], rect[3]),
        ]
      } else {
        result.push(current)
        current = [...rect]
      }
    }
    result.push(current)
  }
  return result.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}
