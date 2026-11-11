/**
 * PDF → PageText, using pdf.js in Node (legacy build: no canvas needed for
 * text extraction).
 *
 * Coordinates are PDF points with a top-left origin — the same space the client
 * uses for annotation rectangles, so nothing has to be converted twice.
 *
 * Two-column papers are the norm, so items are assigned to columns before lines
 * are assembled; otherwise a left-column sentence and a right-column sentence
 * that share a baseline would fuse into one nonsense block.
 */

import type { BlockKind, BlockLine, PageText } from '../../shared/domain.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js ships loose types */
type Pdfjs = any
type PdfTextContent = any
type PdfViewport = any
type PdfUtil = any

// Loaded on first use: pdf.js is a 2 MB module and importing it at plugin load
// delays route registration, which shows up as stray 404s during startup.
let pdfjsModule: Promise<Pdfjs> | null = null
export function loadPdfjs(): Promise<Pdfjs> {
  pdfjsModule ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsModule
}

const LINE_TOLERANCE = 3
const HEADING_RATIO = 1.22
const BREAK_SIZE_DELTA = 1.2

/**
 * Version of the geometry written to `pages.json`.
 *
 * v2 keeps per-line boxes, leading, indent and alignment; v3 groups a visual
 * line across inline math (baseline jitter, mixed glyph sizes) instead of
 * splitting it into two blocks. Old pages still open, but a paper whose
 * `parseVersion` is older is re-parsed once on first use.
 */
export const PAGE_VERSION = 4

interface PdfItem {
  text: string
  x: number
  baseline: number
  y: number
  width: number
  height: number
  size: number
  spaceAfter?: boolean
}

interface Line {
  text: string
  x: number
  right: number
  baseline: number
  y: number
  height: number
  size: number
  spaceAfter: boolean
  /** Size of every item merged into this line; the median becomes `size`. */
  sizes: number[]
}

interface RawBlock {
  lines: Line[]
  x: number
  right: number
  top: number
  bottom: number
  size: number
  lastSize: number
}

interface OutBlock {
  id: string
  bbox: [number, number, number, number]
  text: string
  kind: BlockKind
  size: number
  index: number
  leading: number
  indent: number
  align: 'left' | 'center' | 'right'
  lines: BlockLine[]
}

interface Band {
  y: number
  twoCol: boolean
  gutter?: number
}

interface ColumnRegion {
  splitY: number
  gutter: number
}

/** Classify a text block from its shape. */
function classify(text: string, fontSize: number): BlockKind {
  const body = text.trim()
  if (body.length === 0) return 'para'
  if (/^(figure|fig\.|table|tab\.|图|表)\s*\d/i.test(body)) return 'caption'
  if (/^\[\d{1,3}\]/.test(body) && body.length < 400) return 'ref'
  if (fontSize >= 13 && body.length < 220) return 'title'
  if (/^(\d+(\.\d+)+\s|[IVX]+\.\s)/.test(body) && body.length < 180 && fontSize >= 10) return 'title'
  const math = (body.match(/[=+−∑∫≤≥√±×·∞∂]/g) ?? []).length
  if (body.length < 90 && math / body.length > 0.06) return 'equation'
  return 'para'
}

function joinLines(lines: string[]): string {
  let output = ''
  for (const line of lines) {
    const text = line.trim()
    if (text === '') continue
    if (output === '') {
      output = text
      continue
    }
    if (/[A-Za-z]-$/.test(output) && /^[a-z]/.test(text)) {
      output = `${output.slice(0, -1)}${text}`
      continue
    }
    const needsSpace = !/[\u3400-\u9fff]$/.test(output) && !/^[\u3400-\u9fff]/.test(text)
    output += needsSpace ? ` ${text}` : text
  }
  return output.replace(/[ \t]{2,}/g, ' ').trim()
}

function itemsToLines(items: PdfItem[]): Line[] {
  // Sort strictly by baseline: a fuzzy comparator is not transitive, so items
  // that were "close" to each other could come out in an order where a later
  // line sat above an earlier one.
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x)
  const lines: Line[] = []
  for (const item of sorted) {
    const current = lines[lines.length - 1]
    // Inline math routinely shifts a baseline by a point or two and changes the
    // glyph size. A fixed 3pt tolerance tore those lines in half, so the two
    // halves became separate blocks and were translated twice.
    const tolerance = Math.max(LINE_TOLERANCE, Math.min(current?.size ?? item.size, item.size) * 0.55)
    if (current && Math.abs(current.baseline - item.baseline) < tolerance) {
      const gap = item.x - (current.right + 0.5)
      const needsSpace = current.spaceAfter === true || gap > Math.max(current.size, item.size) * 0.28
      current.text += needsSpace ? ` ${item.text}` : item.text
      current.right = Math.max(current.right, item.x + item.width)
      current.x = Math.min(current.x, item.x)
      current.size = Math.max(current.size, item.size)
      current.sizes.push(item.size)
      current.spaceAfter = item.spaceAfter === true
    } else {
      lines.push({
        text: item.text,
        x: item.x,
        right: item.x + item.width,
        baseline: item.baseline,
        y: item.y,
        height: item.height,
        size: item.size,
        spaceAfter: item.spaceAfter === true,
        sizes: [item.size],
      })
    }
  }
  // The line's size is how most of its glyphs are set; a lone superscript must
  // not promote a body line to a heading.
  for (const line of lines) {
    const sortedSizes = [...line.sizes].sort((a, b) => a - b)
    line.size = sortedSizes[Math.floor(sortedSizes.length / 2)] ?? line.size
  }
  return lines
}

function linesToBlocks(lines: Line[], indexStart: number): Array<Omit<OutBlock, 'id'>> {  const sizes = lines.map((line) => line.size).sort((a, b) => a - b)
  const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 10

  const blocks: RawBlock[] = []
  let current: RawBlock | null = null
  for (const line of lines) {
    const isHeading = line.size >= medianSize * HEADING_RATIO && line.text.length < 160
    if (!current) {
      current = { lines: [line], x: line.x, right: line.right, top: line.y, bottom: line.y + line.height, size: line.size, lastSize: line.size }
      continue
    }
    const gap = line.y - current.bottom
    const lineHeight = Math.max(current.lastSize, line.size)
    const columnShift = line.x > current.right + lineHeight * 2 && line.text.length < 70
    const sizeChange = Math.abs(line.size - current.lastSize) > BREAK_SIZE_DELTA
    // Academic prose puts no blank line between paragraphs: the last line of a
    // paragraph stops short of the right edge instead. Without this a whole
    // column becomes one "paragraph", translated as one block and reflowed as
    // one wall of text.
    const previousLine = current.lines[current.lines.length - 1]
    const paragraphBreak = Boolean(previousLine)
      && current.lines.length > 0
      && current.right - previousLine.right > Math.max(6, line.size * 1.2)
    if (gap > Math.max(lineHeight * 1.45, lineHeight + 5) || isHeading || columnShift || sizeChange || paragraphBreak) {
      blocks.push(current)
      current = { lines: [line], x: line.x, right: line.right, top: line.y, bottom: line.y + line.height, size: line.size, lastSize: line.size }
      continue
    }
    current.lines.push(line)
    current.x = Math.min(current.x, line.x)
    current.right = Math.max(current.right, line.right)
    current.bottom = Math.max(current.bottom, line.y + line.height)
    current.size = Math.max(current.size, line.size)
    current.lastSize = line.size
  }
  if (current) blocks.push(current)

  return blocks.map((block, offset) => {
    const text = joinLines(block.lines.map((line) => line.text))
    const first = block.lines[0]
    const boxes: BlockLine[] = block.lines.map((line) => ({
      box: [
        round2(line.x),
        round2(line.y),
        round2(Math.max(1, line.right - line.x)),
        round2(Math.max(1, line.height)),
      ],
      baseline: round2(line.baseline),
    }))
    return {
      index: indexStart + offset,
      text,
      bbox: [
        round2(block.x),
        round2(block.top),
        round2(Math.max(1, block.right - block.x)),
        round2(Math.max(1, block.bottom - block.top)),
      ],
      kind: classify(text, block.size),
      size: round2(block.size),
      leading: leadingOf(block.lines),
      indent: Math.max(0, round2(first.x - block.x)),
      align: alignmentOf(block, block.lines),
      lines: boxes,
    }
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Median baseline-to-baseline distance, which is what CSS line-height means. */
function leadingOf(lines: Line[]): number {
  if (lines.length < 2) return round2(lines[0] ? lines[0].size * 1.2 : 12)
  const sizes = lines.map((line) => line.size).sort((a, b) => a - b)
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 10
  const gaps: number[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index].baseline - lines[index - 1].baseline
    const size = Math.max(lines[index].size, lines[index - 1].size)
    if (gap > size * 0.8 && gap < size * 2.6) gaps.push(gap)
  }
  if (gaps.length === 0) return round2(bodySize * 1.2)
  gaps.sort((a, b) => a - b)
  // Leading below the font size only happens in overlapping figure/table
  // scraps; clamping keeps the translated line height readable.
  return round2(Math.max(gaps[Math.floor(gaps.length / 2)], bodySize * 1.02))
}

/**
 * A paragraph is centred when both margins are ragged and the line centres
 * agree; an indented first line alone must not turn a body paragraph into a
 * centred one.
 */
function alignmentOf(block: RawBlock, lines: Line[]): 'left' | 'center' | 'right' {
  if (lines.length < 2) return 'left'
  const rest = lines.slice(1).filter((line) => line.text.trim().length > 0)
  const sample = rest.length >= 2 ? rest : lines
  const lefts = sample.map((line) => line.x - block.x)
  const rights = sample.map((line) => block.right - line.right)
  const maxLeft = Math.max(...lefts)
  const maxRight = Math.max(...rights)
  const tolerance = Math.max(1.5, block.size * 0.35)
  if (maxLeft > tolerance && maxRight > tolerance) {
    const centers = sample.map((line) => (line.x + line.right) / 2)
    const spread = Math.max(...centers) - Math.min(...centers)
    if (spread <= Math.max(2, block.size * 0.6)) return 'center'
  }
  if (maxLeft > block.size * 6 && maxRight < tolerance) return 'right'
  return 'left'
}

/**
 * Find the y where the page switches from full-width (title/abstract) to two
 * columns, plus the gutter x. Returns null for single-column pages.
 */
function findColumnRegion(items: PdfItem[], width: number, height: number): ColumnRegion | null {
  const bandHeight = 36
  const bands: Band[] = []
  for (let y = 0; y < height; y += bandHeight) {
    const inBand = items.filter((item) => item.baseline > y && item.baseline <= y + bandHeight)
    if (inBand.length < 6) {
      bands.push({ y, twoCol: false })
      continue
    }
    const bins = new Uint8Array(Math.ceil(width))
    for (const item of inBand) {
      if (item.width > width * 0.28) continue
      for (let x = Math.max(0, Math.floor(item.x)); x < Math.min(bins.length, Math.ceil(item.x + item.width)); x += 1) {
        bins[x] += 1
      }
    }
    const from = Math.floor(width * 0.3)
    const to = Math.ceil(width * 0.7)
    let best: [number, number] | null = null
    let runStart = -1
    for (let x = from; x <= to; x += 1) {
      const empty = x === to || bins[x] === 0
      if (empty) {
        if (runStart < 0) runStart = x
      } else if (runStart >= 0) {
        if (x - runStart >= 6 && (!best || x - runStart > best[1] - best[0])) best = [runStart, x]
        runStart = -1
      }
    }
    bands.push({ y, twoCol: Boolean(best), gutter: best ? (best[0] + best[1]) / 2 : undefined })
  }

  let start = -1
  for (let index = 0; index < bands.length - 2; index += 1) {
    if (bands[index].twoCol && bands[index + 1].twoCol && bands[index + 2].twoCol) {
      start = index
      break
    }
  }
  if (start < 0) return null
  const gutterValues = bands
    .slice(start)
    .filter((band) => band.twoCol)
    .map((band) => band.gutter ?? 0)
    .sort((a, b) => a - b)
  if (gutterValues.length === 0) return null
  const gutter = gutterValues[Math.floor(gutterValues.length / 2)]
  let splitY = bands[start].y
  // Do not cut a text line in half.
  for (let guard = 0; guard < 30; guard += 1) {
    const straddles = items.some((item) => item.baseline - item.height < splitY && item.baseline > splitY)
    if (!straddles) break
    splitY -= 2
  }
  return { splitY, gutter }
}

function buildPage(pageNumber: number, textContent: PdfTextContent, viewport: PdfViewport, Util: PdfUtil): OutBlock[] {
  const items: PdfItem[] = []
  for (const item of textContent.items as Array<any>) {
    const raw: string = item.str ?? ''
    // Whitespace items carry word boundaries in many PDFs: remember the gap
    // instead of dropping it, or a title turns into "AdvancesinBiasDrift".
    if (raw.trim() === '') {
      if (items.length > 0) items[items.length - 1].spaceAfter = true
      continue
    }
    const tx = Util.transform(viewport.transform, item.transform)
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 9
    items.push({
      text: raw,
      x: tx[4],
      baseline: tx[5],
      y: tx[5] - fontHeight,
      width: Math.max(0, (item.width ?? 0) * viewport.scale),
      height: fontHeight,
      size: fontHeight,
    })
  }

  const blocks: Array<Omit<OutBlock, 'id'>> = []
  const region = findColumnRegion(items, viewport.width, viewport.height)
  if (!region) {
    blocks.push(...linesToBlocks(itemsToLines(items), blocks.length))
  } else {
    const upper = items.filter((item) => item.baseline <= region.splitY)
    const lower = items.filter((item) => item.baseline > region.splitY)
    const spanning: PdfItem[] = []
    const columns: [PdfItem[], PdfItem[]] = [[], []]
    for (const item of lower) {
      const wide = item.width > viewport.width * 0.55
      if (wide) spanning.push(item)
      else columns[item.x + item.width / 2 < region.gutter ? 0 : 1].push(item)
    }
    blocks.push(...linesToBlocks(itemsToLines(upper), blocks.length))
    blocks.push(...linesToBlocks(itemsToLines(spanning), blocks.length))
    blocks.push(...linesToBlocks(itemsToLines(columns[0]), blocks.length))
    blocks.push(...linesToBlocks(itemsToLines(columns[1]), blocks.length))
  }

  return blocks
    .filter((block) => block.text.length > 0)
    .map((block, index) => ({
      id: `p${pageNumber}b${index}`,
      bbox: block.bbox,
      text: block.text,
      kind: block.kind,
      size: block.size,
      leading: block.leading,
      indent: block.indent,
      align: block.align,
      lines: block.lines,
      index: block.index,
    }))
}

export interface ExtractOptions {
  onPage?: (page: number, total: number) => void
}

export interface ExtractResult {
  pages: PageText[]
  pageCount: number
}

/**
 * Extract every page of a PDF.
 */
export async function extractPages(bytes: Uint8Array | ArrayBuffer, options: ExtractOptions = {}): Promise<ExtractResult> {
  // pdf.js refuses Node Buffers even though they are Uint8Arrays; copy into a
  // plain one so the transferable stays portable.
  const data = bytes instanceof Uint8Array && bytes.constructor === Uint8Array
    ? bytes
    : new Uint8Array(bytes)
  const { getDocument, Util } = await loadPdfjs()
  const loading = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  })
  const doc = await loading.promise
  const pages: PageText[] = []
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const textContent = await page.getTextContent()
      pages.push({
        page: pageNumber,
        width: Math.round(viewport.width * 100) / 100,
        height: Math.round(viewport.height * 100) / 100,
        blocks: buildPage(pageNumber, textContent, viewport, Util).map(({ index: _index, ...block }) => block),
      })
      page.cleanup()
      options.onPage?.(pageNumber, doc.numPages)
    }
  } finally {
    await doc.destroy()
  }
  return { pages, pageCount: doc.numPages }
}

/** Whole-paper plain text, page by page (used for metadata and chunking). */
export function pagesToText(pages: PageText[], { maxChars = Number.POSITIVE_INFINITY } = {}): string {
  const parts: string[] = []
  let length = 0
  for (const page of pages) {
    const body = page.blocks.map((block) => block.text).join('\n')
    if (length + body.length > maxChars) {
      parts.push(body.slice(0, Math.max(0, maxChars - length)))
      break
    }
    parts.push(body)
    length += body.length
  }
  return parts.join('\n\n')
}
