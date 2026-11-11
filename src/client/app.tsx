import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_RECENT_LIMIT } from '../shared/constants.js'
import { api } from './lib/api.js'
import { ImportDialog, JobQueue, type ImportProgress, type ImportRequest } from './features/import/ImportDialog.js'
import { Reader } from './features/reader/Reader.js'
import { SettingsPage } from './features/settings/SettingsPage.js'
import { RecentPage } from './features/recent/RecentPage.js'
import { LibraryPage, type FolderFilter } from './features/library/LibraryPage.js'
import { OrganizeDialog } from './features/library/OrganizeDialog.js'
import { RelationsPage } from './features/relations/RelationsPage.js'
import { TasksPage } from './features/tasks/TasksPage.js'
import { TopBar } from './features/workspace/TopBar.js'
import {
  createTab,
  loadWorkspace,
  neighborAfter,
  pruneWorkspace,
  saveWorkspace,
  type ReaderLayout,
  type ReaderTab,
  type RailMode,
  type WorkspaceState,
} from './features/workspace/tabs.js'
import { NavItem } from './components/NavItem.js'
import { PaneResizer } from './components/PaneResizer.js'
import { useLayoutFlag, usePaneSize, pulseLayoutMotion } from './lib/pane-size.js'
import type { AppConfig, Folder, LibrarySearchPayload, Paper, Status, TranslationSettings } from './types.js'
import { normalizeTranslationSettings } from '../shared/translation.js'
import { IconActivity, IconClock, IconGear, IconLibrary, IconPlus, IconSpark } from './components/ui.js'

/** Injected by build/build.mjs. */
declare const __PR_VERSION__: string
declare const __PR_BUILD__: string

type View = 'recent' | 'library' | 'relations' | 'tasks' | 'settings'

export function PaperReaderApp({
  scheme = 'light',
  ctx,
  accentStyle,
}: {
  scheme?: 'light' | 'dark'
  ctx?: any
  accentStyle?: React.CSSProperties
}) {
  const [papers, setPapers] = useState<Paper[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [trash, setTrash] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Host config drives the experimental switches and the default library view;
  // SettingsPage keeps its own editable copy and hands every saved value back.
  const [config, setConfig] = useState<AppConfig | null>(null)

  const [view, setView] = useState<View>('recent')
  // The page a reader was opened from: the back arrow returns here instead of
  // assuming every paper belongs to the library.
  const [readerOrigin, setReaderOrigin] = useState<View>('library')
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace())
  const [aiOpen, setAiOpen] = useLayoutFlag('aiOpen')
  const navPane = usePaneSize('nav')
  const [relationsFocus, setRelationsFocus] = useState<string | null>(null)
  const [readerSearchSignal, setReaderSearchSignal] = useState(0)
  const [relationsSearchSignal, setRelationsSearchSignal] = useState(0)
  const [librarySearchSignal, setLibrarySearchSignal] = useState(0)
  const handledLibrarySearch = useRef(0)

  const tabs = workspace.tabs
  const activeId = workspace.activeId
  const rail = workspace.rail
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.paperId === activeId) ?? null,
    [activeId, tabs],
  )
  const activePaper = useMemo(
    () => (activeTab ? papers.find((paper) => paper.id === activeTab.paperId) ?? null : null),
    [activeTab, papers],
  )

  const taskCenterEnabled = config?.experimentalTaskCenter === true
  const translationEnabled = config?.experimentalFullTextTranslation === true
  // The translation source experiment can be off while full-text translation is
  // on (and vice versa); the reader always sees the effective source.
  const translationSettings = useMemo<TranslationSettings>(() => {
    const settings = normalizeTranslationSettings(config?.translation)
    return {
      ...settings,
      source: config?.experimentalTranslationSources === true ? settings.source : 'dsh',
    }
  }, [config?.translation, config?.experimentalTranslationSources])
  const recentLimit = config?.recentLimit ?? DEFAULT_RECENT_LIMIT

  // Turning the experiment off while its page is open must not strand the user
  // on a view the sidebar no longer offers.
  useEffect(() => {
    if (view === 'tasks' && !taskCenterEnabled) setView('recent')
  }, [taskCenterEnabled, view])

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [author, setAuthor] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [venue, setVenue] = useState<string | null>(null)
  const [paperSearch, setPaperSearch] = useState<LibrarySearchPayload | null>(null)
  const [searchingPapers, setSearchingPapers] = useState(false)
  const [aiNotice, setAiNotice] = useState<{ action: string; onContinue?: () => void } | null>(null)
  const [folder, setFolder] = useState<FolderFilter>('all')
  const [density, setDensity] = useState<'grid' | 'list'>('list')
  const appliedDefaultView = useRef<'list' | 'grid' | null>(null)
  // Apply the configured default on first load and whenever that setting
  // changes; a manual toolbar toggle must survive unrelated config refreshes.
  useEffect(() => {
    const next = config?.libraryDefaultView === 'grid' ? 'grid' : 'list'
    if (appliedDefaultView.current === next) return
    appliedDefaultView.current = next
    setDensity(next)
  }, [config?.libraryDefaultView])
  // Recent starts from the same configured default but keeps its own toggle, so
  // switching one page does not flip the other one mid-session.
  const [recentDensity, setRecentDensity] = useState<'grid' | 'list'>('list')
  const appliedRecentDefaultView = useRef<'list' | 'grid' | null>(null)
  useEffect(() => {
    const next = config?.libraryDefaultView === 'grid' ? 'grid' : 'list'
    if (appliedRecentDefaultView.current === next) return
    appliedRecentDefaultView.current = next
    setRecentDensity(next)
  }, [config?.libraryDefaultView])
  const [organizing, setOrganizing] = useState<Paper | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [importInto, setImportInto] = useState<Folder | null>(null)
  const [jobIds, setJobIds] = useState<string[]>([])
  const [freshId, setFreshId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  const aiEnabled = config?.aiEnabled !== false
  /**
   * Gate one AI action. Pure model actions stop here; mixed actions (relation
   * rebuild) can pass `onContinue` so the user may still run the deterministic
   * half after the reminder.
   */
  const guardAi = useCallback((action: string, onContinue?: () => void): boolean => {
    if (config?.aiEnabled !== false) return true
    setAiNotice({ action, ...(onContinue ? { onContinue } : {}) })
    return false
  }, [config?.aiEnabled])

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
  }, [])

  const loadLibrary = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!options.quiet) setLoading(true)
    try {
      const payload = await api.library()
      setPapers(payload.papers)
      setFolders(payload.folders)
      setTrash(payload.trash ?? [])
      setError(null)
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      if (!options.quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api.config())
    } catch {
      // The library request already reports a host outage; keep last config.
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  /** The fixed 文献库 entry always lands on the library, never on the last page. */
  const openLibrary = useCallback(() => {
    setView('library')
    setWorkspace((current) => (
      current.activeId === null ? current : { ...current, activeId: null }
    ))
    // Reading updates progress/lastRead on the host; the library cards should
    // show those as soon as the user comes back.
    void loadLibrary({ quiet: true })
  }, [loadLibrary])

  /** Open the search that belongs to the page the user is looking at. */
  const openPluginSearch = useCallback(() => {
    if (activeTab) {
      setReaderSearchSignal((value) => value + 1)
      return
    }
    if (view === 'relations') {
      setRelationsSearchSignal((value) => value + 1)
      return
    }
    if (view !== 'library') setView('library')
    setLibrarySearchSignal((value) => value + 1)
  }, [activeTab, view])

  // Focus after the library has actually rendered: switching from settings or
  // recent to the library is a state change, not an immediate DOM swap.
  useEffect(() => {
    if (librarySearchSignal <= 0 || librarySearchSignal === handledLibrarySearch.current) return undefined
    if (view !== 'library') return undefined
    handledLibrarySearch.current = librarySearchSignal
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [librarySearchSignal, view])

  // ⌘/Ctrl+F belongs to PaperReader while its panel is visible. DSH keeps its
  // workspace palette on `session.search` (⌘/Ctrl+K); taking the find gesture
  // in the capture phase keeps the browser's own find bar closed without
  // disabling any DSH shortcut on its own pages.
  useEffect(() => {
    const isPluginVisible = (): boolean => {
      const root = document.querySelector<HTMLElement>('.pr-root')
      if (!root?.isConnected) return false
      // A harness dialog on top of the plugin owns the keyboard; let DSH handle
      // its own shortcuts instead of opening a search behind the modal.
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
      if (dialog && !root.contains(dialog)) return false
      for (let node: HTMLElement | null = root; node; node = node.parentElement) {
        const style = window.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
      }
      return true
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      if (!isPluginVisible()) return
      event.preventDefault()
      event.stopPropagation()
      openPluginSearch()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openPluginSearch])

  const counts = useMemo(() => ({
    all: papers.length,
    todo: papers.filter((paper) => paper.status === 'todo').length,
    reading: papers.filter((paper) => paper.status === 'reading').length,
    done: papers.filter((paper) => paper.status === 'done').length,
  }), [papers])

  // Every count below derives from the same `papers` snapshot, so a move,
  // trash, restore or tag edit updates all of them in the same render instead
  // of waiting for the next quiet refresh from the host.
  const unfiled = useMemo(
    () => papers.reduce((count, paper) => count + (paper.folder ? 0 : 1), 0),
    [papers],
  )

  const countedFolders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const paper of papers) {
      if (paper.folder) counts.set(paper.folder, (counts.get(paper.folder) ?? 0) + 1)
    }
    return folders.map((folder) => ({ ...folder, count: counts.get(folder.id) ?? 0 }))
  }, [folders, papers])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const paper of papers) {
      for (const item of paper.tags ?? []) counts.set(item, (counts.get(item) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [papers])

  const authorOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const paper of papers) {
      for (const name of paper.authors ?? []) {
        const value = name.trim()
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh'))
  }, [papers])

  const yearOptions = useMemo(
    () => [...new Set(papers.map((paper) => paper.year).filter((value): value is number => Boolean(value)))]
      .sort((left, right) => right - left),
    [papers],
  )

  const venueOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const paper of papers) {
      const value = (paper.venue ?? '').trim()
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh'))
  }, [papers])

  const recent = useMemo(
    () => papers
      .filter((paper) => Boolean(paper.lastReadAt))
      .sort((a, b) => String(b.lastReadAt).localeCompare(String(a.lastReadAt)))
      .slice(0, Math.max(1, recentLimit)),
    [papers, recentLimit],
  )

  // The local filter covers title/author/tags/tldr instantly; the host search
  // adds abstract, venue, identifiers, notes and full text after a short pause.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setPaperSearch(null)
      setSearchingPapers(false)
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchingPapers(true)
      void api.searchPapers(q, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setPaperSearch(result)
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          if ((error as Error).name !== 'AbortError') setPaperSearch(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingPapers(false)
        })
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [papers, query])

  const searchMatchMap = useMemo(
    () => new Map((paperSearch?.matches ?? []).map((match) => [match.paperId, match])),
    [paperSearch],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const serverQuery = paperSearch?.query === query.trim() ? paperSearch : null
    return papers.filter((paper) => {
      if (folder === 'unfiled' && paper.folder) return false
      if (folder !== 'all' && folder !== 'unfiled' && paper.folder !== folder) return false
      if (status !== 'all' && paper.status !== status) return false
      if (tag && !paper.tags.includes(tag)) return false
      if (author && !paper.authors.includes(author)) return false
      if (year && paper.year !== year) return false
      if (venue && paper.venue !== venue) return false
      if (!needle) return true
      const localMatch = (
        paper.title.toLowerCase().includes(needle)
        || (paper.authorLine ?? '').toLowerCase().includes(needle)
        || (paper.tldr ?? '').toLowerCase().includes(needle)
        || paper.tags.some((item) => item.toLowerCase().includes(needle))
      )
      return localMatch || Boolean(serverQuery && searchMatchMap.has(paper.id))
    })
  }, [author, folder, paperSearch, papers, query, searchMatchMap, status, tag, venue, year])

  const searchFullTextCount = useMemo(() => {
    if (paperSearch?.query !== query.trim()) return 0
    return paperSearch.matches.filter((match) => (
      match.fields.includes('note') || match.fields.includes('fulltext')
    )).length
  }, [paperSearch, query])

  const clearFilters = useCallback(() => {
    setAuthor(null)
    setYear(null)
    setVenue(null)
  }, [])

  // ── reading workspace: tabs ──────────────────────────────────────────────
  const patchTab = useCallback((paperId: string, patch: Partial<ReaderTab>) => {
    setWorkspace((current) => {
      const index = current.tabs.findIndex((tab) => tab.paperId === paperId)
      if (index < 0) return current
      const tab = current.tabs[index]
      const merged = { ...tab, ...patch }
      if (
        tab.page === merged.page
        && tab.scrollTop === merged.scrollTop
        && tab.zoom === merged.zoom
        && tab.layout === merged.layout
        && tab.aiTab === merged.aiTab
        && tab.translationView === merged.translationView
      ) return current
      const tabs = current.tabs.slice()
      tabs[index] = merged
      return { ...current, tabs }
    })
  }, [])

  const openAt = useCallback((id: string, page?: number) => {
    // Opening from a page (not from another open tab) makes that page the
    // reader's back target.
    if (activeId === null) setReaderOrigin(view)
    const paper = papers.find((item) => item.id === id)
    const target = page ?? paper?.lastReadPage ?? 1
    setWorkspace((current) => {
      const existing = current.tabs.find((tab) => tab.paperId === id)
      if (existing) {
        if (page === undefined || page === existing.page) return { ...current, activeId: id }
        return {
          ...current,
          activeId: id,
          tabs: current.tabs.map((tab) => (
            tab.paperId === id ? { ...tab, page: Math.max(1, page), scrollTop: 0 } : tab
          )),
        }
      }
      return {
        ...current,
        activeId: id,
        tabs: [...current.tabs, createTab(id, target, current.layout)],
      }
    })
  }, [activeId, papers, view])

  const closeTabsFor = useCallback((paperIds: string[]) => {
    const drop = new Set(paperIds)
    if (drop.size === 0) return
    setWorkspace((current) => {
      if (!current.tabs.some((tab) => drop.has(tab.paperId))) return current
      return {
        ...current,
        tabs: current.tabs.filter((tab) => !drop.has(tab.paperId)),
        activeId: neighborAfter(current.tabs, drop, current.activeId),
      }
    })
  }, [])

  const closeTab = useCallback((paperId: string) => {
    closeTabsFor([paperId])
  }, [closeTabsFor])

  const activateTab = useCallback((paperId: string) => {
    // Resuming a tab from a page uses that page as the back target; switching
    // between open tabs while already reading keeps the original target.
    if (activeId === null) setReaderOrigin(view)
    setWorkspace((current) => (
      current.activeId === paperId ? current : { ...current, activeId: paperId }
    ))
  }, [activeId, view])

  /** Reading-only back arrow: return to the page the paper was opened from. */
  const backFromReader = useCallback(() => {
    setWorkspace((current) => (
      current.activeId === null ? current : { ...current, activeId: null }
    ))
    setView(readerOrigin)
    void loadLibrary({ quiet: true })
  }, [loadLibrary, readerOrigin])

  const setRail = useCallback((mode: RailMode) => {
    setWorkspace((current) => (current.rail === mode ? current : { ...current, rail: mode }))
  }, [])

  const setLayout = useCallback((layout: ReaderLayout) => {
    setWorkspace((current) => ({
      ...current,
      layout,
      tabs: current.activeId
        ? current.tabs.map((tab) => (tab.paperId === current.activeId ? { ...tab, layout } : tab))
        : current.tabs,
    }))
  }, [])

  /** Open/close the reader panel and let PDF work settle after the slide. */
  const setAiPanel = useCallback((open: boolean) => {
    if (open === aiOpen) return
    pulseLayoutMotion(240)
    setAiOpen(open)
  }, [aiOpen, setAiOpen])

  const toggleDone = useCallback((paper: Paper) => {
    const nextStatus: Status = paper.status === 'done' ? 'todo' : 'done'
    setPapers((previous) => previous.map((item) => (
      item.id === paper.id ? { ...item, status: nextStatus } : item
    )))
    void api.patchPaper(paper.id, { status: nextStatus }).catch((mutationError) => {
      showToast((mutationError as Error).message)
      void loadLibrary({ quiet: true })
    })
  }, [loadLibrary, showToast])

  // The workspace is a cache of the reading state, not the library: persist it
  // on every change (debounced) so a reload or a panel switch restores tabs.
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  useEffect(() => () => saveWorkspace(workspaceRef.current), [])
  useEffect(() => {
    const timer = window.setTimeout(() => saveWorkspace(workspace), 160)
    return () => window.clearTimeout(timer)
  }, [workspace])

  // A paper trashed in another session must not leave a dead tab behind.
  useEffect(() => {
    if (loading || error) return
    const keep = new Set(papers.map((paper) => paper.id))
    setWorkspace((current) => pruneWorkspace(current, keep))
  }, [error, loading, papers])

  const handleImport = useCallback(async (request: ImportRequest, onProgress: ImportProgress) => {
    const targetFolder = importInto?.id ?? null
    if (request.kind === 'pdf') {
      const total = request.files.length
      const created: string[] = []
      const failures: string[] = []
      for (let index = 0; index < total; index += 1) {
        const file = request.files[index]
        onProgress(index, total, file.name)
        try {
          const result = await api.importPdf(file, targetFolder)
          created.push(result.jobId)
        } catch (importError) {
          failures.push(`${file.name}：${(importError as Error).message}`)
        }
        onProgress(index + 1, total, file.name)
      }
      if (created.length === 0) {
        throw new Error(`上传失败：${failures[0] ?? '没有可导入的文件'}`)
      }
      setJobIds((previous) => [...previous, ...created])
      if (failures.length > 0) {
        showToast(`${failures.length} 个文件上传失败，其余已加入队列`)
      }
    } else {
      onProgress(0, 1, '解析标识符')
      const result = await api.importLink(request.url, targetFolder)
      setJobIds((previous) => [...previous, result.jobId])
      onProgress(1, 1, '已加入队列')
    }
  }, [importInto, showToast])

  // ── library mutations ────────────────────────────────────────────────────
  const movePaper = useCallback(async (paper: Paper, nextFolder: string | null) => {
    setPapers((previous) => previous.map((item) => (
      item.id === paper.id ? { ...item, folder: nextFolder } : item
    )))
    try {
      await api.patchPaper(paper.id, { folder: nextFolder } as Partial<Paper>)
    } catch (mutationError) {
      showToast((mutationError as Error).message)
      void loadLibrary({ quiet: true })
    }
  }, [loadLibrary, showToast])

  const saveTags = useCallback(async (paper: Paper, nextTags: string[]) => {
    setPapers((previous) => previous.map((item) => (
      item.id === paper.id ? { ...item, tags: nextTags } : item
    )))
    try {
      await api.patchPaper(paper.id, { tags: nextTags } as Partial<Paper>)
      void loadLibrary({ quiet: true })
    } catch (mutationError) {
      showToast((mutationError as Error).message)
      void loadLibrary({ quiet: true })
    }
  }, [loadLibrary, showToast])

  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    try {
      const folderRecord = await api.addFolder(name, parentId)
      setFolders((previous) => [...previous, { ...folderRecord, count: 0 }])
      showToast(`已创建「${folderRecord.name}」`)
      return true
    } catch (mutationError) {
      showToast((mutationError as Error).message)
      return false
    }
  }, [showToast])

  const renameFolder = useCallback(async (target: Folder, name: string) => {
    try {
      const next = await api.renameFolder(target.id, name)
      setFolders((previous) => previous.map((entry) => (
        entry.id === target.id ? { ...entry, name: next.name } : entry
      )))
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [showToast])

  const deleteFolder = useCallback(async (target: Folder) => {
    try {
      const result = await api.removeFolder(target.id)
      const removed = new Set(result.removed ?? [target.id])
      setFolders((previous) => previous.filter((entry) => !removed.has(entry.id)))
      setPapers((previous) => previous.map((paper) => (
        paper.folder && removed.has(paper.folder) ? { ...paper, folder: null } : paper
      )))
      if (folder !== 'all' && folder !== 'unfiled' && folder !== 'trash' && removed.has(folder)) {
        setFolder('all')
      }
      showToast(`已删除「${target.name}」，其中的论文回到未分类`)
      void loadLibrary({ quiet: true })
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [folder, loadLibrary, showToast])

  const moveFolder = useCallback(async (target: Folder, parentId: string | null, beforeId: string | null) => {
    try {
      const view = await api.moveFolder(target.id, parentId, beforeId)
      setFolders(view.folders)
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [showToast])

  // ── recycle bin ──────────────────────────────────────────────────────────
  const trashPaper = useCallback(async (paper: Paper) => {
    try {
      const result = await api.trashPaper(paper.id)
      setPapers((previous) => previous.filter((item) => item.id !== paper.id))
      setTrash((previous) => [{ ...paper, deletedAt: result.deletedAt }, ...previous])
      setOrganizing(null)
      closeTabsFor([paper.id])
      showToast('已移入回收站')
      void loadLibrary({ quiet: true })
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [loadLibrary, showToast])

  const restorePaper = useCallback(async (paper: Paper) => {
    try {
      const restored = await api.restorePaper(paper.id)
      setTrash((previous) => previous.filter((item) => item.id !== paper.id))
      // Optimistically put it back on the active shelf so every derived count
      // (unfiled, folder, tags, status totals) steps immediately; the quiet
      // refresh below reconciles the canonical order.
      setPapers((previous) => [restored, ...previous])
      showToast(`已还原「${paper.title || '这篇论文'}」`)
      void loadLibrary({ quiet: true })
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [loadLibrary, showToast])

  const purgePaper = useCallback(async (paper: Paper) => {
    try {
      await api.purgePaper(paper.id)
      setTrash((previous) => previous.filter((item) => item.id !== paper.id))
      closeTabsFor([paper.id])
      showToast('已彻底删除')
      void loadLibrary({ quiet: true })
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [loadLibrary, showToast])

  const emptyTrash = useCallback(async () => {
    const removed = trash.map((paper) => paper.id)
    try {
      const result = await api.emptyTrash()
      setTrash([])
      closeTabsFor(removed)
      showToast(`已清空回收站（${result.count} 篇）`)
      void loadLibrary({ quiet: true })
    } catch (mutationError) {
      showToast((mutationError as Error).message)
    }
  }, [closeTabsFor, loadLibrary, showToast, trash])

  const openImport = useCallback((target: Folder | null = null) => {
    setImportInto(target)
    setDialogOpen(true)
  }, [])

  return (
    <div
      className="pr-root"
      data-scheme={scheme}
      style={accentStyle}
    >
      <TopBar
        tabs={tabs}
        activeId={activeId}
        papers={papers}
        homeActive={view === 'library' && activeId === null}
        onBack={backFromReader}
        onLibrary={openLibrary}
        onActivate={activateTab}
        onClose={closeTab}
      />

      {activeTab ? (
        <Reader
          key={activeTab.paperId}
          paperId={activeTab.paperId}
          paper={activePaper}
          initialPage={activeTab.page}
          initialScrollTop={activeTab.scrollTop}
          layout={activeTab.layout}
          zoom={activeTab.zoom}
          rail={rail}
          aiTab={activeTab.aiTab}
          translationView={activeTab.translationView}
          translationEnabled={translationEnabled}
          translationSettings={translationSettings}
          aiOpen={aiOpen}
          onAiOpen={setAiPanel}
          onLayout={setLayout}
          onToggleDone={toggleDone}
          onRail={setRail}
          onState={(patch) => patchTab(activeTab.paperId, patch)}
          onOpenPaper={(id) => openAt(id)}
          onShowRelations={(id) => {
            setRelationsFocus(id)
            setWorkspace((current) => ({ ...current, activeId: null }))
            setView('relations')
            void loadLibrary({ quiet: true })
          }}
          onToast={showToast}
          searchSignal={readerSearchSignal}
          aiEnabled={aiEnabled}
          onAiBlocked={guardAi}
          onPaperChanged={() => void loadLibrary({ quiet: true })}
        />
      ) : (
        <div className="pr-shell">
          <aside className="pr-nav" ref={navPane.ref} style={{ width: navPane.width }}>
            <button className="pr-btn pr-nav-import" data-primary onClick={() => openImport(null)}>
              <IconPlus size={14} />
              导入论文
            </button>
            <hr className="pr-nav-sep" />
            <nav className="pr-nav-group">
              <NavItem
                icon={<IconClock size={15} />}
                label="最近阅读"
                count={recent.length}
                active={view === 'recent'}
                onClick={() => setView('recent')}
              />
              <NavItem
                icon={<IconLibrary size={15} />}
                label="文献库"
                count={papers.length}
                active={view === 'library'}
                onClick={openLibrary}
              />
              <NavItem
                icon={<IconSpark size={15} />}
                label="关联"
                active={view === 'relations'}
                onClick={() => {
                  setRelationsFocus(null)
                  setView('relations')
                }}
              />
              {taskCenterEnabled ? (
                <NavItem
                  icon={<IconActivity size={15} />}
                  label="任务列表"
                  active={view === 'tasks'}
                  onClick={() => setView('tasks')}
                />
              ) : null}
              <NavItem
                icon={<IconGear size={15} />}
                label="系统设置"
                active={view === 'settings'}
                onClick={() => setView('settings')}
              />
            </nav>
            <div className="pr-nav-foot" title={`构建 ${__PR_BUILD__}`}>
              PaperReader v{__PR_VERSION__}
            </div>
            <PaneResizer label="调整主页面导航宽度" {...navPane.handle} />
          </aside>

          <main className="pr-content">
            {view === 'recent' ? (
              <RecentPage
                papers={recent}
                folders={countedFolders}
                loading={loading}
                error={error}
                density={recentDensity}
                limit={recentLimit}
                onDensity={setRecentDensity}
                onOpen={openAt}
                onImport={() => openImport(null)}
                onLibrary={openLibrary}
                onOrganize={setOrganizing}
                onRetry={() => void loadLibrary()}
              />
            ) : view === 'library' ? (
              <LibraryPage
                papers={filtered}
                all={papers}
                folders={countedFolders}
                trash={trash}
                unfiled={unfiled}
                tags={tags}
                counts={counts}
                folder={folder}
                status={status}
                tag={tag}
                query={query}
                authors={authorOptions}
                years={yearOptions}
                venues={venueOptions}
                author={author}
                year={year}
                venue={venue}
                density={density}
                loading={loading}
                error={error}
                freshId={freshId}
                searchRef={searchRef}
                searching={searchingPapers}
                searchFullTextCount={searchFullTextCount}
                onFolder={setFolder}
                onStatus={setStatus}
                onTag={setTag}
                onQuery={setQuery}
                onAuthor={setAuthor}
                onYear={setYear}
                onVenue={setVenue}
                onClearFilters={clearFilters}
                onDensity={setDensity}
                onOpen={openAt}
                onOrganize={setOrganizing}
                onImport={() => openImport(null)}
                onImportInto={(target) => openImport(target)}
                onCreateFolder={createFolder}
                onRenameFolder={renameFolder}
                onDeleteFolder={deleteFolder}
                onMoveFolder={moveFolder}
                onRestorePaper={restorePaper}
                onPurgePaper={purgePaper}
                onEmptyTrash={emptyTrash}
                onRetry={() => void loadLibrary()}
              />
            ) : view === 'relations' ? (
              <RelationsPage
                papers={papers}
                focusId={relationsFocus}
                onOpen={openAt}
                onToast={showToast}
                searchSignal={relationsSearchSignal}
                aiEnabled={aiEnabled}
                onAiBlocked={guardAi}
              />
            ) : view === 'tasks' ? (
              <TasksPage onOpen={openAt} onToast={showToast} />
            ) : (
              <SettingsPage
                ctx={ctx}
                onToast={showToast}
                onChanged={() => void loadLibrary({ quiet: true })}
                onConfig={setConfig}
              />
            )}
          </main>


        </div>
      )}

      {dialogOpen ? (
        <ImportDialog
          targetFolder={importInto}
          onClose={() => {
            setDialogOpen(false)
            setImportInto(null)
          }}
          onStart={async (request, onProgress) => {
            await handleImport(request, onProgress)
            setDialogOpen(false)
          }}
        />
      ) : null}

      {organizing ? (
        <OrganizeDialog
          paper={organizing}
          folders={countedFolders}
          onClose={() => setOrganizing(null)}
          onMove={(nextFolder) => {
            void movePaper(organizing, nextFolder)
            setOrganizing({ ...organizing, folder: nextFolder })
          }}
          onTags={(nextTags) => {
            void saveTags(organizing, nextTags)
            setOrganizing({ ...organizing, tags: nextTags })
          }}
          onDelete={() => void trashPaper(organizing)}
        />
      ) : null}

      {jobIds.length > 0 ? (
        <JobQueue
          jobIds={jobIds}
          onClose={() => {
            setJobIds([])
            setImportInto(null)
          }}
          onFinished={(paperId) => {
            setFreshId(paperId)
            setView('library')
            setFolder(importInto ? importInto.id : 'all')
            setStatus('all')
            setTag(null)
            setAuthor(null)
            setYear(null)
            setVenue(null)
            showToast(
              importInto
                ? `已导入到「${importInto.name}」`
                : aiEnabled
                  ? '已导入并生成导读'
                  : '已导入（AI 已关闭，未生成导读）',
            )
            void loadLibrary({ quiet: true })
          }}
        />
      ) : null}

      {aiNotice ? (
        <div className="pr-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAiNotice(null)
        }}>
          <div className="pr-dialog pr-ai-notice" data-narrow role="alertdialog" aria-modal="true" aria-label="AI 功能已关闭">
            <div className="pr-dlg-head" data-stacked>
              <div className="pr-dlg-head-row">
                <div className="pr-dlg-icon"><IconSpark size={15} /></div>
                <b>AI 功能已关闭</b>
              </div>
              <div className="pr-dlg-sub">
                「{aiNotice.action}」需要调用模型并消耗 token。请先在「系统设置 → 模型」里打开 AI 功能。
              </div>
            </div>
            <div className="pr-dlg-foot" data-inline>
              {aiNotice.onContinue ? (
                <button
                  type="button"
                  className="pr-btn"
                  data-primary
                  onClick={() => {
                    const run = aiNotice.onContinue
                    setAiNotice(null)
                    run?.()
                  }}
                >
                  继续（仅确定性部分）
                </button>
              ) : null}
              <button
                type="button"
                className="pr-btn"
                data-primary={!aiNotice.onContinue || undefined}
                onClick={() => {
                  setAiNotice(null)
                  setWorkspace((current) => ({ ...current, activeId: null }))
                  setView('settings')
                }}
              >
                去设置
              </button>
              <button type="button" className="pr-btn" data-ghost onClick={() => setAiNotice(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="pr-toast">{toast}</div> : null}
    </div>
  )
}
