/**
 * Sidebar sizing, collapse flags and the "a layout pane is moving" signal.
 *
 * Widths are UI preference, not reading state, so they live in their own
 * `localStorage` record instead of the workspace tab cache. A drag writes the
 * pane's width straight to the DOM (one rAF per frame) and only commits to
 * React on release: moving a sidebar must not re-render the whole app 60 times
 * a second.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

export type PaneKey = 'nav' | 'folders' | 'railPreview' | 'railTitle' | 'panel'
export type LayoutFlagKey = 'railCollapsed' | 'aiOpen'
export type PaneEdge = 'left' | 'right'

export interface PaneSpec {
  /** Fresh-install width; double-clicking the divider restores it. */
  width: number
  min: number
  max: number
}

/**
 * Defaults keep the existing geometry. The maxima are deliberately generous
 * but still leave the paper/content column a readable width; the drag handler
 * additionally tightens them against the current viewport.
 */
export const PANE_SPECS: Record<PaneKey, PaneSpec> = {
  nav: { width: 224, min: 176, max: 340 },
  folders: { width: 202, min: 168, max: 340 },
  railPreview: { width: 120, min: 96, max: 320 },
  railTitle: { width: 212, min: 160, max: 360 },
  panel: { width: 366, min: 300, max: 560 },
}

const FLAG_DEFAULTS: Record<LayoutFlagKey, boolean> = {
  railCollapsed: false,
  aiOpen: true,
}

const KEY = 'paperreader.layout.v1'
/** Content column that must survive whichever pane is being widened. */
const MIN_CONTENT = 360

type StoredLayout = Partial<Record<PaneKey, number>> & Partial<Record<LayoutFlagKey, boolean>>

let cache: StoredLayout | null = null

/** Access can throw (privacy mode, sandboxed frame); the layout is a cache. */
function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function readStore(): StoredLayout {
  if (cache) return cache
  const store = storage()
  if (!store) {
    cache = {}
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? 'null')
    cache = parsed && typeof parsed === 'object' ? parsed as StoredLayout : {}
  } catch {
    cache = {}
  }
  return cache
}

function writeStore(patch: StoredLayout): void {
  cache = { ...readStore(), ...patch }
  const store = storage()
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* quota or a disabled store: sizing simply stops persisting */
  }
}

/** A single pane may not eat more than 46% of the viewport. */
function viewportMax(spec: PaneSpec): number {
  if (typeof window === 'undefined') return spec.max
  return Math.max(spec.min, Math.min(spec.max, Math.floor(window.innerWidth * 0.46)))
}

function clampWidth(key: PaneKey, value: unknown): number {
  const spec = PANE_SPECS[key]
  const numeric = Number(value)
  const base = Number.isFinite(numeric) ? numeric : spec.width
  return Math.round(Math.min(viewportMax(spec), Math.max(spec.min, base)))
}

/**
 * How wide the pane may grow before the content beside it drops below
 * `MIN_CONTENT`. Measured from the live siblings, so the reader's left rail and
 * AI panel cannot both squeeze the paper away.
 */
function spaceMax(element: HTMLElement, spec: PaneSpec): number {
  const parent = element.parentElement
  // jsdom and a pre-layout frame report 0; fall back to the viewport budget.
  if (!parent || parent.clientWidth <= 0) return viewportMax(spec)
  // The pane's sibling set always contains one flexible content column (the
  // stage, `.pr-content`, `.pr-lib-main`) that shrinks as the pane grows. Treat
  // the widest sibling as that column and keep only the fixed panes in the
  // budget; otherwise the current content width would count twice.
  let total = 0
  let widest = 0
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    if (child === element) continue
    const width = child.getBoundingClientRect().width || child.clientWidth
    total += width
    if (width > widest) widest = width
  }
  const room = parent.clientWidth - (total - widest) - MIN_CONTENT
  return Math.max(spec.min, Math.min(viewportMax(spec), room))
}

// ── layout motion signal ──────────────────────────────────────────────────
// The reader defers PDF text/bitmap work while a divider is moving, then
// settles once when the pane stops. A tiny external store keeps that decision
// local to the reader instead of re-rendering the app shell.

let dragDepth = 0
let pulseCount = 0
let pulseTimer: number | null = null
let motionActive = false
const motionListeners = new Set<() => void>()

function emitMotion(): void {
  const next = dragDepth > 0 || pulseCount > 0
  if (next === motionActive) return
  motionActive = next
  for (const listener of motionListeners) listener()
}

export function beginLayoutMotion(): void {
  dragDepth += 1
  emitMotion()
}

export function endLayoutMotion(): void {
  dragDepth = Math.max(0, dragDepth - 1)
  emitMotion()
}

/**
 * Hold the "moving" flag for a CSS width transition (collapse/expand, mode
 * switch, keyboard step) and let it drop when the animation is over.
 */
export function pulseLayoutMotion(duration = 220): void {
  pulseCount += 1
  emitMotion()
  if (typeof window === 'undefined') {
    pulseCount = 0
    emitMotion()
    return
  }
  let wait = Math.max(0, duration)
  try {
    // No CSS transition means the final width is on screen immediately; do not
    // leave the stretched bitmap waiting for an animation that never happens.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) wait = 0
  } catch {
    /* matchMedia unavailable: keep the requested duration */
  }
  if (pulseTimer !== null) window.clearTimeout(pulseTimer)
  pulseTimer = window.setTimeout(() => {
    pulseTimer = null
    pulseCount = 0
    emitMotion()
  }, wait)
}

export function isLayoutMotion(): boolean {
  return motionActive
}

export function subscribeLayoutMotion(listener: () => void): () => void {
  motionListeners.add(listener)
  return () => {
    motionListeners.delete(listener)
  }
}

export function useLayoutMotion(): boolean {
  return useSyncExternalStore(subscribeLayoutMotion, isLayoutMotion, () => false)
}

// ── sizing hook ───────────────────────────────────────────────────────────

export interface PaneHandle {
  edge: PaneEdge
  min: number
  max: number
  value: number
  dragging: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}

export interface PaneSize {
  ref: RefObject<HTMLElement>
  /**
   * Optional inner wrapper whose width must not animate while the outer pane is
   * collapsed: it clips the contents instead of reflowing them every frame.
   */
  innerRef: RefObject<HTMLDivElement>
  width: number
  min: number
  max: number
  dragging: boolean
  handle: PaneHandle
  setWidth: (next: number) => void
}

export function usePaneSize(key: PaneKey, edge: PaneEdge = 'right'): PaneSize {
  const spec = PANE_SPECS[key]
  const ref = useRef<HTMLElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [width, setWidthState] = useState(() => clampWidth(key, readStore()[key]))
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width
  const draggingRef = useRef(false)
  const dragWidth = useRef(width)

  // The reader re-renders while the paper reflows, which would put the stale
  // committed width back on the element before the next pointermove. Re-assert
  // the live drag width in the same commit, before paint, so the divider never
  // snaps backwards mid-drag.
  useLayoutEffect(() => {
    if (!draggingRef.current) return
    const element = ref.current
    if (element) element.style.width = `${dragWidth.current}px`
    if (innerRef.current) innerRef.current.style.width = `${dragWidth.current}px`
  })

  const commit = useCallback((next: number) => {
    const value = clampWidth(key, next)
    widthRef.current = value
    setWidthState(value)
    writeStore({ [key]: value })
  }, [key])

  const setWidth = useCallback((next: number) => {
    const value = clampWidth(key, next)
    if (value === widthRef.current) return
    widthRef.current = value
    setWidthState(value)
    writeStore({ [key]: value })
    pulseLayoutMotion()
  }, [key])

  // Keep a saved width usable when the window shrinks; expanding it again does
  // not restore the old value, which is what a user expects after clamping.
  useEffect(() => {
    const onResize = () => {
      const next = clampWidth(key, widthRef.current)
      if (next === widthRef.current) return
      widthRef.current = next
      setWidthState(next)
      writeStore({ [key]: next })
      pulseLayoutMotion(180)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [key])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const element = ref.current
    if (!element) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = element.getBoundingClientRect().width || widthRef.current
    const limit = spaceMax(element, spec)
    const direction = edge === 'right' ? 1 : -1
    const root = element.closest('.pr-root')
    const html = document.documentElement
    const previousCursor = html.style.cursor
    const previousSelect = html.style.userSelect
    let latest = Math.round(startWidth)
    let frame = 0

    const paint = () => {
      frame = 0
      dragWidth.current = latest
      element.style.width = `${latest}px`
      if (innerRef.current) innerRef.current.style.width = `${latest}px`
    }
    const move = (moveEvent: PointerEvent) => {
      latest = Math.round(Math.min(
        limit,
        Math.max(spec.min, startWidth + (moveEvent.clientX - startX) * direction),
      ))
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (frame) cancelAnimationFrame(frame)
      paint()
      draggingRef.current = false
      commit(latest)
      setDragging(false)
      root?.removeAttribute('data-resizing')
      html.style.cursor = previousCursor
      html.style.userSelect = previousSelect
      endLayoutMotion()
      // One more short hold covers the final ResizeObserver pass in the reader.
      pulseLayoutMotion(90)
    }

    setDragging(true)
    draggingRef.current = true
    dragWidth.current = latest
    root?.setAttribute('data-resizing', '')
    html.style.cursor = 'col-resize'
    html.style.userSelect = 'none'
    beginLayoutMotion()
    paint()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [commit, edge, spec])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const space = edge === 'right' ? -1 : 1
    const step = event.shiftKey ? 24 : 8
    const element = ref.current
    const limit = element
      ? Math.min(viewportMax(spec), spaceMax(element, spec))
      : viewportMax(spec)
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = widthRef.current + space * step
    else if (event.key === 'ArrowRight') next = widthRef.current - space * step
    else if (event.key === 'Home') next = spec.min
    else if (event.key === 'End') next = limit
    if (next === null) return
    event.preventDefault()
    setWidth(Math.min(limit, Math.max(spec.min, next)))
  }, [edge, setWidth, spec])

  const onDoubleClick = useCallback(() => {
    setWidth(spec.width)
  }, [setWidth, spec.width])

  return {
    ref,
    innerRef,
    width,
    min: spec.min,
    max: viewportMax(spec),
    dragging,
    handle: {
      edge,
      min: spec.min,
      max: viewportMax(spec),
      value: width,
      dragging,
      onPointerDown,
      onKeyDown,
      onDoubleClick,
    },
    setWidth,
  }
}

/** A persisted boolean flag (reader rail collapsed, AI panel open). */
export function useLayoutFlag(key: LayoutFlagKey): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = readStore()[key]
    return typeof stored === 'boolean' ? stored : FLAG_DEFAULTS[key]
  })
  const update = useCallback((next: boolean) => {
    setValue(next)
    writeStore({ [key]: next })
  }, [key])
  return [value, update]
}
