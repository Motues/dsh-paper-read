import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cachedPage, cachedText } from '../../lib/doc-cache.js'
import { renderPage, textSpans, type TextSpan } from '../../lib/pdf.js'
import type { Annotation } from '../../types.js'
import { ZOOM_SETTLE_MS } from './constants.js'
import type { FindMark } from './find.js'
import { inkRect, mergeStoredRects } from './selection.js'

/** A transient passage mark (pending question / asked question), page-local. */
export interface AnchorMark {
  id: string
  rects: number[][]
  kind: 'pending' | 'asked'
}

export interface PageBox {
  page: number
  /** Fit scale: PDF points → CSS pixels at 100% zoom. */
  scale: number
  width: number
  height: number
}

interface PdfPageProps {
  doc: any
  pageNumber: number
  /**
   * CSS width the page should occupy at 100%. `null` before the stage has been
   * measured, which keeps the pre-measurement behaviour at 1:1.
   */
  available: number | null
  zoom: number
  annotations: Annotation[]
  anchors: AnchorMark[]
  focusId: string | null
  /** Transient find-in-paper mark: the block under the current search hit. */
  find?: FindMark | null
  /** Merged selection rectangles in PDF points, for this page only. */
  selection: number[][] | null
  /**
   * A sidebar divider is moving. The page box keeps resizing (the canvas
   * stretches with CSS); glyph measurement and rasterization are postponed
   * until the motion settles so a drag cannot repaint the PDF every frame.
   */
  defer?: boolean
  onBox: (box: PageBox) => void
  onError: (message: string) => void
}

const NO_ANNOTATIONS: Annotation[] = []
const NO_ANCHORS: AnchorMark[] = []
const DEFAULT_ASPECT = 0.773

/**
 * One PDF page: bitmap, transparent glyph layer, selection and annotation
 * overlays. Everything inside the page layer is laid out at 100% geometry and
 * then scaled by `zoom` as a single transform, so a zoom step never re-measures
 * glyphs or highlights (the bitmap re-rasterizes once the gesture settles).
 *
 * The page is self-contained: single, spread and continuous mode all mount this
 * component; the parent only decides its width and which pages are alive.
 */
function PdfPageView({
  doc,
  pageNumber,
  available,
  zoom,
  annotations,
  anchors,
  focusId,
  find = null,
  selection,
  defer = false,
  onBox,
  onError,
}: PdfPageProps) {
  const [proxy, setProxy] = useState<any>(null)
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  const [content, setContent] = useState<any>(null)
  const [spans, setSpans] = useState<TextSpan[]>([])
  const [rendering, setRendering] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const scaleCache = useRef<{ spans: TextSpan[]; ratios: number[] } | null>(null)
  const rendered = useRef({ doc: null as any, page: -1, scale: -1, zoom: 1 })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const errorRef = useRef(onError)
  errorRef.current = onError

  // ── page object + base size + text content ──────────────────────────────
  useEffect(() => {
    let cancelled = false
    setProxy(null)
    setBase(null)
    setContent(null)
    setSpans([])
    setRendering(true)
    void cachedPage(doc, pageNumber).then((next: any) => {
      if (cancelled) return
      const viewport = next.getViewport({ scale: 1 })
      setProxy(next)
      setBase({ w: viewport.width, h: viewport.height })
      void cachedText(doc, pageNumber)
        .then((text) => {
          if (!cancelled) setContent(text)
        })
        .catch(() => {})
    }).catch((error) => {
      if (!cancelled) errorRef.current(String(error?.message ?? error))
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])

  const scale = useMemo(() => {
    if (!base) return 1
    if (available && available > 0) return available / base.w
    return 1
  }, [available, base])

  const geom = useMemo<PageBox | null>(() => (
    base
      ? { page: pageNumber, scale, width: base.w * scale, height: base.h * scale }
      : null
  ), [base, pageNumber, scale])

  // ── glyph spans at the current fit ───────────────────────────────────────
  useEffect(() => {
    // While a pane is moving the text layer keeps its previous geometry: it is
    // transparent, and selection is unavailable during the drag anyway. The
    // final width triggers one fresh measurement below.
    if (defer) return
    if (!proxy || !content || !geom) {
      setSpans([])
      return
    }
    try {
      setSpans(textSpans(content, proxy.getViewport({ scale: geom.scale })))
    } catch {
      setSpans([])
    }
  }, [proxy, content, geom, defer])

  // ── report geometry so the parent can map a selection back to PDF points ─
  useEffect(() => {
    if (geom) onBox(geom)
  }, [geom, onBox])

  // Keep the visible canvas stretched to the current page box even while the
  // bitmap itself is deferred: during a pane drag the page must follow the new
  // width, just softly, instead of leaving an empty strip until the repaint.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !geom) return
    canvas.style.width = `${geom.width}px`
    canvas.style.height = `${geom.height}px`
  }, [geom])

  // ── rasterize, after a zoom gesture has settled ──────────────────────────
  useEffect(() => {
    if (defer) {
      // Abort any in-flight paint without flashing the loading veil; the old
      // bitmap stays visible stretched to the new box until the final pass.
      // If nothing has painted yet, keep the shimmer up instead of showing an
      // empty page while the pane moves.
      if (rendered.current.page >= 0) setRendering(false)
      return undefined
    }
    if (!proxy || !geom) return undefined
    const painted = rendered.current
    const immediate = painted.doc !== doc
      || painted.page !== geom.page
      || Math.abs(painted.scale - geom.scale) > 0.001
    const settled = Math.abs(painted.zoom - zoom) < 0.001
    if (!immediate && settled) return undefined

    const controller = new AbortController()
    let cancelled = false
    const paint = async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (immediate) setRendering(true)
      try {
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5))
        await renderPage(proxy, canvas, {
          rasterScale: geom.scale * zoom * dpr,
          cssWidth: geom.width,
          cssHeight: geom.height,
          signal: controller.signal,
        })
        if (cancelled) return
        rendered.current = { doc, page: geom.page, scale: geom.scale, zoom }
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        errorRef.current(String((error as Error)?.message ?? error))
      } finally {
        if (!cancelled && immediate) setRendering(false)
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
  }, [doc, proxy, geom, zoom, defer])

  // Glyphs are measured once per page/fit; zoom divides the visual width back
  // out of the measurement so the cached ratio survives every zoom step.
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer || spans.length === 0) return
    const nodes = Array.from(layer.children) as HTMLElement[]
    const current = zoomRef.current || 1
    let cache = scaleCache.current
    if (!cache || cache.spans !== spans || cache.ratios.length !== nodes.length) {
      cache = {
        spans,
        ratios: nodes.map((node, index) => {
          const measured = node.getBoundingClientRect().width / current
          const target = spans[index]?.width ?? 0
          return measured > 1 && target > 1 ? Math.min(4, target / measured) : 0
        }),
      }
      scaleCache.current = cache
    }
    nodes.forEach((node, index) => {
      const ratio = cache?.ratios[index] ?? 0
      node.style.transform = ratio > 0 ? `scaleX(${ratio})` : 'none'
    })
  }, [spans])

  // ── overlay geometry (PDF points → CSS pixels at 100%) ───────────────────
  const inkScale = geom?.scale ?? 1

  const textNodes = useMemo(() => spans.map((span, index) => (
    <span
      key={index}
      style={{ left: `${span.left}px`, top: `${span.top}px`, fontSize: `${span.fontSize}px` }}
    >
      {span.text}
    </span>
  )), [spans])

  const annotationNodes = useMemo(() => {
    if (!geom) return null
    return (
      <>
        {annotations.map((annotation) => {
          const rects = mergeStoredRects(annotation.rects).map(inkRect)
          if (rects.length === 0) return null
          const focused = focusId === annotation.id
          const left = Math.min(...rects.map((rect) => rect[0]))
          const top = Math.min(...rects.map((rect) => rect[1]))
          const right = Math.max(...rects.map((rect) => rect[0] + rect[2]))
          const bottom = Math.max(...rects.map((rect) => rect[1] + rect[3]))
          return (
            <span key={annotation.id}>
              {rects.map((rect, index) => (
                <span
                  key={`${annotation.id}-${index}`}
                  className="pr-anno"
                  data-c={annotation.color}
                  style={{
                    left: rect[0] * inkScale,
                    top: rect[1] * inkScale,
                    width: rect[2] * inkScale,
                    height: rect[3] * inkScale,
                  }}
                />
              ))}
              {focused ? (
                <span
                  className="pr-anno-ring"
                  data-anno-ring={annotation.id}
                  style={{
                    left: (left - 2) * inkScale,
                    top: (top - 2) * inkScale,
                    width: (right - left + 4) * inkScale,
                    height: (bottom - top + 4) * inkScale,
                  }}
                />
              ) : null}
            </span>
          )
        })}
        {anchors.map((anchor) => mergeStoredRects(anchor.rects).map(inkRect).map((rect, index) => (
          <span
            key={`${anchor.id}-${index}`}
            className="pr-anno"
            data-anchor={anchor.kind}
            style={{
              left: rect[0] * inkScale,
              top: rect[1] * inkScale,
              width: rect[2] * inkScale,
              height: rect[3] * inkScale,
            }}
          />
        )))}
      </>
    )
  }, [annotations, anchors, focusId, geom, inkScale])

  const selectionNodes = useMemo(() => {
    if (!selection || selection.length === 0) return null
    return selection
      .map((rect) => inkRect(rect))
      .filter((rect) => rect[2] > 0 && rect[3] > 0)
      .map((rect, index) => (
        <span
          key={index}
          className="pr-sel"
          style={{
            left: rect[0] * inkScale,
            top: rect[1] * inkScale,
            width: rect[2] * inkScale,
            height: rect[3] * inkScale,
          }}
        />
      ))
  }, [selection, inkScale])

  // A resolved hit draws one box per matched line (already ink-trimmed); an
  // unresolved one draws nothing yet, and a hit the text layer could not locate
  // falls back to the block bbox the host reported.
  const findRects = useMemo(() => {
    if (!find || find.page !== pageNumber) return null
    if (find.rects === undefined) return []
    const rects = find.rects === null
      ? [find.bbox as number[]]
      : find.rects.map((rect) => inkRect(rect))
    return rects.filter((rect) => rect[2] > 0 && rect[3] > 0)
  }, [find, pageNumber])

  const width = geom ? geom.width : (available && available > 0 ? available : 595)
  const height = geom ? geom.height : width / DEFAULT_ASPECT
  const boxWidth = width * zoom
  const boxHeight = height * zoom

  return (
    <div
      className="pr-pdfpage"
      data-page={pageNumber}
      data-rendering={rendering ? '1' : undefined}
      style={{ width: boxWidth, height: boxHeight }}
    >
      {geom ? (
        <div
          className="pr-pdfpage-stage"
          style={{
            width: geom.width,
            height: geom.height,
            transform: `scale(${zoom})`,
          }}
        >
          <canvas ref={canvasRef} className="pr-pdf-canvas" />
          {spans.length > 0 ? (
            <>
              <div className="pr-textlayer" ref={layerRef}>{textNodes}</div>
              <div className="pr-sel-layer" aria-hidden>{selectionNodes}</div>
              <div className="pr-anno-layer" aria-hidden>{annotationNodes}</div>
            </>
          ) : null}
          {findRects && findRects.length > 0 ? (
            <div className="pr-find-layer" aria-hidden>
              {findRects.map((rect, index) => (
                <span
                  key={`${find?.token ?? 0}-${index}`}
                  className="pr-find"
                  data-find-mark
                  style={{
                    left: rect[0] * inkScale,
                    top: rect[1] * inkScale,
                    width: Math.max(2, rect[2] * inkScale),
                    height: Math.max(2, rect[3] * inkScale),
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {rendering || !geom ? <div className="pr-pdf-loading" /> : null}
    </div>
  )
}

export const PdfPage = memo(PdfPageView)

export { NO_ANCHORS, NO_ANNOTATIONS }
