import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { cachedPage } from '../../lib/doc-cache.js'
import { renderPage } from '../../lib/pdf.js'
import { fitText } from '../../../shared/typeset.js'
import type { Block, TranslationPagePayload } from '../../types.js'
import { measureFor } from './measure.js'
import { ZOOM_SETTLE_MS } from './constants.js'

const DEFAULT_ASPECT = 0.773
const CACHE_LIMIT = 40

interface CacheEntry {
  version: string
  payload: TranslationPagePayload
}

const cache = new Map<string, CacheEntry>()

function cacheKey(paperId: string, page: number): string {
  return `${paperId}#${page}`
}

function remember(key: string, entry: CacheEntry): void {
  cache.set(key, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * One translated page.
 *
 * The PDF page is a bitmap, so the translation is painted on top of that same
 * bitmap: figures, tables, formulas and their rules stay pixel-identical, and
 * only the blocks that actually have a translation get a white mask and the
 * Chinese text. Blocks that were skipped (references, table cells, equations)
 * simply keep showing the original page underneath.
 *
 * The surface is always white paper with near-black ink, even in the dark
 * theme, because it stands in for a printed page rather than app chrome.
 */
export function TranslatedPage({
  paperId,
  pageNumber,
  doc,
  width,
  zoom,
  version,
}: {
  paperId: string
  pageNumber: number
  /** The PDF document, when the reader has one; needed for the page bitmap. */
  doc?: any
  /** CSS width at 100% zoom, matching the original page beside it. */
  width: number
  zoom: number
  /** Changes whenever the host's translation cache changes. */
  version: string
}) {
  const key = cacheKey(paperId, pageNumber)
  const cached = cache.get(key)
  const [payload, setPayload] = useState<TranslationPagePayload | null>(
    cached && cached.version === version ? cached.payload : null,
  )
  const [failed, setFailed] = useState(false)
  const [underlayFailed, setUnderlayFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendered = useRef({ doc: null as any, page: -1, scale: -1, zoom: 1 })

  useEffect(() => {
    const entry = cache.get(key)
    if (entry && entry.version === version) {
      setPayload(entry.payload)
      setFailed(false)
      return undefined
    }
    let cancelled = false
    void api.translationPage(paperId, pageNumber)
      .then((next) => {
        if (cancelled) return
        setPayload(next)
        setFailed(false)
        remember(key, { version, payload: next })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [key, paperId, pageNumber, version])

  const text = payload?.page
  const scale = text && text.width > 0 ? width / text.width : 1
  const height = text && text.width > 0 ? text.height * scale : width / DEFAULT_ASPECT
  const boxWidth = width * zoom
  const boxHeight = height * zoom
  const status = payload?.status ?? 'pending'
  const useUnderlay = Boolean(doc) && !underlayFailed
  const haveBitmap = useUnderlay && Boolean(text)

  useEffect(() => {
    setUnderlayFailed(false)
  }, [doc, pageNumber])

  // Paint the original page underneath, exactly like `PdfPage` does. Zoom uses
  // a CSS transform first; the raster pass waits until the gesture settles.
  useEffect(() => {
    if (!doc || !text || underlayFailed) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const immediate = rendered.current.doc !== doc
      || rendered.current.page !== pageNumber
      || Math.abs(rendered.current.scale - scale) > 0.001
    const settled = Math.abs(rendered.current.zoom - zoom) < 0.001
    if (!immediate && settled) return undefined

    const controller = new AbortController()
    let cancelled = false
    const paint = async () => {
      try {
        const proxy = await cachedPage(doc, pageNumber)
        if (cancelled) return
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5))
        await renderPage(proxy, canvas, {
          rasterScale: scale * zoom * dpr,
          cssWidth: width,
          cssHeight: height,
          signal: controller.signal,
        })
        if (cancelled) return
        rendered.current = { doc, page: pageNumber, scale, zoom }
      } catch {
        if (!cancelled && !controller.signal.aborted) setUnderlayFailed(true)
      }
    }

    if (immediate) {
      void paint()
      return () => {
        cancelled = true
        controller.abort()
      }
    }
    const timer = window.setTimeout(() => {
      void paint()
    }, ZOOM_SETTLE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [doc, pageNumber, text, scale, zoom, width, height, underlayFailed])

  // How far a paragraph may grow into the blank space below it. Two columns
  // share the same y range, so only a block that overlaps horizontally counts
  // as "the paragraph that follows".
  const growRoom = useMemo(() => {
    const room = new Map<string, number>()
    if (!text) return room
    for (const block of text.blocks) {
      const bottom = block.bbox[1] + block.bbox[3]
      let limit = text.height - bottom - 4
      for (const other of text.blocks) {
        if (other === block) continue
        const otherTop = other.bbox[1]
        if (otherTop < bottom - 1) continue
        if (horizontalOverlap(block, other) < 0.25) continue
        limit = Math.min(limit, otherTop - bottom - 2)
      }
      room.set(block.id, Math.max(0, Math.min(limit, block.bbox[3] * 0.75)))
    }
    return room
  }, [text])

  return (
    <div
      className="pr-transpage"
      data-page={pageNumber}
      data-status={status}
      style={{ width: boxWidth, height: boxHeight }}
    >
      {text ? (
        <div
          className="pr-transpage-stage"
          style={{ width, height, transform: `scale(${zoom})` }}
        >
          {useUnderlay ? <canvas ref={canvasRef} className="pr-trans-canvas" /> : null}
          {haveBitmap ? (
            <div className="pr-trans-mask-layer" aria-hidden>
              {text.blocks.map((block) => {
                if (!payload?.blocks[block.id] || payload.skipped?.[block.id]) return null
                return maskRects(block, scale).map((rect, index) => (
                  <span
                    key={`mask-${block.id}-${index}`}
                    className="pr-trans-mask"
                    style={{
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                    }}
                  />
                ))
              })}
            </div>
          ) : null}
          {text.blocks.map((block) => {
            // A block the plan deliberately leaves in the source language must
            // not reuse a translation written by an older version of the app.
            const skipped = Boolean(payload?.skipped?.[block.id])
            const translated = skipped ? undefined : payload?.blocks[block.id]
            if (translated) {
              return (
                <TranslatedBlock
                  key={block.id}
                  block={block}
                  scale={scale}
                  translated={translated}
                  grow={(growRoom.get(block.id) ?? 0) * scale}
                />
              )
            }
            // With the bitmap underneath, an untranslated or skipped block
            // already shows its original text; painting it again would only
            // misalign it.
            if (haveBitmap) return null
            return (
              <TranslatedBlock
                key={block.id}
                block={block}
                scale={scale}
                original={block.text}
              />
            )
          })}
        </div>
      ) : null}
      {status !== 'done' ? (
        <div className="pr-transpage-note">
          {failed
            ? '这一页的译文读取失败'
            : status === 'failed'
              ? '这一页翻译失败，可在工具栏重试'
              : status === 'partial'
                ? '已翻译部分段落，其余保留原文'
                : payload
                  ? '这一页还没有译文'
                  : '正在读取译文…'}
        </div>
      ) : null}
    </div>
  )
}

function blockBox(block: Block, scale: number) {
  return {
    left: block.bbox[0] * scale,
    top: block.bbox[1] * scale,
    width: Math.max(12, block.bbox[2] * scale),
    height: Math.max(4, block.bbox[3] * scale),
  }
}

function horizontalOverlap(a: Block, b: Block): number {
  const left = Math.max(a.bbox[0], b.bbox[0])
  const right = Math.min(a.bbox[0] + a.bbox[2], b.bbox[0] + b.bbox[2])
  const width = Math.min(a.bbox[2], b.bbox[2])
  return width <= 0 ? 0 : Math.max(0, right - left) / width
}

/**
 * White patches over the source glyphs. With v2 geometry each line gets its
 * own patch, so italic overhang and a paragraph's ragged last line are covered
 * without painting over the column gutter or a neighbouring figure.
 */
function maskRects(block: Block, scale: number): Array<{ left: number; top: number; width: number; height: number }> {
  const size = (block.size ?? 9) * scale
  // A line box ends at the baseline, but glyphs (g, y, parentheses, subscripts)
  // descend below it. Without the extra strip the bottoms of the English words
  // stay visible under the Chinese line.
  const below = Math.max(1.5, size * 0.24)
  const lines = block.lines
  if (lines && lines.length > 0) {
    return lines.map((line) => ({
      left: line.box[0] * scale - 1.5,
      top: line.box[1] * scale - 1.5,
      width: line.box[2] * scale + 3,
      height: line.box[3] * scale + below + 1.5,
    }))
  }
  const box = blockBox(block, scale)
  return [{ left: box.left - 2, top: box.top - 2, width: box.width + 4, height: box.height + below + 2 }]
}

/** Chinese glyphs read smaller than Latin at the same point size. */
function fontCompensation(text: string): number {
  let visible = 0
  let cjk = 0
  for (const char of text) {
    if (/\s/.test(char)) continue
    visible += 1
    if (/[\u3400-\u9fff]/.test(char)) cjk += 1
  }
  return visible === 0 ? 1 : 1 + 0.06 * (cjk / visible)
}

function TranslatedBlock({
  block,
  scale,
  translated,
  original,
  grow = 0,
}: {
  block: Block
  scale: number
  translated?: string
  original?: string
  /** Blank space below the box this paragraph may spill into, px. */
  grow?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const value = translated ?? original ?? ''
  const box = blockBox(block, scale)
  const base = Math.max(4.5, (block.size ?? 9) * scale * fontCompensation(value))
  const leading = block.leading ? block.leading * scale : undefined

  // The source geometry picks the font size and leading; the browser's own
  // layout then has the final say, so a one-line estimate error cannot clip a
  // paragraph.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const style = window.getComputedStyle(element)
    const measure = measureFor(style.fontFamily || 'serif', style.fontWeight || '400')
    const fit = fitText({
      text: value,
      width: box.width,
      height: box.height,
      baseSize: base,
      ...(leading ? { leading } : {}),
      grow,
    }, measure)
    let size = fit.fontSize
    let lineHeight = fit.lineHeight
    element.style.fontSize = `${size}px`
    element.style.lineHeight = `${lineHeight}px`
    for (let guard = 0; guard < 4; guard += 1) {
      if (element.scrollHeight <= element.clientHeight + 1) break
      size *= 0.955
      lineHeight *= 0.955
      element.style.fontSize = `${size}px`
      element.style.lineHeight = `${lineHeight}px`
    }
  }, [value, base, box.width, box.height, box.top, grow, leading])

  return (
    <div
      ref={ref}
      className="pr-transblock"
      data-kind={block.kind}
      data-original={original !== undefined || undefined}
      title={original !== undefined ? block.text : undefined}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height + grow,
        fontSize: base,
      }}
    >
      {value}
    </div>
  )
}
