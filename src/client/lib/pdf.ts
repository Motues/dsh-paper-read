/**
 * pdf.js integration: one document per paper, canvas render + positioned text
 * spans, all coordinates in PDF points (multiply by `scale` for CSS pixels).
 */

import * as pdfjs from 'pdfjs-dist'
import { PDF_WORKER_PATH } from '../../shared/constants.js'

export interface TextSpan {
  text: string
  left: number
  top: number
  width: number
  fontSize: number
}

let configured = false
let blobWorkerUrl: string | null = null
let blobWorkerTried = false

export function configurePdfjs(workerUrl = PDF_WORKER_PATH): void {
  if (configured) return
  configured = true
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
}

/**
 * Some hosts serve plugin assets through a wrapper that a `new Worker(url)`
 * cannot use (wrong MIME, extra headers, auth redirect). Re-serve the same file
 * as a blob so the worker still starts without bundling a second copy.
 */
async function ensureBlobWorker(): Promise<boolean> {
  if (blobWorkerUrl) return true
  if (blobWorkerTried) return false
  blobWorkerTried = true
  try {
    const source = pdfjs.GlobalWorkerOptions.workerSrc
    const response = await fetch(source, { credentials: 'same-origin' })
    if (!response.ok) return false
    const text = await response.text()
    blobWorkerUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
    pdfjs.GlobalWorkerOptions.workerSrc = blobWorkerUrl
    return true
  } catch {
    return false
  }
}

/**
 * Last resort: run the parser on the main thread. pdf.js uses the module on
 * `globalThis.pdfjsWorker` when no worker can be created, which is the only
 * reliable option when the page forbids workers entirely. Parsing then blocks
 * the UI for a moment, but reading the paper still works.
 */
let mainThreadReady = false
async function ensureMainThreadWorker(): Promise<boolean> {
  if (mainThreadReady) return true
  try {
    const response = await fetch(pdfjs.GlobalWorkerOptions.workerSrc, { credentials: 'same-origin' })
    if (!response.ok) return false
    const text = await response.text()
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
    const module = await import(/* webpackIgnore: true */ url)
    ;(globalThis as any).pdfjsWorker = module
    mainThreadReady = true
    return true
  } catch {
    return false
  }
}

export async function loadDocument(url: string, signal?: AbortSignal): Promise<any> {
  configurePdfjs()
  const open = () => {
    const task = pdfjs.getDocument({
      url,
      isEvalSupported: false,
      disableAutoFetch: false,
      rangeChunkSize: 262144,
      withCredentials: true,
    })
    if (signal) {
      signal.addEventListener('abort', () => {
        void task.destroy()
      })
    }
    return task.promise
  }
  try {
    return await open()
  } catch (first) {
    // 1) same file served as a blob worker (bypasses asset-wrapper problems)
    if (await ensureBlobWorker()) {
      try {
        return await open()
      } catch {
        /* fall through */
      }
    }
    // 2) no worker at all — parse on the main thread
    if (await ensureMainThreadWorker()) {
      return await open()
    }
    throw first
  }
}

/** textContent items → absolutely positioned spans at the given viewport. */
export function textSpans(textContent: any, viewport: any): TextSpan[] {
  const spans: TextSpan[] = []
  for (const item of textContent.items ?? []) {
    if (typeof item.str !== 'string' || item.str.length === 0) continue
    if (item.str.trim() === '' && spans.length === 0) continue
    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const fontSize = Math.hypot(tx[2], tx[3]) || 9
    spans.push({
      text: item.str,
      left: tx[4],
      top: tx[5] - fontSize,
      width: Math.max(0, (item.width ?? 0) * viewport.scale),
      fontSize,
    })
  }
  return spans
}

/** One canvas cannot host two pdf.js render tasks at once; queue per element. */
const canvasQueues = new WeakMap<HTMLCanvasElement, Promise<unknown>>()
/** Offscreen twin: a page is finished there before it replaces the visible bitmap. */
const scratchCanvases = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()
/** A 200% page at DPR 2.5 can exceed 20 MP; cap the backing store. */
const MAX_CANVAS_PIXELS = 10_000_000

export interface PageRenderOptions {
  /** PDF points → raster pixels. Fold devicePixelRatio into this number. */
  rasterScale: number
  /** CSS size of the page box; defaults to the raster size. */
  cssWidth?: number
  cssHeight?: number
  /**
   * Paint straight onto the canvas. Only for placeholders that are invisible
   * while painting (thumbnails); the reader always wants the swap, which costs
   * one extra bitmap per canvas instead of one per thumbnail.
   */
  direct?: boolean
  signal?: AbortSignal
}

function scratchFor(canvas: HTMLCanvasElement): HTMLCanvasElement {
  let scratch = scratchCanvases.get(canvas)
  if (!scratch) {
    scratch = canvas.ownerDocument.createElement('canvas')
    scratchCanvases.set(canvas, scratch)
  }
  return scratch
}

/**
 * Paint one page and only then swap it into `canvas`. Assigning
 * `canvas.width` clears the bitmap, so drawing straight onto the visible canvas
 * white-flashes on every page turn and zoom step. The scratch copy keeps the
 * previous page on screen until the new one is complete, and the swap itself is
 * one synchronous blit (never a partially painted frame).
 */
export async function renderPage(
  page: any,
  canvas: HTMLCanvasElement,
  options: PageRenderOptions,
): Promise<void> {
  const previous = canvasQueues.get(canvas) ?? Promise.resolve()
  const job = previous.catch(() => undefined).then(() => paint(page, canvas, options))
  canvasQueues.set(canvas, job)
  return job
}

async function paint(
  page: any,
  canvas: HTMLCanvasElement,
  options: PageRenderOptions,
): Promise<void> {
  const { rasterScale, signal } = options
  if (signal?.aborted) return

  const base = page.getViewport({ scale: 1 })
  const wanted = Math.max(1, base.width * base.height * rasterScale * rasterScale)
  const scale = wanted > MAX_CANVAS_PIXELS
    ? rasterScale * Math.sqrt(MAX_CANVAS_PIXELS / wanted)
    : rasterScale
  const viewport = page.getViewport({ scale })
  const width = Math.max(1, Math.floor(viewport.width))
  const height = Math.max(1, Math.floor(viewport.height))

  const scratch = options.direct ? canvas : scratchFor(canvas)
  scratch.width = width
  scratch.height = height
  const context = scratch.getContext('2d')
  if (!context) throw new Error('无法创建画布')
  context.clearRect(0, 0, width, height)

  const task = page.render({ canvasContext: context, viewport })
  const cancel = () => {
    try {
      task.cancel()
    } catch {
      /* the task may already have settled */
    }
  }
  if (signal?.aborted) {
    cancel()
    return
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
  } catch (error) {
    if (signal?.aborted || (error as { name?: string })?.name === 'RenderingCancelledException') return
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  if (signal?.aborted) return

  const target = canvas.getContext('2d')
  if (!target) return
  if (!options.direct) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    target.clearRect(0, 0, width, height)
    target.drawImage(scratch, 0, 0)
  }

  const cssWidth = options.cssWidth ?? width
  const cssHeight = options.cssHeight ?? height
  if (canvas.style.width !== `${cssWidth}px`) canvas.style.width = `${cssWidth}px`
  if (canvas.style.height !== `${cssHeight}px`) canvas.style.height = `${cssHeight}px`
}
