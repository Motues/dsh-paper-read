/**
 * 关联图谱：图谱 / 列表双视图 + 检查器。
 *
 * The page is deliberately stateful in one place: filters, selection and the
 * search prefix language all produce the same three sets (hidden / dimmed /
 * matched) that both views and the inspector read.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EdgeKind,
  Paper,
  RelationGraph,
  RelationGraphEdge,
  RelationInsight,
  SearchHit,
} from '../../types.js'
import { EDGE_KINDS, EDGE_LABEL } from '../../types.js'
import { api, watchJob } from '../../lib/api.js'
import { PageHead } from '../../components/PageHead.js'
import { IconFit, IconGrid, IconHelp, IconList, IconSearch, IconSparkLink } from '../../components/ui.js'
import { GraphCanvas } from './GraphCanvas.js'
import { Inspector } from './Inspector.js'
import { RelationList } from './RelationList.js'
import { KIND_META } from './palette.js'
import { matchGraph, parseQuery, edgeMatchesKinds } from './query.js'
import { lineage as lineageOf, neighbourRanks } from './relevance.js'
import { RelationsGuide } from './RelationsGuide.js'
import { readGuidePreference, writeGuidePreference } from './guide.js'

export interface RelationsPageProps {
  papers: Paper[]
  onOpen: (paperId: string, page?: number) => void
  onToast: (text: string) => void
  focusId?: string | null
  /** Preview-only: open in list mode without a user click. */
  initialMode?: 'graph' | 'list'
  /** Bumped by the shell when Ctrl/⌘+F targets this page's search. */
  searchSignal?: number
  /** Global AI switch; false keeps deterministic edges but skips model work. */
  aiEnabled: boolean
  onAiBlocked: (action: string, onContinue?: () => void) => void
}

function emptyGraph(papers: Paper[]): RelationGraph {
  return {
    generatedAt: new Date().toISOString(),
    nodes: papers.map((paper) => ({
      id: paper.id,
      title: paper.title,
      year: paper.year,
      venue: paper.venue,
      tldr: paper.tldr,
      tags: paper.tags ?? [],
      cluster: 'solo',
      degree: 0,
      weight: 0,
      isolated: true,
      missing: paper.missing,
      hasProfile: false,
    })),
    edges: [],
    clusters: [{ id: 'solo', label: '未关联', paperIds: papers.map((paper) => paper.id), color: -1, aiNamed: false }],
    stats: {
      papers: papers.length,
      hidden: 0,
      edges: 0,
      confirmed: 0,
      suggested: 0,
      isolated: papers.length,
      coverage: 0,
      ai: false,
    },
  }
}

/** Old host (no /relations/graph yet): stitch a minimal graph from the legacy endpoints. */
async function fallbackGraph(papers: Paper[]): Promise<RelationGraph> {  const payload = await api.allRelations()
  const base = emptyGraph(papers)
  if (payload.edges.length === 0) return base
  const degree = new Map<string, number>()
  const weight = new Map<string, number>()
  for (const edge of payload.edges) {
    for (const id of [edge.from.id, edge.to.id]) {
      degree.set(id, (degree.get(id) ?? 0) + 1)
      weight.set(id, (weight.get(id) ?? 0) + edge.confidence)
    }
  }
  const nodes = base.nodes.map((node) => ({
    ...node,
    degree: degree.get(node.id) ?? 0,
    weight: weight.get(node.id) ?? 0,
    isolated: (degree.get(node.id) ?? 0) === 0,
  }))
  const covered = new Set<string>()
  for (const edge of payload.edges) {
    covered.add(edge.from.id)
    covered.add(edge.to.id)
  }
  return {
    ...base,
    nodes,
    edges: payload.edges.map((edge) => ({
      id: edge.id,
      from: edge.from.id,
      to: edge.to.id,
      kind: edge.kind,
      reason: edge.reason,
      confidence: edge.confidence,
      status: edge.status ?? 'confirmed',
      signals: edge.signals,
      evidence: edge.evidence,
      origin: edge.origin,
    })),
    stats: {
      papers: papers.length,
      hidden: 0,
      edges: payload.edges.length,
      confirmed: payload.edges.filter((edge) => (edge.status ?? 'confirmed') === 'confirmed').length,
      suggested: payload.edges.filter((edge) => edge.status === 'suggested').length,
      isolated: nodes.filter((node) => node.isolated).length,
      coverage: papers.length > 0 ? covered.size / papers.length : 0,
      ai: false,
    },
  }
}

function isGraphPayload(value: unknown): value is RelationGraph {
  const graph = value as RelationGraph | null
  return Boolean(
    graph
    && Array.isArray(graph.nodes)
    && Array.isArray(graph.edges)
    && Array.isArray(graph.clusters)
    && graph.stats
    && typeof graph.stats.papers === 'number',
  )
}

export function RelationsPage({
  papers,
  onOpen,
  onToast,
  focusId,
  initialMode = 'graph',
  searchSignal = 0,
  aiEnabled,
  onAiBlocked,
}: RelationsPageProps) {
  const [graph, setGraph] = useState<RelationGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null)
  const [mode, setMode] = useState<'graph' | 'list'>(initialMode)
  /** Show only the selected paper's two-hop neighbourhood. */
  const [focusMode, setFocusMode] = useState(false)
  const graphFocusRef = useRef<string | null>(null)
  // `null` means the guide has never been dismissed: show it once, then stay
  // quiet unless the user ticks "自动打开" in the footer.
  const [guideOpen, setGuideOpen] = useState(() => readGuidePreference() !== 'off')
  const [guideAuto, setGuideAuto] = useState(() => readGuidePreference() === 'on')
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<EdgeKind>>(new Set())
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [hitsFor, setHitsFor] = useState('')
  const [searching, setSearching] = useState(false)
  const [insights, setInsights] = useState<Map<string, RelationInsight | null>>(new Map())
  const [insightLoading, setInsightLoading] = useState(false)
  const [rebuildJob, setRebuildJob] = useState<string | null>(null)
  const [rebuildText, setRebuildText] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)
  // A remount (leaving and returning to the page) must not replay the signal.
  const handledSearchSignal = useRef(searchSignal)

  const paperMap = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers])

  // The shell owns the global search shortcut; a bump focuses this page's
  // search without letting DSH's session search open.
  useEffect(() => {
    if (searchSignal <= 0 || searchSignal === handledSearchSignal.current) return
    handledSearchSignal.current = searchSignal
    searchRef.current?.focus()
    searchRef.current?.select()
  }, [searchSignal])

  // Both are views of the payload the page already has; selecting a paper never
  // needs another request.
  const ranks = useMemo(
    () => (graph && selectedId ? neighbourRanks(selectedId, graph.edges) : []),
    [graph, selectedId],
  )
  const lineage = useMemo(
    () => (graph && selectedId ? lineageOf(selectedId, graph.edges) : { prior: [], derivative: [] }),
    [graph, selectedId],
  )

  const loadGraph = useCallback(async ({ quiet = false, focus = null }: { quiet?: boolean; focus?: string | null } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const payload = await api.relationGraph(focus ? { focus, depth: 2 } : {})
      if (!isGraphPayload(payload)) {
        throw Object.assign(new Error('关联接口还是旧版本'), { status: 404 })
      }
      setGraph(payload)
      setDegraded(false)
      setError(null)
    } catch (loadError) {
      const status = (loadError as { status?: number }).status
      if (status === 404 || status === 503) {
        try {
          setGraph(await fallbackGraph(papers))
          setDegraded(true)
          setError(null)
        } catch (fallbackError) {
          setError((fallbackError as Error).message)
        }
      } else {
        setError((loadError as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }, [papers])

  // Refetch only when the effective focus changes: selecting a paper in the
  // full-library view must not reload the graph.
  const graphFocus = focusMode ? selectedId : null
  useEffect(() => {
    graphFocusRef.current = graphFocus
    void loadGraph({ focus: graphFocus })
  }, [graphFocus, loadGraph])

  useEffect(() => {
    if (focusId) setSelectedId(focusId)
  }, [focusId])

  // ── insight (lazy, cached per paper) ────────────────────────────────────
  const insightFor = selectedId ? insights.get(selectedId) : undefined
  const insightRequest = useRef(0)
  useEffect(() => {
    if (!aiEnabled || !selectedId || !graph?.stats.ai || insights.has(selectedId) || insightLoading) return
    const token = insightRequest.current + 1
    insightRequest.current = token
    setInsightLoading(true)
    api.relationInsight(selectedId)
      .then(({ insight }) => {
        if (insightRequest.current !== token) return
        setInsights((previous) => new Map(previous).set(selectedId, insight))
        setInsightLoading(false)
      })
      .catch(() => {
        if (insightRequest.current !== token) return
        setInsights((previous) => new Map(previous).set(selectedId, null))
        setInsightLoading(false)
      })
  }, [aiEnabled, selectedId, graph?.stats.ai, insights, insightLoading])

  const requestInsight = useCallback(async (refresh = false) => {
    if (!selectedId) return
    if (!aiEnabled) {
      onAiBlocked('生成关联综述')
      return
    }
    setInsightLoading(true)
    try {
      const { insight } = await api.relationInsight(selectedId, refresh)
      setInsights((previous) => new Map(previous).set(selectedId, insight))
      if (!insight) onToast('模型没有返回可用的关联综述')
    } catch (insightError) {
      onToast((insightError as Error).message)
    } finally {
      setInsightLoading(false)
    }
  }, [aiEnabled, onAiBlocked, onToast, selectedId])

  // ── rebuild job ─────────────────────────────────────────────────────────
  const startRebuild = useCallback(async () => {
    if (rebuildJob) return
    try {
      const { jobId } = await api.rebuildRelations()
      setRebuildJob(jobId)
      setRebuildText('排队中…')
    } catch (rebuildError) {
      onToast((rebuildError as Error).message)
    }
  }, [onToast, rebuildJob])

  const rebuild = useCallback(() => {
    if (!aiEnabled) {
      onAiBlocked('重建关联', () => { void startRebuild() })
      return
    }
    void startRebuild()
  }, [aiEnabled, onAiBlocked, startRebuild])

  useEffect(() => {
    if (!rebuildJob) return
    const stop = watchJob(rebuildJob, (job) => {
      const running = job.steps.find((step) => step.state === 'running')
      const failed = job.steps.find((step) => step.state === 'failed')
      if (running) setRebuildText(`${running.label}${running.detail ? ` · ${running.detail}` : ''}`)
      else if (job.state === 'queued') setRebuildText('排队中…')
      else if (failed) setRebuildText(`${failed.label}失败`)
      if (job.state === 'done') {
        stop()
        setRebuildJob(null)
        setInsights(new Map())
        void loadGraph({ quiet: true, focus: graphFocusRef.current })
        onToast('关联已重建')
      } else if (job.state === 'failed') {
        stop()
        setRebuildJob(null)
        onToast(job.error ? `重建失败：${job.error}` : '重建失败')
      }
    })
    return stop
  }, [loadGraph, onToast, rebuildJob])

  // ── filters ─────────────────────────────────────────────────────────────
  const parsed = useMemo(() => parseQuery(query), [query])
  const matches = useMemo(
    () => (graph ? matchGraph(parsed, graph, paperMap) : null),
    [parsed, graph, paperMap],
  )

  const hiddenNodes = useMemo(() => {
    const set = new Set<string>()
    if (!graph) return set
    if (clusterId) {
      for (const node of graph.nodes) if (node.cluster !== clusterId) set.add(node.id)
    }
    return set
  }, [clusterId, graph])

  const hiddenEdges = useMemo(() => {
    const set = new Set<string>()
    if (!graph) return set
    for (const edge of graph.edges) {
      if (!edgeMatchesKinds(edge, kinds)) {
        set.add(edge.id)
        continue
      }
      if (parsed.kinds.length > 0 && !parsed.kinds.includes(edge.kind)) {
        set.add(edge.id)
        continue
      }
      if (clusterId && graph.nodes.some((node) => node.id === edge.from && node.cluster !== clusterId)) {
        set.add(edge.id)
        continue
      }
      if (clusterId && graph.nodes.some((node) => node.id === edge.to && node.cluster !== clusterId)) {
        set.add(edge.id)
      }
    }
    return set
  }, [clusterId, graph, kinds, parsed.kinds])

  const dimNodes = useMemo(() => {
    const set = new Set<string>()
    if (!graph || !matches || matches.empty) return set
    for (const node of graph.nodes) if (!matches.nodes.has(node.id)) set.add(node.id)
    return set
  }, [graph, matches])

  const dimEdges = useMemo(() => {
    const set = new Set<string>()
    if (!graph || !matches || matches.empty) return set
    for (const edge of graph.edges) if (!matches.edges.has(edge.id)) set.add(edge.id)
    return set
  }, [graph, matches])

  const listNodes = useMemo(() => {
    if (!graph) return []
    return graph.nodes.filter((node) => (
      !hiddenNodes.has(node.id) && (!matches || matches.empty || matches.nodes.has(node.id))
    ))
  }, [graph, hiddenNodes, matches])

  const listEdges = useMemo(() => {
    if (!graph) return []
    return graph.edges.filter((edge) => (
      !hiddenEdges.has(edge.id) && (!matches || matches.empty || matches.edges.has(edge.id))
    ))
  }, [graph, hiddenEdges, matches])

  const kindCounts = useMemo(() => {
    const counts = new Map<EdgeKind, number>()
    for (const edge of graph?.edges ?? []) counts.set(edge.kind, (counts.get(edge.kind) ?? 0) + 1)
    return counts
  }, [graph])

  // ── actions ─────────────────────────────────────────────────────────────
  const closeGuide = useCallback(() => {
    setGuideOpen(false)
    writeGuidePreference(guideAuto ? 'on' : 'off')
  }, [guideAuto])

  const changeGuideAuto = useCallback((next: boolean) => {
    setGuideAuto(next)
    writeGuidePreference(next ? 'on' : 'off')
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    const element = inspectorRef.current
    if (id && element && typeof element.scrollTo === 'function') {
      element.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  const feedback = useCallback(async (edge: RelationGraphEdge, action: 'accept' | 'reject') => {
    setGraph((previous) => {
      if (!previous) return previous
      if (action === 'reject') {
        return {
          ...previous,
          edges: previous.edges.filter((item) => item.id !== edge.id),
          stats: { ...previous.stats, edges: Math.max(0, previous.stats.edges - 1) },
        }
      }
      return {
        ...previous,
        edges: previous.edges.map((item) => (
          item.id === edge.id ? { ...item, status: 'confirmed', confidence: Math.max(item.confidence, 0.7) } : item
        )),
      }
    })
    try {
      await api.relationFeedback({ from: edge.from, to: edge.to, kind: edge.kind, action })
      onToast(action === 'accept' ? '已接受这条关联' : '已忽略，重建时不会再出现')
      void loadGraph({ quiet: true, focus: graphFocusRef.current })
    } catch (feedbackError) {
      onToast((feedbackError as Error).message)
      void loadGraph({ quiet: true, focus: graphFocusRef.current })
    }
  }, [loadGraph, onToast])

  const runSearch = useCallback(async () => {
    const text = parsed.text
    if (!text || searching) return
    setSearching(true)
    try {
      const result = await api.search(text, { limit: 8 })
      setHits(result.hits)
      setHitsFor(text)
    } catch (searchError) {
      onToast((searchError as Error).message)
    } finally {
      setSearching(false)
    }
  }, [onToast, parsed.text, searching])

  const openHit = useCallback((hit: SearchHit) => {
    onOpen(hit.paperId, hit.page)
  }, [onOpen])

  // ── keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // The guide owns the keyboard while it is open (Esc closes it).
      if (guideOpen) return
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (typing) {
        if (event.key === 'Escape') {
          if (query) setQuery('')
          else searchRef.current?.blur()
        }
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setGuideOpen(true)
      } else if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'g') {
        setMode('graph')
      } else if (event.key === 'l') {
        setMode('list')
      } else if (event.key === 'Escape') {
        if (query) setQuery('')
        else setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guideOpen, query])

  const toggleKind = (kind: EdgeKind): void => {
    setKinds((previous) => {
      const next = new Set(previous)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const headerSub = graph
    ? `${graph.stats.hidden > 0 ? `显示 ${graph.nodes.length} / ` : ''}${graph.stats.papers} 篇`
      + ` · ${graph.stats.edges} 条关联 · 覆盖率 ${Math.round(graph.stats.coverage * 100)}%`
      + (graph.stats.hidden > 0 ? ` · 折叠 ${graph.stats.hidden} 篇` : '')
    : `${papers.length} 篇论文`

  return (
    <div className="pr-page pr-relpage">
      <PageHead title="关联图谱" sub={headerSub}>
        <div className="pr-viewtoggle" role="group" aria-label="视图切换">
          <button type="button" data-on={mode === 'graph' || undefined} title="图谱视图" onClick={() => setMode('graph')}>
            <IconGrid size={13} />
            图谱
          </button>
          <button type="button" data-on={mode === 'list' || undefined} title="列表视图" onClick={() => setMode('list')}>
            <IconList size={13} />
            列表
          </button>
        </div>
        <button
          type="button"
          className="pr-btn pr-help"
          data-sm
          data-ghost
          title="使用指南（?）"
          onClick={() => setGuideOpen(true)}
        >
          <IconHelp size={13} />
          指南
        </button>
        <button
          type="button"
          className="pr-btn"
          data-sm
          data-ghost={!focusMode || undefined}
          data-primary={focusMode || undefined}
          aria-pressed={focusMode}
          disabled={!selectedId}
          title={selectedId ? '只显示这篇论文的两跳邻域' : '先选中一篇论文'}
          onClick={() => setFocusMode((value) => !value)}
        >
          <IconFit size={13} />
          焦点 2 跳
        </button>
        <button
          type="button"
          className="pr-btn"
          data-primary
          disabled={Boolean(rebuildJob) || loading}
          onClick={() => void rebuild()}
          title={graph?.stats.aiDisabled
            ? '模型分析已关闭：只重建引用与文本信号'
            : '重新计算画像、引用、相关度、AI 判定与主题'}
        >
          <IconSparkLink size={13} />
          {rebuildJob ? rebuildText || '重建中…' : '重建关联'}
        </button>
      </PageHead>

      <div className="pr-rel-toolbar">
        <label className="pr-search pr-rel-search">
          <IconSearch size={14} />
          <input
            ref={searchRef}
            value={query}
            spellCheck={false}
            placeholder="搜索论文、作者、标签、关系理由；支持 tag: / author: / kind: / year:> / is:pending"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch()
            }}
          />
          {query ? (
            <button
              type="button"
              className="pr-search-clear"
              title="清除"
              onClick={() => { setQuery(''); setHits(null) }}
            >
              ×
            </button>
          ) : (
            <span className="pr-kbd">Ctrl F</span>
          )}
        </label>

        <div className="pr-kindchips" role="group" aria-label="关系类型">
          {EDGE_KINDS.map((kind) => {
            const count = kindCounts.get(kind) ?? 0
            const on = kinds.has(kind)
            return (
              <button
                key={kind}
                type="button"
                className="pr-kindchip"
                data-kind={kind}
                data-on={on || undefined}
                data-empty={count === 0 || undefined}
                title={KIND_META[kind].hint}
                onClick={() => toggleKind(kind)}
              >
                <i style={{ background: KIND_META[kind].color }} />
                {EDGE_LABEL[kind]}
                <b>{count}</b>
              </button>
            )
          })}
          {kinds.size > 0 ? (
            <button type="button" className="pr-kindchip" data-clear onClick={() => setKinds(new Set())}>全部</button>
          ) : null}
        </div>

        <div className="pr-rel-hint">
          {degraded ? '宿主还是旧版本：已按旧接口拼出关系图，重启后可用画像与 AI 理由。' : null}
          {!degraded && graph && !graph.stats.ai
            ? (graph.stats.aiDisabled
              ? '关联页的模型分析已关闭：当前只显示引用与文本信号。可在「设置 → 模型」里打开。'
              : '未配置模型：当前只显示引用与文本信号。')
            : null}
          {!degraded && graph?.stats.ai && graph.stats.suggested > 0
            ? `有 ${graph.stats.suggested} 条待确认，点「待确认」筛选。`
            : null}
        </div>
      </div>

      <div className="pr-rel-clusters">
        <button
          type="button"
          className="pr-cluster-chip"
          data-on={clusterId === null || undefined}
          onClick={() => setClusterId(null)}
        >
          全部
          <b>{graph?.stats.papers ?? papers.length}</b>
        </button>
        {(graph?.clusters ?? []).map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            className="pr-cluster-chip"
            data-on={clusterId === cluster.id || undefined}
            data-solo={cluster.id === 'solo' || undefined}
            title={cluster.aiNamed ? 'AI 命名' : '按概念自动命名'}
            onClick={() => setClusterId((current) => (current === cluster.id ? null : cluster.id))}
          >
            <i style={{ background: cluster.color < 0 ? 'var(--pr-ink-3)' : `var(--pr-g${cluster.color + 1})` }} />
            {cluster.label}
            <b>{cluster.paperIds.length}</b>
          </button>
        ))}
        <span className="pr-spacer" />
        <button
          type="button"
          className="pr-cluster-chip"
          data-pending={graph?.stats.suggested ? true : undefined}
          onClick={() => setQuery((current) => (current.includes('is:pending') ? current : `${current} is:pending`.trim()))}
        >
          待确认
          <b>{graph?.stats.suggested ?? 0}</b>
        </button>
        <span className="pr-rel-count">
          {graph ? `显示 ${listNodes.length} 篇 / ${listEdges.length} 条` : ''}
        </span>
      </div>

      <div className="pr-rel-body">
        {loading ? (
          <div className="pr-rel-skeleton">
            <div className="pr-rel-skeleton-nav"><i /><i /><i /><i /></div>
            <div className="pr-rel-skeleton-canvas"><i /><i /><i /></div>
          </div>
        ) : error ? (
          <div className="pr-empty-state">
            关联数据读不出来：{error}
            <button type="button" className="pr-btn" onClick={() => void loadGraph({ focus: graphFocusRef.current })}>重试</button>
          </div>
        ) : graph && mode === 'graph' ? (
          <GraphCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            clusters={graph.clusters}
            selectedId={selectedId}
            hiddenNodes={hiddenNodes}
            hiddenEdges={hiddenEdges}
            dimNodes={dimNodes}
            dimEdges={dimEdges}
            onSelect={select}
            onOpen={onOpen}
          />
        ) : graph ? (
          <RelationList
            graph={graph}
            nodes={listNodes}
            edges={listEdges}
            papers={paperMap}
            selectedId={selectedId}
            onSelect={select}
            onOpen={onOpen}
            onFeedback={(edge, action) => void feedback(edge, action)}
          />
        ) : null}

        {graph && !error ? (
          <div ref={inspectorRef} className="pr-insp-wrap">
            <Inspector
              graph={graph}
              papers={paperMap}
              selectedId={selectedId}
              insight={insightFor ?? null}
              insightLoading={insightLoading}
              hits={hits}
              hitsFor={hitsFor}
              rebuilding={Boolean(rebuildJob)}
              ranks={ranks}
              lineage={lineage}
              onSelect={select}
              onOpen={onOpen}
              onFeedback={(edge, action) => void feedback(edge, action)}
              onFilterCluster={(id) => setClusterId((current) => (current === id ? null : id))}
              onInsight={(refresh) => void requestInsight(refresh)}
              onRebuild={() => void rebuild()}
              onSearchHit={openHit}
            />
          </div>
        ) : null}
      </div>

      <RelationsGuide
        open={guideOpen}
        auto={guideAuto}
        onClose={closeGuide}
        onAutoChange={changeGuideAuto}
      />
    </div>
  )
}
