/**
 * The reading workspace: which papers are open in tabs, and how each one was
 * left. Deliberately tiny and dependency-free — it is written on every page
 * change and read once at boot, so it stays plain JSON in `localStorage`.
 */

export type ReaderLayout = 'single' | 'spread' | 'continuous'
export type RailMode = 'preview' | 'title'
export type AiTab = 'ai' | 'guide' | 'notes' | 'relations' | 'info'
/**
 * off = original only; compare = original + translation; only = translation on
 * a faithful page; reflow = one continuous, re-typeset reading view.
 */
export type TranslationView = 'off' | 'compare' | 'only' | 'reflow'

export interface ReaderTab {
  paperId: string
  page: number
  /** Stage scroll offset; restored when the tab is activated again. */
  scrollTop: number
  zoom: number
  layout: ReaderLayout
  aiTab: AiTab
  translationView: TranslationView
}

export interface WorkspaceState {
  tabs: ReaderTab[]
  activeId: string | null
  /** Global reading preference, not per tab: the rail's own two modes. */
  rail: RailMode
  /** Layout a newly opened tab starts with (the last one the user picked). */
  layout: ReaderLayout
}

const KEY = 'paperreader.workspace.v1'
const LAYOUTS: ReaderLayout[] = ['single', 'spread', 'continuous']
const AI_TABS: AiTab[] = ['ai', 'guide', 'notes', 'relations', 'info']
const TRANSLATION_VIEWS: TranslationView[] = ['off', 'compare', 'only', 'reflow']

/** Access can throw (privacy mode, sandboxed frame); the workspace is a cache. */
function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export const DEFAULT_WORKSPACE: WorkspaceState = {
  tabs: [],
  activeId: null,
  rail: 'preview',
  layout: 'single',
}

/** Zoom steps live in the reader; this only guards a corrupt stored value. */
export function clampZoom(value: unknown): number {
  const zoom = Number(value)
  if (!Number.isFinite(zoom)) return 1
  return Math.min(2, Math.max(0.6, zoom))
}

export function clampPage(value: unknown): number {
  const page = Math.round(Number(value))
  return Number.isFinite(page) && page > 0 ? page : 1
}

export function createTab(paperId: string, page: number, layout: ReaderLayout): ReaderTab {
  return {
    paperId,
    page: clampPage(page),
    scrollTop: 0,
    zoom: 1,
    layout: LAYOUTS.includes(layout) ? layout : 'single',
    aiTab: 'ai',
    translationView: 'off',
  }
}

function normalizeTab(raw: any): ReaderTab | null {
  if (!raw || typeof raw.paperId !== 'string' || raw.paperId === '') return null
  return {
    paperId: raw.paperId,
    page: clampPage(raw.page),
    scrollTop: Number.isFinite(Number(raw.scrollTop)) ? Math.max(0, Number(raw.scrollTop)) : 0,
    zoom: clampZoom(raw.zoom),
    layout: LAYOUTS.includes(raw.layout) ? raw.layout : 'single',
    aiTab: AI_TABS.includes(raw.aiTab) ? raw.aiTab : 'ai',
    translationView: TRANSLATION_VIEWS.includes(raw.translationView) ? raw.translationView : 'off',
  }
}

/**
 * Read the stored workspace. `keep` (when given) drops tabs whose paper is no
 * longer in the library — a paper trashed in another session must not come
 * back as a dead tab after a refresh.
 */
export function loadWorkspace(keep?: Set<string>): WorkspaceState {
  const store = storage()
  if (!store) return DEFAULT_WORKSPACE
  let parsed: any = null
  try {
    parsed = JSON.parse(store.getItem(KEY) ?? 'null')
  } catch {
    return DEFAULT_WORKSPACE
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_WORKSPACE

  const seen = new Set<string>()
  const tabs: ReaderTab[] = []
  for (const raw of Array.isArray(parsed.tabs) ? parsed.tabs : []) {
    const tab = normalizeTab(raw)
    if (!tab || seen.has(tab.paperId)) continue
    if (keep && !keep.has(tab.paperId)) continue
    seen.add(tab.paperId)
    tabs.push(tab)
  }
  const activeId = typeof parsed.activeId === 'string' && seen.has(parsed.activeId)
    ? parsed.activeId
    : null

  return {
    tabs,
    activeId,
    rail: parsed.rail === 'title' ? 'title' : 'preview',
    layout: LAYOUTS.includes(parsed.layout) ? parsed.layout : 'single',
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify({
      tabs: state.tabs,
      activeId: state.activeId,
      rail: state.rail,
      layout: state.layout,
    }))
  } catch {
    /* quota or a disabled store: the workspace is a cache, never the truth */
  }
}

/** Drop tabs whose paper disappeared or moved to the recycle bin. */
export function pruneWorkspace(
  state: WorkspaceState,
  keep: Set<string>,
): WorkspaceState {
  const tabs = state.tabs.filter((tab) => keep.has(tab.paperId))
  if (tabs.length === state.tabs.length) return state
  const activeId = state.activeId && tabs.some((tab) => tab.paperId === state.activeId)
    ? state.activeId
    : null
  return { ...state, tabs, activeId }
}

/** Where focus lands after closing `removed`: the next tab right, else left. */
export function neighborAfter(
  tabs: ReaderTab[],
  removed: Set<string>,
  activeId: string | null,
): string | null {
  if (!activeId || !removed.has(activeId)) return activeId
  const index = tabs.findIndex((tab) => tab.paperId === activeId)
  if (index < 0) return null
  for (let i = index + 1; i < tabs.length; i += 1) {
    if (!removed.has(tabs[i].paperId)) return tabs[i].paperId
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!removed.has(tabs[i].paperId)) return tabs[i].paperId
  }
  return null
}
