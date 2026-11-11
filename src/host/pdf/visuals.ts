/**
 * Non-text page regions: figures (raster images) and tables (vector rules).
 *
 * The translated page keeps the original PDF bitmap underneath, so the faithful
 * view does not need these rectangles. The continuous reflowed view does: it
 * has to crop a figure or a table out of the page and place it in the text flow,
 * and the translation planner uses the same rectangles to leave table/figure
 * text in its original language.
 *
 * Detection is intentionally heuristic and conservative. A missed region shows
 * the original text; a false region only means a block that could have been
 * translated stays in English. It never corrupts the PDF.
 */

import fs from 'node:fs/promises'
import type { Block, PageText, VisualRegion } from '../../shared/domain.js'
import { loadPdfjs } from './extract.js'

export interface VisualFile {
  version: number
  /** File path + size + mtime; a replaced PDF invalidates the cache. */
  source: string
  pages: Record<string, VisualRegion[]>
}

export const VISUALS_VERSION = 1
const MAX_REGIONS = 24
const MERGE_GAP = 8
const MIN_AREA = 900
const MIN_SIZE = 18

type Matrix = [number, number, number, number, number, number]

interface Rect {
  x: number
  y: number
  w: number
  h: number
  image?: boolean
  horizontal?: boolean
  vertical?: boolean
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

function bboxOf(matrix: Matrix, x0: number, y0: number, x1: number, y1: number): Rect {
  const points = [
    apply(matrix, x0, y0),
    apply(matrix, x1, y0),
    apply(matrix, x0, y1),
    apply(matrix, x1, y1),
  ]
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    x: left,
    y: top,
    w: Math.max(...xs) - left,
    h: Math.max(...ys) - top,
  }
}

function near(a: Rect, b: Rect, gap: number): boolean {
  return a.x - gap <= b.x + b.w
    && b.x - gap <= a.x + a.w
    && a.y - gap <= b.y + b.h
    && b.y - gap <= a.y + a.h
}

function cluster(rects: Rect[]): Rect[][] {
  const count = rects.length
  const parent = Array.from({ length: count }, (_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    while (parent[index] !== index) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      if (near(rects[i], rects[j], MERGE_GAP)) union(i, j)
    }
  }
  const groups = new Map<number, Rect[]>()
  for (let index = 0; index < count; index += 1) {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(rects[index])
    groups.set(root, list)
  }
  return [...groups.values()]
}

function rectOf(group: Rect[]): Rect {
  const x = Math.min(...group.map((rect) => rect.x))
  const y = Math.min(...group.map((rect) => rect.y))
  const right = Math.max(...group.map((rect) => rect.x + rect.w))
  const bottom = Math.max(...group.map((rect) => rect.y + rect.h))
  return {
    x,
    y,
    w: right - x,
    h: bottom - y,
    image: group.some((rect) => rect.image),
    horizontal: group.filter((rect) => rect.horizontal).length >= 2,
    vertical: group.some((rect) => rect.vertical),
  }
}

function captionKind(block: Block): 'figure' | 'table' | null {
  const text = block.text.trim()
  if (/^(table|tab\.|表)\s*\d/i.test(text)) return 'table'
  if (/^(figure|fig\.|图)\s*\d/i.test(text)) return 'figure'
  return null
}

function nearCaption(rect: Rect, blocks: Block[]): Block | null {
  let best: Block | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const block of blocks) {
    if (block.kind !== 'caption' && !captionKind(block)) continue
    const bx = block.bbox[0]
    const by = block.bbox[1]
    const bw = block.bbox[2]
    const bh = block.bbox[3]
    const sameColumn = bx < rect.x + rect.w && bx + bw > rect.x
    if (!sameColumn) continue
    const above = Math.abs(by + bh - rect.y)
    const below = Math.abs(rect.y + rect.h - by)
    const distance = Math.min(above, below)
    if (distance > 90 || distance >= bestDistance) continue
    bestDistance = distance
    best = block
  }
  return best
}

function overlaps(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const area = (a.w * a.h) || 1
  return (w * h) / area
}

async function pageVisuals(
  pdfjs: any,
  page: any,
  text: PageText | undefined,
): Promise<VisualRegion[]> {
  const OPS = pdfjs.OPS
  const viewport = page.getViewport({ scale: 1 })
  const operatorList = await page.getOperatorList()
  const fnArray: number[] = operatorList.fnArray
  const argsArray: any[] = operatorList.argsArray

  const images: Rect[] = []
  const paths: Rect[] = []
  const ctmStack: Matrix[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]

  const combined = (matrix: Matrix): Matrix => multiply(viewport.transform, matrix)
  const pushImage = (): void => {
    const rect = bboxOf(combined(ctm), 0, 0, 1, 1)
    rect.image = true
    images.push(rect)
  }

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index]
    if (fn === OPS.save) {
      ctmStack.push([...ctm] as Matrix)
    } else if (fn === OPS.restore) {
      ctm = ctmStack.pop() ?? ctm
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, args as Matrix)
    } else if (fn === OPS.paintFormXObjectBegin) {
      ctmStack.push([...ctm] as Matrix)
      if (Array.isArray(args?.[0])) ctm = multiply(ctm, args[0] as Matrix)
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = ctmStack.pop() ?? ctm
    } else if (
      fn === OPS.paintImageXObject
      || fn === OPS.paintJpegXObject
      || fn === OPS.paintInlineImageXObject
      || fn === OPS.paintImageMaskXObject
    ) {
      pushImage()
    } else if (fn === OPS.constructPath) {
      const bounds = args?.[2] as number[] | undefined
      if (!Array.isArray(bounds) || bounds.length !== 4) continue
      const [x0, y0, x1, y1] = bounds
      const rect = bboxOf(combined(ctm), x0, y0, x1, y1)
      if (rect.w < 1.2 && rect.h < 1.2) continue
      rect.horizontal = rect.h <= 1.6 && rect.w >= 3
      rect.vertical = rect.w <= 1.6 && rect.h >= 3
      paths.push(rect)
    }
  }

  const pageArea = viewport.width * viewport.height
  const candidates: Rect[] = []
  for (const group of cluster([...images, ...paths])) {
    const rect = rectOf(group)
    if (rect.w < MIN_SIZE || rect.h < MIN_SIZE) continue
    const area = rect.w * rect.h
    if (area < MIN_AREA || area > pageArea * 0.86) continue
    if (rect.h < 4 || rect.w < 4) continue
    const horizontalLines = group.filter((item) => item.horizontal).length
    const verticalLines = group.filter((item) => item.vertical).length
    const table = horizontalLines >= 2 && verticalLines >= 1
    const plausible = rect.image || table || area >= 5000 || horizontalLines >= 3
    if (!plausible) continue
    candidates.push(rect)
  }

  candidates.sort((a, b) => (b.w * b.h) - (a.w * a.h))
  const kept: Rect[] = []
  for (const rect of candidates) {
    if (kept.some((other) => overlaps(other, rect) >= 0.55)) continue
    kept.push(rect)
    if (kept.length >= MAX_REGIONS) break
  }

  const blocks = text?.blocks ?? []
  return kept.map((rect) => {
    const caption = nearCaption(rect, blocks)
    const captionRole = caption ? captionKind(caption) : null
    const kind: VisualRegion['kind'] = captionRole
      ?? (rect.image ? 'figure' : rect.horizontal && rect.vertical ? 'table' : 'drawing')
    return {
      bbox: [
        Math.round(rect.x * 100) / 100,
        Math.round(rect.y * 100) / 100,
        Math.round(rect.w * 100) / 100,
        Math.round(rect.h * 100) / 100,
      ],
      kind,
      ...(caption ? { caption: caption.text.trim().slice(0, 400) } : {}),
    }
  })
}

/** Detect figures and tables on every page of one PDF. */
export async function detectVisuals(
  bytes: Uint8Array,
  pages: PageText[],
): Promise<Record<string, VisualRegion[]>> {
  const pdfjs = await loadPdfjs()
  const data = bytes instanceof Uint8Array && bytes.constructor === Uint8Array
    ? bytes
    : new Uint8Array(bytes)
  const loading = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 })
  const doc = await loading.promise
  const out: Record<string, VisualRegion[]> = {}
  try {
    const total = Math.min(doc.numPages, pages.length)
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      try {
        out[String(pageNumber)] = await pageVisuals(pdfjs, page, pages[pageNumber - 1])
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await doc.destroy()
  }
  return out
}

/** Stable identity for "this exact PDF file", used to invalidate visuals.json. */
export async function visualSource(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath)
    return `${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}`
  } catch {
    return ''
  }
}
