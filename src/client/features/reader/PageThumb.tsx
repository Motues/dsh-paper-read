import { memo, useEffect, useRef, useState } from 'react'
import { renderPage } from '../../lib/pdf.js'

const THUMB_WIDTH = 112
const THUMB_DPR = 1.5

/** Small colour dots on a page thumbnail, one per annotation on that page. */
export function ThumbMarks({ marks }: { marks: string[] }) {
  if (marks.length === 0) return null
  return (
    <span className="pr-thumb-marks" title={`${marks.length} 条批注`} aria-label={`${marks.length} 条批注`}>
      {marks.slice(0, 3).map((color, index) => <i key={`${color}-${index}`} data-c={color} />)}
      {marks.length > 3 ? <b>+{marks.length - 3}</b> : null}
    </span>
  )
}

interface PageThumbProps {
  doc: any
  pageNumber: number
  active: boolean
  marks: string[]
  onSelect: (pageNumber: number) => void
}

/**
 * A lazily rendered PDF page preview for the left rail.
 *
 * Memoised: the reader re-renders on every selection, streamed token and zoom
 * step, and 200 previews reconciling each time is pure churn — only the two
 * thumbnails whose `active` flag flips (or whose marks change) need work.
 */
function PageThumbView({ doc, pageNumber, active, marks, onSelect }: PageThumbProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const [ratio, setRatio] = useState(1 / 1.294)

  useEffect(() => {
    if (active) buttonRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    const element = buttonRef.current
    if (!element) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin: '240px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let cancelled = false
    setReady(false)

    void (async () => {
      const proxy = await doc.getPage(pageNumber)
      if (cancelled) return
      const base = proxy.getViewport({ scale: 1 })
      const aspect = base.width / base.height
      setRatio(aspect)
      await renderPage(proxy, canvas, {
        rasterScale: (THUMB_WIDTH / base.width) * THUMB_DPR,
        cssWidth: THUMB_WIDTH,
        cssHeight: THUMB_WIDTH / aspect,
        direct: true,
      })
      if (cancelled) return
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      setReady(true)
    })().catch(() => {
      /* keep the placeholder if this page cannot be rendered */
    })

    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, visible])

  return (
    <button
      ref={buttonRef}
      type="button"
      className="pr-thumb"
      data-on={active || undefined}
      data-preview="1"
      data-ready={ready ? '1' : undefined}
      style={{ aspectRatio: ratio }}
      onClick={() => onSelect(pageNumber)}
      title={`第 ${pageNumber} 页`}
      aria-label={`第 ${pageNumber} 页`}
      aria-current={active ? 'page' : undefined}
    >
      <canvas ref={canvasRef} className="pr-thumb-canvas" aria-hidden />
      <ThumbMarks marks={marks} />
      <span className="pr-thumb-num">{pageNumber}</span>
    </button>
  )
}

export const PageThumb = memo(PageThumbView, (prev, next) => (
  prev.doc === next.doc
  && prev.pageNumber === next.pageNumber
  && prev.active === next.active
  && prev.onSelect === next.onSelect
  && prev.marks.length === next.marks.length
  && prev.marks.every((mark, index) => mark === next.marks[index])
))
