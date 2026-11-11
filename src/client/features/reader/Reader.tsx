import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { api, askStream, watchJob } from '../../lib/api.js'
import { acquireDocument, releaseDocument } from '../../lib/doc-cache.js'
import { usePaperChat } from '../../lib/chat-store.js'
import {
  type Annotation,
  type ChatModelCatalog,
  type ChatRoute,
  type EdgeView,
  type HighlightColor,
  type Paper,
  type PaperDetail,
  type PaperMetadataPatch,
  type PaperSearchHit,
  type SummaryEdit,
  type TranslationSettings,
} from '../../types.js'
import {
  IconCircle,
  IconCircleCheck,
  IconClose,
  IconCopy,
  IconFile,
  IconImage,
  IconLayoutContinuous,
  IconLayoutSingle,
  IconLayoutSpread,
  IconList,
  IconPanelCollapse,
  IconPanelExpand,
  IconSpark,
  IconTranslate,
  IconUpload,
  RichText,
} from '../../components/ui.js'
import { AIPanel } from './AIPanel.js'
import { PageRail } from './PageRail.js'
import { ReaderSearch } from './ReaderSearch.js'
import type { FindMark } from './find.js'
import { NO_ANCHORS, NO_ANNOTATIONS, PdfPage, type AnchorMark, type PageBox } from './PdfPage.js'
import { TextPage } from './TextPage.js'
import { TranslatedPage } from './TranslatedPage.js'
import { ReflowedPaper } from './ReflowedPaper.js'
import { usePaperTranslation } from './useTranslation.js'
import { translateBrowserText } from '../../lib/browser-translate.js'
import { DEFAULT_TRANSLATION_SETTINGS, translationAllowed, translationSourceLabel } from '../../../shared/translation.js'
import { HIGHLIGHT_COLORS, PAGE_GUTTER, ZOOM_STEPS } from './constants.js'
import { locateTextInPage, placeBubble, readSelection } from './selection.js'
import { pulseLayoutMotion, useLayoutFlag, useLayoutMotion } from '../../lib/pane-size.js'
import type { AiTab, RailMode, ReaderLayout, ReaderTab, TranslationView } from '../workspace/tabs.js'

type Selection = { quote: string; rect: DOMRect; rects: number[][]; page: number }
type LiveSelection = { page: number; rects: number[][] }
type Anchor = AnchorMark & { page: number }
type Bubble = {
  kind: 'explain' | 'translate'
  quote: string
  answer: string
  streaming: boolean
  rect: DOMRect
  page: number
}
type ComposerQuote = { text: string; page: number; prompt: string }
type FocusAnnotation = { id: string; page: number; token: number }

/** Gap between the two pages of a spread, and between stacked pages. */
const SPREAD_GAP = 24

const LAYOUTS: Array<{
  key: ReaderLayout
  label: string
  icon: ComponentType<{ size?: number }>
}> = [
  { key: 'single', label: '单面', icon: IconLayoutSingle },
  { key: 'spread', label: '双面', icon: IconLayoutSpread },
  { key: 'continuous', label: '连续', icon: IconLayoutContinuous },
]

/** The left rail's two views, switched from the toolbar. */
const RAIL_MODES: Array<{
  key: RailMode
  label: string
  icon: ComponentType<{ size?: number }>
}> = [
  { key: 'preview', label: '预览图', icon: IconImage },
  { key: 'title', label: '标题', icon: IconList },
]

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The `.pr-pdfpage` that contains a DOM node (selection, copy, drop). */
function pageElementOf(node: Node | null): HTMLElement | null {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node.parentElement
  return (element?.closest?.('.pr-pdfpage') as HTMLElement | null) ?? null
}

/**
 * A page's place in the continuous stack. Only pages near the viewport mount a
 * real `PdfPage`/`TextPage`; the rest keep their measured height so the scroll
 * position and the page indicator stay stable while scrolling a long paper.
 */
function PageSlot({
  pageNumber,
  estimate,
  children,
}: {
  pageNumber: number
  estimate: number
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const measured = useRef(0)
  const [near, setNear] = useState(false)

  useLayoutEffect(() => {
    // Keep the last real page height so unmounting a distant page (or one with
    // an unusual aspect ratio) does not shift the scroll position.
    if (near && ref.current) measured.current = ref.current.offsetHeight
  })

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      setNear(visible)
    }, { rootMargin: '1000px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="pr-page-slot" data-page-slot={pageNumber} ref={ref}>
      {near
        ? children
        : <div className="pr-page-ghost" style={{ height: measured.current || estimate }} aria-hidden />}
    </div>
  )
}

export function Reader({
  paperId,
  paper,
  initialPage,
  initialScrollTop = 0,
  layout,
  zoom,
  rail,
  aiTab,
  translationView,
  translationEnabled = true,
  translationSettings = DEFAULT_TRANSLATION_SETTINGS,
  aiOpen,
  onAiOpen,
  onLayout,
  onToggleDone,
  onRail,
  onState,
  onOpenPaper,
  onShowRelations,
  onToast,
  searchSignal = 0,
  aiEnabled,
  onAiBlocked,
  onPaperChanged,
}: {
  paperId: string
  paper: Paper | null
  initialPage: number
  initialScrollTop?: number
  layout: ReaderLayout
  zoom: number
  rail: RailMode
  aiTab: AiTab
  translationView: TranslationView
  /** Experimental switch: hide the full-text translation entry when off. */
  translationEnabled?: boolean
  /** Effective translation source (the experimental switch can force `dsh`). */
  translationSettings?: TranslationSettings
  aiOpen: boolean
  onAiOpen: (open: boolean) => void
  onLayout: (layout: ReaderLayout) => void
  onToggleDone: (paper: Paper) => void
  onRail: (mode: RailMode) => void
  onState: (patch: Partial<ReaderTab>) => void
  /** Open another paper in a new tab (relations, related papers). */
  onOpenPaper?: (paperId: string) => void
  /** Leave the reader for the full relation graph, focused on this paper. */
  onShowRelations?: (paperId: string) => void
  onToast: (text: string) => void
  /** Bumped by the shell when the global search shortcut targets this reader. */
  searchSignal?: number
  /** Global AI switch; false blocks every token-consuming action. */
  aiEnabled: boolean
  /** The shell's reminder; `onContinue` is used for mixed actions. */
  onAiBlocked: (action: string, onContinue?: () => void) => void
  /** A metadata or guide edit changed the paper card; refresh the library. */
  onPaperChanged?: () => void
}) {
  const startPage = useRef(Math.max(1, initialPage))
  const startScroll = useRef(Math.max(0, initialScrollTop))

  const [detail, setDetail] = useState<PaperDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [doc, setDoc] = useState<any>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfAttempt, setPdfAttempt] = useState(0)
  const [textMode, setTextMode] = useState(false)
  const [page, setPage] = useState(startPage.current)
  const [pageDraft, setPageDraft] = useState(() => String(startPage.current))
  const [railCollapsed, setRailCollapsed] = useLayoutFlag('railCollapsed')
  const [stageWidth, setStageWidth] = useState(0)
  const [boxes, setBoxes] = useState<Map<number, PageBox>>(() => new Map())
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [anchored, setAnchored] = useState<Anchor[]>([])
  const [sel, setSel] = useState<Selection | null>(null)
  const [liveRects, setLiveRects] = useState<LiveSelection | null>(null)
  const [focusAnnotation, setFocusAnnotation] = useState<FocusAnnotation | null>(null)
  const [findMark, setFindMark] = useState<FindMark | null>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [composerQuote, setComposerQuote] = useState<ComposerQuote | null>(null)
  const [relations, setRelations] = useState<EdgeView[]>([])
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [attachBusy, setAttachBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [models, setModels] = useState<ChatModelCatalog | null>(null)
  const [modelBusy, setModelBusy] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summarySaving, setSummarySaving] = useState(false)
  const [metadataSaving, setMetadataSaving] = useState(false)
  const chat = usePaperChat(paperId)
  const translation = usePaperTranslation(
    paperId,
    translationSettings.source,
    translationSettings.browser.sourceLanguage,
  )
  // A source change in settings can happen while this reader is open; re-read
  // the host status so the menu shows the new engine instead of the old one.
  useEffect(() => {
    void translation.refresh()
  }, [translationSettings.source, translation.refresh])

  // Closing the experiment (or switching away from the browser source) must
  // also stop a browser-owned loop; the host cannot abort page-side work.
  useEffect(() => {
    if (translation.source !== 'browser' || !translation.running) return
    if (translationSettings.source !== 'browser' || !translationAllowed(aiEnabled, translationSettings)) {
      void translation.cancel()
    }
  }, [aiEnabled, translation.cancel, translation.running, translation.source, translationSettings])
  const [translationMenu, setTranslationMenu] = useState(false)
  const translationMenuRef = useRef<HTMLDivElement>(null)
  const setTranslationView = useCallback((view: TranslationView) => {
    onStateRef.current({ translationView: view })
    setTranslationMenu(false)
  }, [])
  const moving = useLayoutMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const attachInput = useRef<HTMLInputElement>(null)
  const attachStop = useRef<(() => void) | null>(null)
  const saveTimer = useRef<number | null>(null)
  const scrollRef = useRef(startScroll.current)
  const motionAnchor = useRef<{ page: number; offset: number } | null>(null)
  const pageRef = useRef(page)
  const boxesRef = useRef(boxes)
  const zoomRef = useRef(zoom)
  const layoutRef = useRef(layout)
  const translationViewRef = useRef<TranslationView>(
    translationEnabled ? translationView : 'off',
  )
  // A disabled experiment must not keep rendering a cached bilingual view; the
  // tab's own translationView is preserved and comes back when re-enabled.
  const effectiveTranslationView: TranslationView = translationEnabled ? translationView : 'off'
  const totalRef = useRef(0)
  const onStateRef = useRef(onState)
  const bubbleAnchor = useRef<string | null>(null)
  const bubbleAbort = useRef<AbortController | null>(null)
  const restored = useRef(false)
  const lastErrorAt = useRef(chat.error?.at ?? 0)

  pageRef.current = page
  boxesRef.current = boxes
  zoomRef.current = zoom
  layoutRef.current = layout
  translationViewRef.current = effectiveTranslationView
  onStateRef.current = onState

  const total = Math.max(0, doc?.numPages ?? detail?.pageCount ?? 0)
  totalRef.current = total

  // ── load the paper ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setDoc(null)
    setTextMode(false)
    setPdfError(null)
    setAnnotations([])
    setAnchored([])
    setFocusAnnotation(null)
    setFindMark(null)
    setBoxes(new Map())
    setSel(null)
    setLiveRects(null)
    setBubble(null)
    setComposerQuote(null)

    api.paper(paperId).then((next) => {
      if (cancelled) return
      setDetail(next)
      setAnnotations(next.annotations)
      // The detail payload already carries annotations; read them once more so
      // a stale/partial detail response can never make saved highlights vanish.
      void api.annotations(paperId).then((result) => {
        if (!cancelled) setAnnotations(result.annotations)
      }).catch(() => {})
      // A reload (attach PDF, retry) must not lose the reader's place; a fresh
      // mount starts from the tab's remembered page.
      const start = Math.max(
        1,
        Math.min(next.pageCount || 1, pageRef.current || startPage.current || 1),
      )
      pageRef.current = start
      setPage(start)
      if (next.status === 'todo') void api.patchPaper(paperId, { status: 'reading' }).catch(() => {})
      if (!next.fileUrl) setTextMode(true)
    }).catch((error) => {
      if (!cancelled) setLoadError((error as Error).message)
    })

    void api.relations(paperId).then((result) => {
      if (!cancelled) setRelations(result.edges)
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [paperId, reloadKey])

  useEffect(() => () => attachStop.current?.(), [])

  // ── cached PDF document ──────────────────────────────────────────────────
  useEffect(() => {
    if (!detail?.fileUrl) return undefined
    let cancelled = false
    const key = `${paperId}|${detail.fileUrl}`
    acquireDocument(key, detail.fileUrl).then((proxy) => {
      if (!cancelled) setDoc(proxy)
    }).catch((error) => {
      if (cancelled) return
      setPdfError(String((error as Error)?.message ?? error))
      setTextMode(true)
    })
    return () => {
      cancelled = true
      releaseDocument()
    }
  }, [detail?.fileUrl, paperId, pdfAttempt])

  // ── stage width ──────────────────────────────────────────────────────────
  useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth
      // A collapsed or hidden stage reports 0; keeping the last real width is
      // what lets the reader survive tab switches and panel toggles.
      if (width > 0) setStageWidth(width)
    })
    observer.observe(element)
    if (element.clientWidth > 0) setStageWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [detail, reloadKey])

  // Resizing a pane re-flows the paper continuously. In the continuous stack
  // that changes every page's height, so remember which page the reader was on
  // (and the offset inside it) and restore that anchor once the motion ends.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (moving) {
      if (!motionAnchor.current && layoutRef.current === 'continuous') {
        const slot = contentRef.current?.querySelector<HTMLElement>(`[data-page-slot="${pageRef.current}"]`)
        if (slot) motionAnchor.current = { page: pageRef.current, offset: stage.scrollTop - slot.offsetTop }
      }
      return
    }
    const anchor = motionAnchor.current
    if (!anchor) return
    motionAnchor.current = null
    if (layoutRef.current !== 'continuous') return
    const slot = contentRef.current?.querySelector<HTMLElement>(`[data-page-slot="${anchor.page}"]`)
    if (slot) stage.scrollTop = Math.max(0, slot.offsetTop + anchor.offset)
  }, [moving])

  // Ctrl/⌘ + wheel zooms the page without letting the browser zoom the UI.
  useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const current = zoomRef.current
      const found = ZOOM_STEPS.findIndex((step) => step >= current - 0.001)
      const index = found < 0 ? ZOOM_STEPS.length - 1 : found
      const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + (event.deltaY < 0 ? 1 : -1)))
      onStateRef.current({ zoom: ZOOM_STEPS[next] })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [detail, textMode])

  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── page navigation ──────────────────────────────────────────────────────
  const gotoPage = useCallback((target: number, smooth = false) => {
    const total = totalRef.current
    const limit = total > 0 ? total : target
    const next = Math.max(1, Math.min(limit, target))
    pageRef.current = next
    setPage(next)
    setSel(null)
    setLiveRects(null)
    window.getSelection()?.removeAllRanges()
    const stage = stageRef.current
    if (!stage) return
    // The reflowed view follows the page prop and scrolls itself.
    if (translationViewRef.current === 'reflow') return
    if (layoutRef.current === 'continuous') {
      const slot = contentRef.current?.querySelector<HTMLElement>(`[data-page-slot="${next}"]`)
      if (slot) {
        stage.scrollTo({ top: Math.max(0, slot.offsetTop - 12), behavior: smooth ? 'smooth' : 'auto' })
      }
    } else {
      stage.scrollTop = 0
      stage.scrollLeft = 0
      scrollRef.current = 0
    }
  }, [])

  // The reflowed view reports the section in view; it must not call `gotoPage`
  // or every scroll would fight the scroll container.
  const noteReflowPage = useCallback((next: number) => {
    if (!Number.isFinite(next) || next === pageRef.current) return
    pageRef.current = next
    setPage(next)
  }, [])

  const stepPage = useCallback((delta: number) => {
    const current = pageRef.current
    if (layoutRef.current === 'spread') {
      const start = current - 1 - ((current - 1) % 2) + 1
      gotoPage(start + delta * 2)
      return
    }
    gotoPage(current + delta)
  }, [gotoPage])

  // A find hit jumps to its page and marks the matched text; the effect below
  // resolves the hit against the page's text layer and centres it.
  const jumpToFind = useCallback((hit: PaperSearchHit) => {
    setFindMark({
      page: hit.page,
      blockId: hit.blockId,
      needle: hit.quote.slice(hit.quoteStart, hit.quoteStart + hit.quoteLength),
      bbox: hit.bbox,
      rects: undefined,
      token: Date.now(),
    })
    gotoPage(hit.page)
  }, [gotoPage])

  const scrollByPage = useCallback((direction: number) => {
    const stage = stageRef.current
    if ((layoutRef.current === 'continuous' || translationViewRef.current === 'reflow') && stage) {
      stage.scrollBy({ top: stage.clientHeight * 0.9 * direction, behavior: 'smooth' })
      return
    }
    stepPage(direction)
  }, [stepPage])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepPage(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepPage(-1)
      } else if (event.key === 'PageDown') {
        event.preventDefault()
        scrollByPage(1)
      } else if (event.key === 'PageUp') {
        event.preventDefault()
        scrollByPage(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scrollByPage, stepPage])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBubble(null)
        setSel(null)
        window.getSelection()?.removeAllRanges()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── scroll: continuous page tracking + remembered offset ─────────────────
  const scrollFrame = useRef(0)
  const onScroll = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    scrollRef.current = stage.scrollTop
    // Reflow reports its own visible page through IntersectionObserver.
    if (translationViewRef.current === 'reflow') return
    if (layoutRef.current !== 'continuous' || scrollFrame.current) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0
      const element = stageRef.current
      const content = contentRef.current
      if (!element || !content) return
      const probe = element.scrollTop + 72
      let current = 1
      for (const node of Array.from(content.children) as HTMLElement[]) {
        const number = Number(node.dataset.pageSlot)
        if (!Number.isFinite(number)) continue
        if (node.offsetTop <= probe) current = number
        else break
      }
      if (current !== pageRef.current) {
        pageRef.current = current
        setPage(current)
      }
    })
  }, [])

  useEffect(() => () => {
    if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current)
  }, [])

  // Restore where this tab was. The first frame after mount has placeholders
  // (the continuous stack needs a tick to lay out), so wait one frame. A tab
  // opened in continuous mode at page N starts at that page even without a
  // remembered scroll offset.
  useEffect(() => {
    if (restored.current || !detail) return undefined
    // The reflowed view restores its own position once the document arrives.
    if (translationViewRef.current === 'reflow') {
      restored.current = true
      return undefined
    }
    const frame = requestAnimationFrame(() => {
      const stage = stageRef.current
      if (!stage) return
      if (startScroll.current > 0) {
        stage.scrollTop = startScroll.current
      } else if (layoutRef.current === 'continuous' && startPage.current > 1) {
        const slot = contentRef.current?.querySelector<HTMLElement>(`[data-page-slot="${startPage.current}"]`)
        if (slot) stage.scrollTop = Math.max(0, slot.offsetTop - 12)
      }
      restored.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [detail, layout])

  // Switching the layout keeps the same page: jump to it in continuous mode,
  // and start the new single/spread view at the top.
  const lastLayout = useRef(layout)
  useEffect(() => {
    if (lastLayout.current === layout) return undefined
    lastLayout.current = layout
    const stage = stageRef.current
    if (!stage) return undefined
    if (layout === 'continuous') {
      const frame = requestAnimationFrame(() => {
        const slot = contentRef.current?.querySelector<HTMLElement>(`[data-page-slot="${pageRef.current}"]`)
        if (slot) stage.scrollTop = Math.max(0, slot.offsetTop - 12)
      })
      return () => cancelAnimationFrame(frame)
    }
    stage.scrollTop = 0
    stage.scrollLeft = 0
    scrollRef.current = 0
    return undefined
  }, [layout])

  // Zoom is a transform per page, but the page boxes themselves grow. In the
  // continuous stack that changes the scroll height, so keep the same relative
  // reading position instead of letting the view jump to another page.
  const lastZoom = useRef(zoom)
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (stage && layoutRef.current === 'continuous') {
      const factor = zoom / (lastZoom.current || 1)
      if (Math.abs(factor - 1) > 0.0001) stage.scrollTop = stage.scrollTop * factor
    }
    lastZoom.current = zoom
  }, [zoom])

  // A page opened from the library (or a relation) while this tab is active.
  // The app's `initialPage` also echoes this reader's own reports back, so a
  // jump only happens when the value was NOT produced here.
  const lastInitialPage = useRef(initialPage)
  const lastReportedPage = useRef(startPage.current)
  useEffect(() => {
    if (initialPage === lastInitialPage.current) return
    lastInitialPage.current = initialPage
    if (initialPage === lastReportedPage.current) return
    if (initialPage !== pageRef.current) gotoPage(initialPage)
  }, [gotoPage, initialPage])

  // ── persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!detail?.pageCount) return undefined
    const totalPages = detail.pageCount
    const progress = Math.round((page / totalPages) * 100)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void api.patchPaper(paperId, {
        progress,
        lastRead: { page, scrollTop: Math.round(scrollRef.current) },
      }).catch(() => {})
    }, 700)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [detail?.pageCount, page, paperId])

  // Flush the final position when the tab unmounts: the debounced write above
  // would otherwise be dropped, and reopening the paper from the library would
  // land a page or two behind.
  const progressRef = useRef({ page: 1, progress: 0 })
  progressRef.current = {
    page,
    progress: detail?.pageCount ? Math.round((page / detail.pageCount) * 100) : 0,
  }
  useEffect(() => () => {
    const { page: finalPage, progress } = progressRef.current
    void api.patchPaper(paperId, {
      progress,
      lastRead: { page: finalPage, scrollTop: Math.round(scrollRef.current) },
    }).catch(() => {})
  }, [paperId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      lastReportedPage.current = pageRef.current
      onStateRef.current({ page: pageRef.current })
    }, 260)
    return () => window.clearTimeout(timer)
  }, [page])

  useEffect(() => () => {
    lastReportedPage.current = pageRef.current
    onStateRef.current({ page: pageRef.current, scrollTop: scrollRef.current })
  }, [])

  // ── selection ────────────────────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    window.setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSel(null)
        return
      }
      const range = selection.getRangeAt(0)
      const pageElement = pageElementOf(range.commonAncestorContainer)
      if (!pageElement) {
        setSel(null)
        setLiveRects(null)
        return
      }
      const number = Number(pageElement.dataset.page)
      const box = boxesRef.current.get(number)
      if (!box) {
        setSel(null)
        return
      }
      const next = readSelection(range, pageElement, box.scale * zoomRef.current)
      if (!next) {
        setSel(null)
        setLiveRects(null)
        return
      }
      setSel({ ...next, page: number })
      setLiveRects(null)
    }, 0)
  }, [])

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setLiveRects(null)
        return
      }
      const range = selection.getRangeAt(0)
      const pageElement = pageElementOf(range.commonAncestorContainer)
      if (!pageElement) {
        setLiveRects(null)
        return
      }
      const number = Number(pageElement.dataset.page)
      const box = boxesRef.current.get(number)
      if (!box) return
      const next = readSelection(range, pageElement, box.scale * zoomRef.current)
      setLiveRects(next ? { page: number, rects: next.rects } : null)
    }
    const onChange = () => {
      if (frame) return
      frame = requestAnimationFrame(update)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const pageElement = pageElementOf(range.commonAncestorContainer)
      if (!pageElement) return
      const number = Number(pageElement.dataset.page)
      const box = boxesRef.current.get(number)
      if (!box) return
      const next = readSelection(range, pageElement, box.scale * zoomRef.current)
      if (!next) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', next.quote)
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])

  const anchor = useCallback((rects: number[][] | null, targetPage: number): string | null => {
    const id = rects ? nextId('anchor') : null
    setAnchored((previous) => {
      const demoted = previous.map((item) => (
        item.kind === 'pending' ? { ...item, kind: 'asked' as const } : item
      ))
      if (!id || !rects) return demoted
      return [...demoted, { id, page: targetPage, rects, kind: 'pending' as const }]
    })
    return id
  }, [])

  const releaseAnchor = useCallback((id: string | null) => {
    if (!id) return
    setAnchored((previous) => previous.filter((item) => item.id !== id))
  }, [])

  useEffect(() => {
    if (bubble || !bubbleAnchor.current) return
    releaseAnchor(bubbleAnchor.current)
    bubbleAnchor.current = null
  }, [bubble, releaseAnchor])

  // ── AI calls ─────────────────────────────────────────────────────────────
  const runBubble = useCallback((kind: 'explain' | 'translate') => {
    if (!sel) return
    const canTranslate = translationAllowed(aiEnabled, translationSettings)
    if (kind === 'explain' ? !aiEnabled : !canTranslate) {
      onAiBlocked(kind === 'translate' ? '翻译选段' : '解释选段')
      return
    }
    const { quote, rect, rects, page: targetPage } = sel
    const anchorId = anchor(rects, targetPage)
    bubbleAnchor.current = anchorId
    window.getSelection()?.removeAllRanges()
    setSel(null)
    setBubble({ kind, quote, answer: '', streaming: true, rect, page: targetPage })
    bubbleAbort.current?.abort()

    // The browser translator is page-only; nothing to stream through the host.
    if (kind === 'translate' && translationSettings.source === 'browser') {
      const controller = new AbortController()
      bubbleAbort.current = controller
      const finish = (answer: string): void => {
        releaseAnchor(anchorId)
        if (bubbleAnchor.current === anchorId) bubbleAnchor.current = null
        setBubble((current) => (
          current && current.quote === quote
            ? { ...current, answer, streaming: false }
            : current
        ))
      }
      void translateBrowserText(quote, {
        sourceLanguage: translationSettings.browser.sourceLanguage,
        signal: controller.signal,
      })
        .then((text) => {
          if (!controller.signal.aborted) finish(text)
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          const message = (error as Error)?.message ?? String(error)
          onToast(message)
          finish(message)
        })
      return
    }

    void askStream(
      { paperId, kind, quote, page: targetPage },
      {
        onDelta: (text) => setBubble((current) => (current ? { ...current, answer: current.answer + text } : current)),
        onDone: () => {
          releaseAnchor(anchorId)
          if (bubbleAnchor.current === anchorId) bubbleAnchor.current = null
          setBubble((current) => (current ? { ...current, streaming: false } : current))
        },
        onError: (message) => {
          releaseAnchor(anchorId)
          if (bubbleAnchor.current === anchorId) bubbleAnchor.current = null
          onToast(message)
          setBubble((current) => (current ? { ...current, streaming: false, answer: current.answer || message } : current))
        },
      },
    )
  }, [aiEnabled, anchor, onAiBlocked, onToast, paperId, releaseAnchor, sel, translationSettings])

  useEffect(() => () => {
    bubbleAbort.current?.abort()
  }, [])

  const loadModels = useCallback(() => {
    if (modelBusy) return
    setModelBusy(true)
    void api.chatModels(paperId)
      .then((catalog) => setModels(catalog))
      .catch((error) => onToast((error as Error).message))
      .finally(() => setModelBusy(false))
  }, [modelBusy, onToast, paperId])

  const pickModel = useCallback((next: ChatRoute) => {
    setModelBusy(true)
    void api.setChatModel(paperId, next)
      .then((applied) => {
        chat.setRoute(applied)
        setModels((previous) => (previous ? { ...previous, current: applied } : previous))
        onToast(`已切换到 ${applied.model}${applied.reasoningEffort ? ` · ${applied.reasoningEffort}` : ''}`)
      })
      .catch((error) => onToast((error as Error).message))
      .finally(() => setModelBusy(false))
  }, [chat, onToast, paperId])

  const ask = useCallback((question: string, quote?: string, targetPage?: number) => {
    const text = question.trim()
    if (text.length === 0 || chat.busy) return
    if (!aiEnabled) {
      onAiBlocked('继续对话')
      return
    }
    setBubble(null)
    onStateRef.current({ aiTab: 'ai' })
    onAiOpen(true)
    chat.send({ kind: 'ask', question: text, quote, page: targetPage ?? pageRef.current })
  }, [aiEnabled, chat, onAiBlocked, onAiOpen])

  const compact = useCallback(() => {
    if (compacting) return
    if (!aiEnabled) {
      onAiBlocked('压缩上下文')
      return
    }
    setCompacting(true)
    chat.compact()
      .then((result) => {
        onToast(result.removed > 0
          ? `已压缩 ${result.removed} 条，释放约 ${result.freedTokens} tokens`
          : '没有可压缩的内容')
      })
      .catch(() => {})
      .finally(() => setCompacting(false))
  }, [aiEnabled, chat, compacting, onAiBlocked, onToast])

  const regenerateSummary = useCallback(() => {
    if (!aiEnabled) {
      onAiBlocked(detail?.summary ? '重新生成导读' : '生成导读')
      return
    }
    if (summaryBusy) return
    setSummaryBusy(true)
    void api.summarize(paperId)
      .then(({ summary, warning }) => {
        setDetail((current) => (current
          ? { ...current, summary, tldr: summary.tldr, hasSummary: true }
          : current))
        onPaperChanged?.()
        onToast(warning ?? '导读已重新生成')
      })
      .catch((error) => onToast((error as Error).message))
      .finally(() => setSummaryBusy(false))
  }, [aiEnabled, detail?.summary, onAiBlocked, onPaperChanged, onToast, paperId, summaryBusy])

  const saveSummary = useCallback(async (patch: SummaryEdit) => {
    if (summarySaving) return
    setSummarySaving(true)
    try {
      const { summary } = await api.updateSummary(paperId, patch)
      setDetail((current) => (current
        ? { ...current, summary, tldr: summary.tldr, hasSummary: true }
        : current))
      onPaperChanged?.()
      onToast('导读已保存')
    } catch (error) {
      onToast((error as Error).message)
      throw error
    } finally {
      setSummarySaving(false)
    }
  }, [onPaperChanged, onToast, paperId, summarySaving])

  const saveMetadata = useCallback(async (patch: PaperMetadataPatch) => {
    if (metadataSaving) return
    setMetadataSaving(true)
    try {
      await api.patchPaper(paperId, patch)
      const next = await api.paper(paperId)
      setDetail(next)
      onPaperChanged?.()
      onToast('元数据已保存')
    } finally {
      setMetadataSaving(false)
    }
  }, [metadataSaving, onPaperChanged, onToast, paperId])

  const newConversation = useCallback(() => {
    if (clearing) return
    setClearing(true)
    chat.newConversation()
      .then(() => {
        setAnchored([])
        setBubble(null)
        onToast('已新建对话，上一段对话留在历史里')
      })
      .catch((error) => onToast((error as Error).message))
      .finally(() => setClearing(false))
  }, [chat, clearing, onToast])

  const selectConversation = useCallback((sessionId: string) => {
    if (chat.busy) return
    setClearing(true)
    chat.switchConversation(sessionId)
      .then(() => {
        setAnchored([])
        setBubble(null)
        onToast('已切换对话')
      })
      .catch((error) => onToast((error as Error).message))
      .finally(() => setClearing(false))
  }, [chat, onToast])

  useEffect(() => {
    const error = chat.error
    if (!error || error.at === lastErrorAt.current) return
    lastErrorAt.current = error.at
    onToast(error.message)
  }, [chat.error, onToast])

  // Turning the experiment off while the menu is open closes it immediately.
  useEffect(() => {
    if (!translationEnabled && translationMenu) setTranslationMenu(false)
  }, [translationEnabled, translationMenu])

  // Translation menu: outside click, Escape, or choosing a view closes it.
  useEffect(() => {
    if (!translationMenu) return undefined
    const onDown = (event: MouseEvent) => {
      if (!translationMenuRef.current?.contains(event.target as Node)) setTranslationMenu(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTranslationMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [translationMenu])

  // Surface a failed translation request once, instead of leaving it in the menu.
  const lastTranslationError = useRef<string | null>(null)
  useEffect(() => {
    const message = translation.error
    if (!message || message === lastTranslationError.current) return
    lastTranslationError.current = message
    onToast(message)
  }, [onToast, translation.error])

  const translationLabel = (() => {
    const status = translation.status
    if (!status) return '全文翻译'
    if (translation.running) {
      const page = status.runningPage ? `第 ${status.runningPage} 页 · ` : ''
      return `翻译中 ${page}${status.donePages}/${status.totalPages || '?'}`
    }
    if (status.donePages > 0) {
      return `已翻译 ${status.donePages}/${status.totalPages || status.donePages}`
    }
    if ((status.translatedBlocks ?? 0) > 0) {
      return `已翻译 ${status.translatedBlocks}/${status.totalBlocks || '?'} 段`
    }
    if (status.error) return '翻译失败'
    return '全文翻译'
  })()

  const startTranslation = useCallback((force = false) => {
    if (!translationEnabled) return
    if (!translationAllowed(aiEnabled, translationSettings)) {
      onAiBlocked('全文翻译')
      return
    }
    if (translation.source === 'browser') {
      if (translation.browser && !translation.browser.supported) {
        onToast(translation.browser.detail ?? '当前窗口不支持浏览器内置翻译')
        return
      }
    } else if (translation.status && !translation.available) {
      onToast(translation.status.source === 'browser'
        ? (translation.browser?.detail ?? '浏览器翻译不可用')
        : '当前翻译来源不可用，请先在设置里检查')
      return
    }
    void translation.start(force ? { force: true } : {})
    setTranslationMenu(false)
    if (effectiveTranslationView === 'off') setTranslationView('compare')
  }, [
    aiEnabled,
    effectiveTranslationView,
    onAiBlocked,
    onToast,
    setTranslationView,
    translation,
    translationEnabled,
    translationSettings,
  ])

  const chooseTranslationView = useCallback((view: TranslationView) => {
    const status = translation.status
    const noneYet = !status || (status.donePages === 0 && !translation.running)
    if (view !== 'off' && noneYet) {
      if (!translationAllowed(aiEnabled, translationSettings)) {
        onAiBlocked('全文翻译')
        return
      }
      if (translation.source === 'browser') {
        if (translation.browser && !translation.browser.supported) {
          onToast(translation.browser.detail ?? '当前窗口不支持浏览器内置翻译')
          return
        }
      } else if (status && !status.available) {
        onToast('当前翻译来源不可用，请先在设置里检查')
        return
      }
      void translation.start()
    }
    setTranslationView(view)
  }, [aiEnabled, onAiBlocked, onToast, setTranslationView, translation, translationSettings])

  const stageQuote = useCallback((text: string, targetPage: number, prompt: string) => {
    setComposerQuote({ text, page: targetPage, prompt })
    onStateRef.current({ aiTab: 'ai' })
    setBubble(null)
    onAiOpen(true)
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }, [onAiOpen])

  const applyHighlight = useCallback(async (color: HighlightColor) => {
    if (!sel) return
    const { quote, rects, page: targetPage } = sel
    anchor(null, targetPage)
    window.getSelection()?.removeAllRanges()
    setSel(null)
    const pageElement = stageRef.current?.querySelector<HTMLElement>(`.pr-pdfpage[data-page="${targetPage}"]`)
    const text = pageElement?.textContent ?? ''
    const index = text.indexOf(quote)
    const prefix = index > 0 ? text.slice(Math.max(0, index - 40), index) : ''
    const suffix = index >= 0 ? text.slice(index + quote.length, index + quote.length + 40) : ''
    try {
      const annotation = await api.addAnnotation(paperId, {
        page: targetPage,
        rects,
        quote,
        prefix: normalize(prefix),
        suffix: normalize(suffix),
        color,
      })
      setAnnotations((previous) => [...previous, annotation])
      onToast('已高亮，可在「批注」里回看')
    } catch (error) {
      onToast((error as Error).message)
    }
  }, [anchor, onToast, paperId, sel])

  const saveNote = useCallback(async (annotationId: string, body: string) => {
    try {
      const updated = await api.patchAnnotation(paperId, annotationId, { note: body })
      setAnnotations((previous) => previous.map((item) => (item.id === annotationId ? updated : item)))
      onToast(body.trim() ? '笔记已保存' : '笔记已清空')
    } catch (error) {
      onToast((error as Error).message)
    }
  }, [onToast, paperId])

  const removeAnnotation = useCallback(async (annotationId: string) => {
    try {
      await api.removeAnnotation(paperId, annotationId)
      setAnnotations((previous) => previous.filter((item) => item.id !== annotationId))
      onToast('已删除批注')
    } catch (error) {
      onToast((error as Error).message)
    }
  }, [onToast, paperId])

  const attachPdf = useCallback(async (file: File) => {
    if (attachBusy) return
    setAttachBusy(true)
    try {
      const job = await api.attachPdf(paperId, file)
      onToast('正在解析 PDF…')
      attachStop.current?.()
      attachStop.current = watchJob(job.jobId, (next) => {
        if (next.state === 'done') {
          attachStop.current?.()
          attachStop.current = null
          setAttachBusy(false)
          setReloadKey((value) => value + 1)
          onToast('PDF 已补齐，可以继续阅读')
        } else if (next.state === 'failed') {
          attachStop.current?.()
          attachStop.current = null
          setAttachBusy(false)
          onToast(next.error ?? 'PDF 解析失败')
        }
      })
    } catch (error) {
      setAttachBusy(false)
      onToast((error as Error).message)
    }
  }, [attachBusy, onToast, paperId])

  // ── zoom ─────────────────────────────────────────────────────────────────
  const stepZoom = (direction: number) => {
    const found = ZOOM_STEPS.findIndex((step) => step >= zoom - 0.001)
    const index = found < 0 ? ZOOM_STEPS.length - 1 : found
    onStateRef.current({ zoom: ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction))] })
  }

  const toggleRail = useCallback(() => {
    pulseLayoutMotion(240)
    setRailCollapsed(!railCollapsed)
  }, [railCollapsed, setRailCollapsed])

  // Picking a view is also a request to see it: a collapsed rail opens.
  const pickRailMode = useCallback((next: RailMode) => {
    if (next !== rail) {
      pulseLayoutMotion(240)
      onRail(next)
    }
    if (railCollapsed) setRailCollapsed(false)
  }, [onRail, rail, railCollapsed, setRailCollapsed])

  const handleBox = useCallback((box: PageBox) => {
    setBoxes((previous) => {
      const current = previous.get(box.page)
      if (
        current
        && Math.abs(current.scale - box.scale) < 0.0001
        && Math.abs(current.width - box.width) < 0.01
        && Math.abs(current.height - box.height) < 0.01
      ) return previous
      const next = new Map(previous)
      next.set(box.page, box)
      return next
    })
  }, [])

  const handlePdfError = useCallback((message: string) => {
    setPdfError(message)
    setTextMode(true)
  }, [])

  // ── page list for the current layout ─────────────────────────────────────
  const visiblePages = useMemo(() => {
    if (total <= 0) return []
    // Bilingual view is always one page per row: the pair needs the width.
    if (effectiveTranslationView !== 'off') return [Math.min(page, total)]
    if (layout !== 'spread') return [Math.min(page, total)]
    const current = Math.min(page, total)
    const start = current - 1 - ((current - 1) % 2) + 1
    return [start, start + 1].filter((n) => n <= total)
  }, [effectiveTranslationView, layout, page, total])

  const pageNumbers = useMemo(() => {
    if (total <= 0) return []
    return Array.from({ length: Math.min(total, 800) }, (_, index) => index + 1)
  }, [total])

  // A spread shows two pages; the editable box names the spread's first page,
  // and typing a page inside the spread jumps to the spread that contains it.
  const pageAnchor = layout === 'spread' && visiblePages.length > 0 ? visiblePages[0] : page

  useEffect(() => {
    setPageDraft(String(pageAnchor))
  }, [pageAnchor])

  const commitPageDraft = useCallback(() => {
    const parsed = Number.parseInt(pageDraft, 10)
    if (!Number.isFinite(parsed)) {
      setPageDraft(String(pageRef.current))
      return
    }
    const limit = totalRef.current > 0 ? totalRef.current : parsed
    const next = Math.max(1, Math.min(limit, parsed))
    setPageDraft(String(next))
    if (next !== pageRef.current) gotoPage(next)
  }, [gotoPage, pageDraft])

  const pageWidth = useMemo(() => {
    if (stageWidth <= 0) return null
    if (effectiveTranslationView !== 'off') {
      // Compare mode splits the stage; translation-only keeps a full page.
      const columns = effectiveTranslationView === 'compare' ? 2 : 1
      return Math.max(120, (stageWidth - PAGE_GUTTER - (columns > 1 ? 24 : 0)) / columns)
    }
    if (layout === 'spread') return Math.max(120, (stageWidth - PAGE_GUTTER - SPREAD_GAP) / 2)
    return Math.max(120, stageWidth - PAGE_GUTTER)
  }, [effectiveTranslationView, layout, stageWidth])

  const aspect = useMemo(() => {
    const first = boxes.get(1) ?? boxes.values().next().value
    if (!first || first.width <= 0 || first.height <= 0) return 0.773
    return first.width / first.height
  }, [boxes])

  const estimateHeight = (pageWidth ?? 640) / aspect * zoom

  // ── maps for the rail and the page overlays ──────────────────────────────
  const marksByPage = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const annotation of annotations) {
      const marks = map.get(annotation.page) ?? []
      marks.push(annotation.color)
      map.set(annotation.page, marks)
    }
    return map
  }, [annotations])

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const annotation of annotations) {
      const list = map.get(annotation.page) ?? []
      list.push(annotation)
      map.set(annotation.page, list)
    }
    return map
  }, [annotations])

  const anchorsByPage = useMemo(() => {
    const map = new Map<number, AnchorMark[]>()
    for (const item of anchored) {
      const list = map.get(item.page) ?? []
      list.push({ id: item.id, rects: item.rects, kind: item.kind })
      map.set(item.page, list)
    }
    return map
  }, [anchored])

  const jumpToAnnotation = useCallback((annotation: Annotation) => {
    setFocusAnnotation({ id: annotation.id, page: annotation.page, token: Date.now() })
    gotoPage(annotation.page)
  }, [gotoPage])

  // Wait for the page (and therefore the ring) to mount, then centre it.
  useEffect(() => {
    if (!focusAnnotation) return undefined
    let cancelled = false
    let frame = 0
    let tries = 0
    const tick = () => {
      if (cancelled) return
      const stage = stageRef.current
      const ring = stage?.querySelector<HTMLElement>(`[data-anno-ring="${focusAnnotation.id}"]`)
      if (ring && stage) {
        const stageBox = stage.getBoundingClientRect()
        const box = ring.getBoundingClientRect()
        const top = stage.scrollTop + box.top - stageBox.top - Math.max(40, stage.clientHeight * 0.3)
        stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      } else if (tries < 60) {
        tries += 1
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    const timer = window.setTimeout(() => {
      if (!cancelled) setFocusAnnotation(null)
    }, 3600)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusAnnotation])

  // Same wait-then-centre dance for the find mark: the target page may still be
  // mounting (single/spread swap, or a lazy page in continuous mode). Once the
  // text layer is up the hit is resolved to its own line boxes, so the flash
  // hugs the matched text instead of the whole paragraph.
  useEffect(() => {
    if (!findMark) return undefined
    let cancelled = false
    let frame = 0
    let tries = 0
    const startedAt = performance.now()
    const retry = () => {
      if (tries < 180) {
        tries += 1
        frame = requestAnimationFrame(tick)
      }
    }
    const settle = (rects: number[][] | null) => {
      setFindMark((current) => (
        current && current.token === findMark.token ? { ...current, rects } : current
      ))
    }
    const tick = () => {
      if (cancelled) return
      const stage = stageRef.current
      if (!stage) {
        retry()
        return
      }
      if (findMark.rects === undefined) {
        const pageElement = stage.querySelector<HTMLElement>(`.pr-pdfpage[data-page="${findMark.page}"]`)
        const box = boxesRef.current.get(findMark.page)
        if (pageElement && box && pageElement.querySelector('.pr-textlayer span')) {
          let rects: number[][] | null = null
          try {
            rects = locateTextInPage(pageElement, findMark.needle, findMark.bbox, box.scale * zoomRef.current)
          } catch {
            rects = null
          }
          settle(rects)
          return
        }
        // The page is up but has no text layer (a scanned page, or one whose
        // glyphs failed): do not leave the hit unmarked, flash the block instead.
        if (pageElement && performance.now() - startedAt > 1500) {
          settle(null)
          return
        }
      }
      const mark = stage.querySelector<HTMLElement>('[data-find-mark]')
      if (mark) {
        const stageBox = stage.getBoundingClientRect()
        const box = mark.getBoundingClientRect()
        if (box.width > 0 || box.height > 0) {
          const top = stage.scrollTop + box.top - stageBox.top - Math.max(60, stage.clientHeight * 0.32)
          stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
          return
        }
      }
      retry()
    }
    frame = requestAnimationFrame(tick)
    const timer = window.setTimeout(() => {
      if (!cancelled) setFindMark(null)
    }, 3600)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [findMark])

  const toolbarStyle: React.CSSProperties | undefined = sel
    ? {
      left: Math.max(190, Math.min(windowSize.w - 190, sel.rect.left + sel.rect.width / 2)),
      // Clear the tab strip and this reader's toolbar.
      top: Math.max(92, sel.rect.top - 8),
    }
    : undefined

  const bubbleLayout: React.CSSProperties | undefined = bubble
    ? placeBubble(bubble.rect, windowSize)
    : undefined

  if (loadError) {
    return (
      <div className="pr-reader">
        <div className="pr-empty-state">
          打不开这篇论文：{loadError}
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="pr-reader">
        <div className="pr-empty-state">载入中…</div>
      </div>
    )
  }

  const renderPage = (number: number) => {
    const find = findMark?.page === number ? findMark : null
    if (textMode) {
      return <TextPage key={number} paperId={paperId} pageNumber={number} find={find} width={pageWidth} />
    }
    if (!doc) {
      return <div key={number} className="pr-page-ghost" style={{ height: estimateHeight }} />
    }
    return (
      <PdfPage
        key={number}
        doc={doc}
        pageNumber={number}
        available={pageWidth}
        zoom={zoom}
        annotations={annotationsByPage.get(number) ?? NO_ANNOTATIONS}
        anchors={anchorsByPage.get(number) ?? NO_ANCHORS}
        focusId={focusAnnotation?.page === number ? focusAnnotation.id : null}
        find={find}
        selection={sel?.page === number ? sel.rects : liveRects?.page === number ? liveRects.rects : null}
        defer={moving}
        onBox={handleBox}
        onError={handlePdfError}
      />
    )
  }

  // A translation cache change bumps `updatedAt`/counters; page components use
  // it to refetch without polling every page individually.
  const translationVersion = [
    translation.status?.updatedAt ?? '',
    translation.status?.donePages ?? 0,
    translation.status?.failedPages ?? 0,
    translation.status?.runningPage ?? '',
  ].join(':')

  const renderTranslated = (number: number) => (
    <TranslatedPage
      key={`trans-${number}`}
      paperId={paperId}
      pageNumber={number}
      doc={doc}
      width={pageWidth ?? 595}
      zoom={zoom}
      version={translationVersion}
    />
  )

  const renderBilingualPage = (number: number) => (
    <div
      className="pr-bipage"
      key={`bi-${number}`}
      data-mode={effectiveTranslationView}
      data-page={number}
    >
      {effectiveTranslationView === 'compare' ? renderPage(number) : null}
      {renderTranslated(number)}
    </div>
  )

  const fallbackNote = textMode ? (
    <div className="pr-fallback-note">
      <IconFile size={12} />
      <span>
        {detail.hasFullText
          ? `PDF 预览不可用${pdfError ? `：${pdfError}` : ''}。已改用解析后的文本。`
          : detail.pdfUnavailable === 'auth'
            ? '该 PDF 需要登录或订阅，已仅导入基本信息。请自行下载 PDF 后上传。'
            : '还没获取到 PDF，已仅导入基本信息。可自行下载后上传。'}
      </span>
      {detail.hasFullText ? (
        <button
          className="pr-btn"
          data-sm
          onClick={() => {
            setPdfError(null)
            setTextMode(false)
            setPdfAttempt((value) => value + 1)
          }}
        >
          重试预览
        </button>
      ) : (
        <button
          className="pr-btn"
          data-sm
          data-primary
          disabled={attachBusy}
          onClick={() => attachInput.current?.click()}
        >
          <IconUpload size={12} />
          {attachBusy ? '正在上传…' : '上传 PDF'}
        </button>
      )}
    </div>
  ) : null

  return (
    <div className="pr-reader">
      <input
        ref={attachInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void attachPdf(file)
        }}
      />

      <div className="pr-reader-toolbar">
        <div className="pr-rt-left">
          <button
            type="button"
            className="pr-btn pr-rail-toggle"
            data-icon
            data-ghost
            data-collapsed={railCollapsed || undefined}
            aria-expanded={!railCollapsed}
            aria-pressed={!railCollapsed}
            title={railCollapsed ? '展开左栏' : '收起左栏'}
            aria-label={railCollapsed ? '展开左栏' : '收起左栏'}
            onClick={toggleRail}
          >
            {railCollapsed ? <IconPanelExpand size={15} /> : <IconPanelCollapse size={15} />}
          </button>

          <span className="pr-tool-sep" />

          <div className="pr-seg pr-rail-mode" role="group" aria-label="左栏视图">
            {RAIL_MODES.map((entry) => {
              const Icon = entry.icon
              const on = rail === entry.key
              return (
                <button
                  key={entry.key}
                  type="button"
                  data-on={on || undefined}
                  aria-pressed={on}
                  title={entry.label}
                  aria-label={entry.label}
                  onClick={() => pickRailMode(entry.key)}
                >
                  <Icon size={14} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="pr-rt-center">
          <div className="pr-page-nav">
            <input
              className="pr-page-input"
              value={pageDraft}
              disabled={total <= 0}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="跳转到页码"
              title="输入页码，回车跳转"
              onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitPageDraft()
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setPageDraft(String(pageAnchor))
                  event.currentTarget.blur()
                }
              }}
              onBlur={commitPageDraft}
            />
            {layout === 'spread' && visiblePages.length > 1 ? (
              <span className="pr-page-range">–{visiblePages[visiblePages.length - 1]}</span>
            ) : null}
            <span className="pr-zoom-page">/ {total > 0 ? total : '?'}</span>
          </div>

          {!textMode ? (
            <>
              <span className="pr-tool-sep" />
              <div className="pr-zoom">
                <button type="button" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]} title="缩小">
                  −
                </button>
                <button
                  type="button"
                  className="pr-zoom-pct"
                  onClick={() => onStateRef.current({ zoom: 1 })}
                  title="适应宽度"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => stepZoom(1)}
                  disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                  title="放大"
                >
                  +
                </button>
              </div>
            </>
          ) : null}

          <span className="pr-tool-sep" />

          <div className="pr-seg pr-layout-seg" role="group" aria-label="阅读模式">
            {LAYOUTS.map((entry) => {
              const Icon = entry.icon
              const on = layout === entry.key
              return (
                <button
                  key={entry.key}
                  type="button"
                  data-on={on || undefined}
                  aria-pressed={on}
                  disabled={effectiveTranslationView === 'reflow' || (effectiveTranslationView !== 'off' && entry.key === 'spread')}
                  title={effectiveTranslationView === 'reflow'
                    ? '整篇重排不使用分页布局'
                    : effectiveTranslationView !== 'off' && entry.key === 'spread'
                      ? '对照视图按页成对显示，回到原文后可用双面'
                      : `${entry.label}阅读`}
                  aria-label={`${entry.label}阅读`}
                  onClick={() => onLayout(entry.key)}
                >
                  <Icon size={14} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="pr-rt-right">
          {translationEnabled ? (
          <div className="pr-translate" ref={translationMenuRef}>
            <button
              type="button"
              className="pr-btn pr-translate-toggle"
              data-icon
              data-ghost
              data-on={translationView !== 'off' || undefined}
              data-running={translation.running || undefined}
              aria-expanded={translationMenu}
              aria-haspopup="dialog"
              title={translationLabel}
              aria-label={translationLabel}
              onClick={() => setTranslationMenu((value) => !value)}
            >
              <IconTranslate size={16} />
            </button>
            {translationMenu ? (
              <div className="pr-translate-menu" role="dialog" aria-label="全文翻译">
                <div className="pr-translate-head">
                  <b>全文翻译</b>
                  <span>{translationLabel}</span>
                </div>
                <div className="pr-translate-source">
                  <span>来源：{translation.sourceLabel || translationSourceLabel(translationSettings)}</span>
                  <span title={translation.status?.model}>
                    {translation.mode === 'mt' ? '逐段' : '结构化'}
                    {translation.status?.model ? ` · ${translation.status.model}` : ''}
                  </span>
                </div>
                {translation.source === 'browser' ? (
                  <>
                    {!translation.browser ? (
                      <div className="pr-translate-hint">正在检测浏览器翻译模型…</div>
                    ) : null}
                    {translation.browser && !translation.browser.supported ? (
                      <div className="pr-translate-hint" data-tone="warn">
                        <span>{translation.browser.detail}</span>
                        <button
                          type="button"
                          className="pr-btn"
                          data-sm
                          data-ghost
                          onClick={() => {
                            void navigator.clipboard?.writeText(window.location.href)
                            onToast('已复制页面地址，可用 Chrome/Edge 打开')
                          }}
                        >
                          复制地址
                        </button>
                      </div>
                    ) : null}
                    {translation.browser?.supported && translation.browser.availability === 'downloadable' ? (
                      <div className="pr-translate-hint">
                        首次翻译需要下载 {translationSettings.browser.sourceLanguage} → zh 语言包，期间请保持页面打开。
                      </div>
                    ) : null}
                    {translation.download !== null ? (
                      <div className="pr-translate-hint">语言包下载 {translation.download}%</div>
                    ) : null}
                    {translation.running && translation.progress && translation.progress.total > 0 ? (
                      <div className="pr-translate-hint">
                        浏览器翻译：{translation.progress.done}/{translation.progress.total} 段
                        {translation.progress.page > 0 ? ` · 第 ${translation.progress.page} 页` : ''}
                      </div>
                    ) : null}
                  </>
                ) : null}
                {translation.status?.error || translation.error ? (
                  <div className="pr-translate-error">
                    {translation.status?.error ?? translation.error}
                  </div>
                ) : null}
                <div className="pr-translate-actions">
                  {translation.running ? (
                    <button
                      type="button"
                      className="pr-btn"
                      data-sm
                      onClick={() => {
                        void translation.cancel()
                        onToast('已停止翻译，已完成的页会保留')
                      }}
                    >
                      停止翻译
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="pr-btn"
                        data-sm
                        data-primary
                        disabled={translation.busy || (translation.source === 'browser' && translation.browser?.supported === false)}
                        onClick={() => startTranslation(false)}
                      >
                        {(translation.status?.donePages ?? 0) > 0 ? '继续翻译' : '翻译全文'}
                      </button>
                      {(translation.status?.donePages ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="pr-btn"
                          data-sm
                          data-ghost
                          disabled={translation.busy}
                          title="忽略缓存，重新翻译整篇论文"
                          onClick={() => startTranslation(true)}
                        >
                          重新翻译
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="pr-translate-views" role="group" aria-label="译文显示方式">
                  <button
                    type="button"
                    data-on={translationView === 'off' || undefined}
                    onClick={() => setTranslationView('off')}
                  >
                    原文
                  </button>
                  <button
                    type="button"
                    data-on={translationView === 'compare' || undefined}
                    onClick={() => chooseTranslationView('compare')}
                  >
                    左右对照
                  </button>
                  <button
                    type="button"
                    data-on={translationView === 'only' || undefined}
                    onClick={() => chooseTranslationView('only')}
                  >
                    仅译文
                  </button>
                  <button
                    type="button"
                    data-on={translationView === 'reflow' || undefined}
                    onClick={() => chooseTranslationView('reflow')}
                  >
                    重排
                  </button>
                </div>
                <div className="pr-translate-note">
                  {translation.mode === 'mt'
                    ? '专用翻译来源按阅读顺序逐段翻译；公式、引用、参考文献与图表文字由代码跳过或保护，不经过模型。译文会缓存，重开不再重复翻译。'
                    : '参考文献、作者信息与图表内文字自动跳过；图片、表格、公式保留原样。译文会缓存，重开不再重复翻译。'}
                </div>
              </div>
            ) : null}
          </div>
          ) : null}
          <ReaderSearch paperId={paperId} onPick={jumpToFind} openSignal={searchSignal} />
          <button
            type="button"
            className="pr-btn pr-read-toggle"
            data-icon
            data-ghost
            data-done={paper?.status === 'done' || undefined}
            aria-pressed={paper?.status === 'done'}
            aria-label={paper?.status === 'done' ? '已读，点击标记为待读' : '未读，点击标记为已读'}
            title={paper?.status === 'done' ? '已读 · 点击标记为待读' : '未读 · 点击标记为已读'}
            disabled={!paper}
            onClick={() => {
              if (paper) onToggleDone(paper)
            }}
          >
            {paper?.status === 'done' ? <IconCircleCheck size={16} /> : <IconCircle size={16} />}
          </button>
          <button
            type="button"
            className="pr-btn pr-ai-toggle"
            data-icon
            data-primary={aiOpen || undefined}
            aria-pressed={aiOpen}
            title={aiOpen ? '收起右栏' : '展开右栏'}
            aria-label={aiOpen ? '收起右栏' : '展开右栏'}
            onClick={() => onAiOpen(!aiOpen)}
          >
            <IconSpark size={16} />
          </button>
        </div>
      </div>

      <div className="pr-reader-body">
        <PageRail
          mode={rail}
          collapsed={railCollapsed}
          doc={doc}
          textMode={textMode}
          total={total}
          page={page}
          marksByPage={marksByPage}
          onSelect={gotoPage}
        />

        <div className="pr-stage-wrap">
          <div
            className="pr-stage"
            ref={stageRef}
            onMouseDown={() => {
              setSel(null)
              setLiveRects(null)
            }}
            onMouseUp={handleMouseUp}
            onScroll={onScroll}
          >
            {fallbackNote}
            {effectiveTranslationView === 'reflow' ? (
              <ReflowedPaper
                paperId={paperId}
                doc={doc}
                page={page}
                zoom={zoom}
                status={translation.status}
                version={translationVersion}
                onPageChange={noteReflowPage}
                onToast={onToast}
              />
            ) : layout === 'continuous' ? (
              <div className="pr-continuous" ref={contentRef}>
                {pageNumbers.map((number) => (
                  <PageSlot key={number} pageNumber={number} estimate={estimateHeight}>
                    {effectiveTranslationView !== 'off' ? renderBilingualPage(number) : renderPage(number)}
                  </PageSlot>
                ))}
              </div>
            ) : (
              <div
                className="pr-spread"
                data-count={visiblePages.length}
                data-mode={effectiveTranslationView !== 'off' ? 'bilingual' : layout}
                data-text={textMode ? '1' : undefined}
              >
                {visiblePages.map((number) => (
                  effectiveTranslationView !== 'off' ? renderBilingualPage(number) : renderPage(number)
                ))}
                {visiblePages.length === 0 ? <div className="pr-empty-state">载入中…</div> : null}
              </div>
            )}
          </div>
        </div>

        <AIPanel
          detail={detail}
          open={aiOpen}
          tab={aiTab}
          onTab={(next) => onStateRef.current({ aiTab: next })}
          thread={chat.messages}
          context={chat.context}
          compacting={compacting}
          clearing={clearing}
          conversations={chat.conversations}
          route={chat.route}
          models={models}
          modelBusy={modelBusy}
          onLoadModels={loadModels}
          onPickModel={pickModel}
          annotations={annotations}
          relations={relations}
          busy={chat.busy}
          composerQuote={composerQuote}
          onClearQuote={() => setComposerQuote(null)}
          onSend={ask}
          onCompact={compact}
          onNewConversation={newConversation}
          onSelectConversation={selectConversation}
          onRenameConversation={chat.renameConversation}
          onArchiveConversation={chat.archiveConversation}
          onUnarchiveConversation={chat.unarchiveConversation}
          onJump={jumpToAnnotation}
          onSaveNote={saveNote}
          onRemoveAnnotation={removeAnnotation}
          onOpenPaper={onOpenPaper ?? ((id) => onToast(`关联论文：${id}`))}
          onShowRelations={onShowRelations}
          onToast={onToast}
          aiEnabled={aiEnabled}
          onAiBlocked={onAiBlocked}
          onRegenerateSummary={regenerateSummary}
          onSaveSummary={saveSummary}
          summaryBusy={summaryBusy}
          summarySaving={summarySaving}
          onSaveMetadata={saveMetadata}
          metadataSaving={metadataSaving}
        />
      </div>

      {sel && toolbarStyle ? (
        <div className="pr-toolbar" style={toolbarStyle} onMouseDown={(event) => event.preventDefault()}>
          <button
            onClick={() => {
              if (!sel) return
              stageQuote(sel.quote, sel.page, '解释这段内容')
            }}
          >
            <IconSpark size={13} />
            解释
          </button>
          <button onClick={() => runBubble('translate')}>翻译</button>
          <span className="pr-sep" />
          {textMode ? null : (
            <>
              <span className="pr-swatches">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.key}
                    className="pr-swatch"
                    style={{ background: color.css }}
                    title={`高亮（${color.label}）`}
                    onClick={() => void applyHighlight(color.key)}
                  />
                ))}
              </span>
              <span className="pr-sep" />
            </>
          )}
          <button
            title="复制"
            onClick={() => {
              void navigator.clipboard?.writeText(sel.quote)
              onToast('已复制选段')
              window.getSelection()?.removeAllRanges()
              setSel(null)
            }}
          >
            <IconCopy size={13} />
          </button>
        </div>
      ) : null}

      {bubble && bubbleLayout ? (
        <div className="pr-bubble" style={bubbleLayout}>
          <div className="pr-bubble-head">
            <IconSpark size={12} />
            {bubble.kind === 'translate' ? '译文' : '解释'}
            <span style={{ marginLeft: 'auto' }}>第 {bubble.page} 页</span>
            <button className="pr-btn" data-icon data-ghost title="关闭" onClick={() => setBubble(null)}>
              <IconClose size={12} />
            </button>
          </div>
          <div className="pr-bubble-quote">{bubble.quote}</div>
          <div className="pr-bubble-body">
            <RichText text={bubble.answer} />
            {bubble.streaming ? <span className="pr-caret" /> : null}
          </div>
          {!bubble.streaming ? (
            <div className="pr-bubble-foot">
              <button
                className="pr-btn"
                data-sm
                onClick={() => {
                  void navigator.clipboard?.writeText(bubble.answer)
                  onToast('已复制')
                }}
              >
                复制
              </button>
              <button
                className="pr-btn"
                data-sm
                onClick={() => {
                  const { quote, page: bubblePage } = bubble
                  setBubble(null)
                  stageQuote(quote, bubblePage, '继续展开这段内容')
                }}
              >
                继续追问
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
