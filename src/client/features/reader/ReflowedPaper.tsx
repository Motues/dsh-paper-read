/**
 * The continuous reflowed translation.
 *
 * Unlike the faithful page (which paints translations over the original PDF
 * bitmap), this view throws the page geometry away and builds one readable
 * column for the whole paper. Figures, tables and display formulas are cropped
 * out of the original page and placed back in the flow, so their internal layout
 * is never reconstructed by hand.
 *
 * The host supplies the plan: reading order per page, skip reasons, visual
 * regions and translations. This component only renders and keeps the scroll
 * position in sync with the reader's page number.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from '../../lib/api.js'
import { cachedPage } from '../../lib/doc-cache.js'
import { renderPage } from '../../lib/pdf.js'
import type {
  Block,
  TranslationDocument,
  TranslationStatus,
  VisualRegion,
} from '../../types.js'

type FlowItem =
  | { type: 'heading'; level: 2 | 3; text: string; page: number }
  | { type: 'para'; text: string; page: number; pending?: boolean; source?: boolean }
  | { type: 'caption'; text: string; page: number; pending?: boolean }
  | { type: 'equation'; page: number; pageWidth: number; bbox: [number, number, number, number] }
  | { type: 'visual'; page: number; pageWidth: number; region: VisualRegion }

interface FlowSection {
  page: number
  items: FlowItem[]
}

interface Flow {
  title: string
  authors: string
  meta: string
  sections: FlowSection[]
  refs: Array<{ page: number; text: string }>
}

interface PageBitmap {
  canvas: HTMLCanvasElement
  scale: number
  width: number
  height: number
}

const bitmapCache = new WeakMap<object, Map<number, Promise<PageBitmap>>>()
const BITMAP_LIMIT = 6

function medianSize(blocks: Block[]): number {
  const sizes = blocks.map((block) => block.size ?? 10).sort((a, b) => a - b)
  return sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 10
}

function blockBottom(block: Block): number {
  return block.bbox[1] + Math.max(0, block.bbox[3])
}

/** Reference lists start with a marker; attention-figure text does not. */
function isReferenceText(text: string): boolean {
  const value = text.trim()
  return /^(?:\[\d{1,3}\]|\d{1,3}\.\s)/.test(value)
    || /10\.\d{4,9}\//.test(value)
    || /\barxiv\b/i.test(value)
}

/**
 * Section headings are numbered in most papers; the number is a more reliable
 * level than the font size, which the extractor only knows approximately.
 */
function sectionDepth(text: string): 2 | 3 | null {
  const numbered = text.trim().match(/^(\d+(?:\.\d+)*)[.)]?\s+\S/)
  if (numbered) return numbered[1].includes('.') ? 3 : 2
  if (/^(abstract|introduction|related work|background|method(?:s|ology)?|approach|experiments?|results?|evaluation|discussion|conclusions?|appendix)\b/i.test(text.trim())) {
    return 2
  }
  return null
}

function overlap(a: number[], b: [number, number, number, number]): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  if (w <= 0 || h <= 0) return 0
  const area = a[2] * a[3]
  return area <= 0 ? 0 : (w * h) / area
}

function findTitle(data: TranslationDocument): { block: Block; text: string } | null {
  const first = data.pages[0]
  // A paper title only lives on page 1 and is set much larger than body text;
  // a "7 Methods" heading at the start of the current page is not the title.
  if (!first || first.page.page !== 1) return null
  const block = [...first.page.blocks]
    .filter((item) => (
      item.kind === 'title'
      && (item.size ?? 0) >= 12
      && !/(arxiv|doi|https?:|©)/i.test(item.text)
    ))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
  if (!block) return null
  return { block, text: first.blocks[block.id] || block.text }
}

function buildFlow(data: TranslationDocument): Flow {
  const titleInfo = findTitle(data)
  const title = titleInfo?.text || data.title
  const authors = data.authors.filter(Boolean).join(', ')
  const meta = [data.venue, data.year].filter(Boolean).join(' · ')

  const sections: FlowSection[] = []
  const refs: Array<{ page: number; text: string }> = []
  const seenRefs = new Set<string>()

  for (const page of data.pages) {
    const items: FlowItem[] = []
    const skipped = page.skipped ?? {}
    const order = page.order && page.order.length > 0
      ? page.order
      : page.page.blocks.map((block) => block.id)
    const byId = new Map(page.page.blocks.map((block) => [block.id, block]))
    const median = medianSize(page.page.blocks)
    const visuals = (page.visuals ?? []).filter((region) => region.kind !== 'equation')
    const groups = new Map<number, VisualRegion[]>()
    for (const region of visuals) {
      let after = -1
      for (let index = 0; index < order.length; index += 1) {
        const block = byId.get(order[index])
        if (!block) continue
        if (blockBottom(block) <= region.bbox[1] + 4) after = index
      }
      const list = groups.get(after) ?? []
      list.push(region)
      groups.set(after, list)
    }

    for (let index = -1; index < order.length; index += 1) {
      for (const region of groups.get(index) ?? []) {
        items.push({ type: 'visual', page: page.page.page, pageWidth: page.page.width, region })
      }
      if (index < 0) continue
      const block = byId.get(order[index])
      if (!block) continue
      const reason = skipped[block.id]
      const translated = page.blocks[block.id]
      if (reason === 'ref') {
        const text = block.text.trim()
        const key = text.replace(/\s+/g, ' ').toLowerCase()
        if (isReferenceText(text) && !seenRefs.has(key) && !/^\d{1,4}$/.test(text)) {
          seenRefs.add(key)
          refs.push({ page: page.page.page, text })
        }
        continue
      }
      if (reason === 'meta' || reason === 'visual') continue
      if (reason === 'equation') {
        if (visuals.some((region) => overlap(block.bbox, region.bbox) >= 0.5)) continue
        items.push({
          type: 'equation',
          page: page.page.page,
          pageWidth: page.page.width,
          bbox: block.bbox,
        })
        continue
      }
      if (titleInfo && page.page.page === data.pages[0]?.page.page && block.id === titleInfo.block.id) continue

      const text = translated ?? block.text
      if (reason === 'cjk') {
        items.push({ type: 'para', text: block.text, page: page.page.page, source: true })
        continue
      }
      const size = block.size ?? median
      const looksHeading = block.kind === 'title'
        || (size >= median * 1.18 && text.length <= 120 && !/[。.;；]$/.test(text.trim()))
      if (looksHeading && text.length <= 180) {
        items.push({
          type: 'heading',
          level: block.kind === 'title' || size >= median * 1.45 ? 2 : sectionDepth(text) ?? 3,
          text,
          page: page.page.page,
        })
        continue
      }
      const pending = !translated
      const item: FlowItem = {
        type: block.kind === 'caption' ? 'caption' : 'para',
        text,
        page: page.page.page,
        ...(pending ? { pending: true } : {}),
      }
      // Extracted PDFs split a paragraph into several blocks more often than
      // they merge two paragraphs. Join the continuation when the previous
      // paragraph has no terminal punctuation — including across a page break,
      // which is where a naive reflow shows a paragraph chopped in half.
      const prior = sections[sections.length - 1]
      const previous = items.length > 0
        ? items[items.length - 1]
        : prior?.items[prior.items.length - 1]
      if (
        previous
        && previous.type === 'para'
        && (previous.page === page.page.page || previous.page === page.page.page - 1)
        && !previous.source
        && Boolean(previous.pending) === Boolean(pending)
        && !/[。！？.!?;；:：]$/.test(previous.text.trim())
        && item.type === 'para'
      ) {
        const separator = /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(item.text) ? ' ' : ''
        previous.text = `${previous.text}${separator}${item.text}`
      } else {
        items.push(item)
      }
    }
    sections.push({ page: page.page.page, items })
  }

  return { title, authors, meta, sections, refs }
}

function pageBitmap(doc: any, pageNumber: number): Promise<PageBitmap> {
  let cache = bitmapCache.get(doc)
  if (!cache) {
    cache = new Map()
    bitmapCache.set(doc, cache)
  }
  const hit = cache.get(pageNumber)
  if (hit) return hit
  const job = (async () => {
    const proxy = await cachedPage(doc, pageNumber)
    const base = proxy.getViewport({ scale: 1 })
    const scale = Math.min(2.4, Math.max(1.6, 1600 / Math.max(1, base.width)))
    const canvas = document.createElement('canvas')
    await renderPage(proxy, canvas, { rasterScale: scale, direct: true })
    return { canvas, scale, width: base.width, height: base.height }
  })()
  cache.set(pageNumber, job)
  while (cache.size > BITMAP_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  void job.catch(() => cache?.delete(pageNumber))
  return job
}

function VisualCrop({
  doc,
  page,
  pageWidth,
  bbox,
  kind,
  equation,
}: {
  doc: any
  page: number
  pageWidth: number
  bbox: [number, number, number, number]
  kind: VisualRegion['kind']
  equation?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<'idle' | 'ready' | 'failed'>('idle')

  useEffect(() => {
    const element = hostRef.current
    if (!element) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '700px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !doc) return undefined
    let cancelled = false
    setState('idle')
    void pageBitmap(doc, page).then((source) => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const pad = equation ? 3 : 5
      const x = Math.max(0, bbox[0] - pad)
      const y = Math.max(0, bbox[1] - pad)
      const right = Math.min(source.width, bbox[0] + bbox[2] + pad)
      const bottom = Math.min(source.height, bbox[1] + bbox[3] + pad)
      const sx = x * source.scale
      const sy = y * source.scale
      const sw = Math.max(1, (right - x) * source.scale)
      const sh = Math.max(1, (bottom - y) * source.scale)
      canvas.width = Math.max(1, Math.round(sw))
      canvas.height = Math.max(1, Math.round(sh))
      const context = canvas.getContext('2d')
      if (!context) {
        setState('failed')
        return
      }
      context.drawImage(source.canvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      setState('ready')
    }).catch(() => {
      if (!cancelled) setState('failed')
    })
    return () => {
      cancelled = true
    }
  }, [visible, doc, page, bbox, equation])

  const width = Math.max(20, Math.min(100, (bbox[2] / Math.max(1, pageWidth)) * 100))
  const label = kind === 'table' ? '表格' : kind === 'figure' ? '图片' : '图表'

  if (!doc) {
    return (
      <div ref={hostRef} className={`pr-reflow-visual-missing${equation ? ' pr-reflow-equation' : ''}`}>
        {label}内容需要 PDF 预览
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className={equation ? 'pr-reflow-equation' : 'pr-reflow-figure'}
      data-state={state}
      style={equation ? { maxWidth: `${width}%` } : { width: `${Math.max(40, width)}%` }}
    >
      <canvas
        ref={canvasRef}
        className="pr-reflow-crop"
        style={equation ? { width: '100%' } : undefined}
      />
      {state !== 'ready' ? <div className="pr-reflow-crop-ghost" aria-hidden /> : null}
    </div>
  )
}

export function ReflowedPaper({
  paperId,
  doc,
  page,
  zoom,
  status,
  version,
  onPageChange,
  onToast,
}: {
  paperId: string
  doc: any
  page: number
  zoom: number
  status: TranslationStatus | null
  version: string
  onPageChange: (page: number) => void
  onToast: (text: string) => void
}) {
  const [data, setData] = useState<TranslationDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const lastReported = useRef(page)
  const lastFetch = useRef(0)

  useEffect(() => {
    let cancelled = false
    // A running translation commits every chunk; refetching the whole paper
    // (which can be megabytes for a long appendix) more than about once a
    // second only makes the reading position jump.
    const wait = data ? Math.max(400, 1200 - (Date.now() - lastFetch.current)) : 0
    const timer = window.setTimeout(() => {
      void api.translationDocument(paperId).then((next) => {
        if (cancelled) return
        lastFetch.current = Date.now()
        setData(next)
        setError(null)
      }).catch((cause) => {
        if (!cancelled) setError((cause as Error).message)
      })
    }, wait)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [paperId, version])

  useEffect(() => {
    if (error) onToast(error)
  }, [error, onToast])

  const flow = useMemo(() => (data ? buildFlow(data) : null), [data])

  const stageOf = (): HTMLElement | null => (
    (rootRef.current?.closest('.pr-stage') as HTMLElement | null) ?? null
  )

  const scrollToPage = (target: number, smooth: boolean): void => {
    const root = rootRef.current
    const stage = stageOf()
    if (!root || !stage) return
    const section = root.querySelector<HTMLElement>(`[data-reflow-page="${target}"]`)
    if (!section) return
    const top = section.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 16
    if (typeof stage.scrollTo === 'function') {
      stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
    } else {
      stage.scrollTop = Math.max(0, top)
    }
  }

  // Initial position: jump to the page the reader was on.
  useLayoutEffect(() => {
    if (!flow || restored.current) return
    restored.current = true
    const frame = requestAnimationFrame(() => scrollToPage(page, false))
    return () => cancelAnimationFrame(frame)
  }, [flow, page])

  // PageRail / page input changed the page: follow it, unless the section is
  // already at the top (that is the scroll observer reporting its own position).
  useEffect(() => {
    if (!flow || !restored.current) return
    const root = rootRef.current
    const stage = stageOf()
    if (!root || !stage) return
    const section = root.querySelector<HTMLElement>(`[data-reflow-page="${page}"]`)
    if (!section) return
    const rect = section.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    // The observer reports the section under the reading position. If it is
    // already on screen, this page change came from scrolling and must not
    // yank the reader back to the section's top.
    if (rect.bottom > stageRect.top + 24 && rect.top < stageRect.bottom - 24) return
    scrollToPage(page, true)
  }, [page, flow])

  // Track the section in view and report it as the current page.
  useEffect(() => {
    const root = rootRef.current
    const stage = stageOf()
    if (!root || !stage || !flow || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (!visible) return
      const number = Number((visible.target as HTMLElement).dataset.reflowPage)
      if (!Number.isFinite(number) || number === lastReported.current) return
      lastReported.current = number
      onPageChange(number)
    }, { root: stage, rootMargin: '-12% 0px -55% 0px', threshold: [0, 0.25, 0.6] })
    for (const section of root.querySelectorAll('[data-reflow-page]')) observer.observe(section)
    return () => observer.disconnect()
  }, [flow, onPageChange])

  const translated = status?.translatedBlocks ?? 0
  const total = status?.totalBlocks ?? 0
  const incomplete = total > 0 && translated < total

  return (
    <div
      className="pr-reflow-root"
      ref={rootRef}
      style={{ '--pr-reflow-scale': Math.min(1.45, Math.max(0.85, zoom)) } as CSSProperties}
    >
      <div className="pr-reflow-sheet">
        {status?.running ? (
          <div className="pr-reflow-progress">
            正在翻译… 已翻译 {translated}/{total || '?'} 段
          </div>
        ) : incomplete ? (
          <div className="pr-reflow-progress" data-warn>
            部分段落尚未翻译，暂以原文显示
          </div>
        ) : null}
        {status?.error ? <div className="pr-reflow-error">{status.error}</div> : null}
        {error && !data ? <div className="pr-reflow-error">{error}</div> : null}

        {flow ? (
          <>
            <header className="pr-reflow-head">
              <h1>{flow.title}</h1>
              {flow.authors ? <p className="pr-reflow-authors">{flow.authors}</p> : null}
              {flow.meta ? <p className="pr-reflow-meta">{flow.meta}</p> : null}
            </header>
            {flow.sections.map((section) => (
              <section
                key={section.page}
                className="pr-reflow-page"
                data-reflow-page={section.page}
              >
                {section.items.length > 0 ? section.items.map((item, index) => (
                  <FlowNode key={`${section.page}-${index}`} item={item} doc={doc} />
                )) : (
                  <p className="pr-reflow-empty">这一页没有可重排的正文。</p>
                )}
                <div className="pr-reflow-page-mark" aria-hidden>{section.page}</div>
              </section>
            ))}
            {flow.refs.length > 0 ? (
              <details className="pr-reflow-refs">
                <summary>参考文献（原文，未翻译）</summary>
                <div>
                  {flow.refs.map((item, index) => (
                    <p key={`${item.page}-${index}`}>{item.text}</p>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <div className="pr-reflow-loading">正在整理译文…</div>
        )}
      </div>
    </div>
  )
}

function FlowNode({ item, doc }: { item: FlowItem; doc: any }) {
  if (item.type === 'heading') {
    return item.level === 2
      ? <h2 className="pr-reflow-h2">{item.text}</h2>
      : <h3 className="pr-reflow-h3">{item.text}</h3>
  }
  if (item.type === 'caption') {
    return (
      <p className="pr-reflow-caption" data-pending={item.pending || undefined}>
        {item.text}
      </p>
    )
  }
  if (item.type === 'para') {
    return (
      <p
        className="pr-reflow-para"
        data-pending={item.pending || undefined}
        data-source={item.source || undefined}
      >
        {item.text}
      </p>
    )
  }
  if (item.type === 'equation') {
    return (
      <VisualCrop
        doc={doc}
        page={item.page}
        pageWidth={item.pageWidth}
        bbox={item.bbox}
        kind="equation"
        equation
      />
    )
  }
  return (
    <VisualCrop
      doc={doc}
      page={item.page}
      pageWidth={item.pageWidth}
      bbox={item.region.bbox}
      kind={item.region.kind}
    />
  )
}
