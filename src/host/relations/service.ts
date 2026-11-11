/**
 * The relation engine's facade.
 *
 * Layers, in order: AI profiles → deterministic signals + citation matching →
 * model adjudication → edge ledger → clusters and the cached insight. Every
 * entry point degrades instead of throwing when the model or the network is
 * missing, because the page must still be usable offline.
 */

import type {
  EdgeKind,
  EdgeView,
  PaperProfile,
  PaperRecord,
  ReferenceEntry,
  RelationEdge,
  RelationGraph,
  RelationGraphEdge,
  RelationGraphNode,
  RelationInsight,
  RelationStats,
  Summary,
} from '../../shared/domain.js'
import type { Summoner } from '../ai/summoner.js'
import type { Store, StoredJudgment } from '../library/store.js'
import { nowIso, truncate } from '../util/util.js'
import { buildProfile, fallbackProfile, profileContentHash } from './profile.js'
import {
  adjudicate,
  draftEdge,
  edgeStatus,
  type Judgment,
  type JudgmentCache,
} from './adjudicate.js'
import {
  buildCorpus,
  candidatesByPaper,
  citationEdges,
  shortlist,
} from './signals.js'
import {
  clusterSignature,
  clustersFrom,
  detectClusters,
  fallbackClusterLabel,
  groupClusters,
  nameClusters,
} from './cluster.js'
import { buildInsight, insightSignature } from './insight.js'
import { normalizeTitle } from './keys.js'
import { harvestReferences } from '../pdf/references.js'

export interface RelationStepReporter {
  (step: 'profiles' | 'citations' | 'pairs' | 'judge' | 'clusters', state: 'running' | 'done' | 'failed' | 'skipped', detail?: string): void
}

export interface RelationService {
  analyzePaper(paper: PaperRecord, options?: { signal?: AbortSignal; reporter?: RelationStepReporter }): Promise<{ edges: RelationEdge[]; profile: PaperProfile | null }>
  rebuild(options?: { scope?: string; signal?: AbortSignal; reporter?: RelationStepReporter }): Promise<{ papers: number; edges: number; profiles: number }>
  graph(options?: { focus?: string | null; depth?: number; limit?: number }): Promise<RelationGraph>
  relationView(paperId: string): Promise<{ paperId: string; edges: EdgeView[] }>
  insight(paperId: string, options?: { refresh?: boolean }): Promise<RelationInsight | null>
  feedback(input: { from: string; to: string; kind: string; action: 'accept' | 'reject' | 'pin' | 'delete' }): Promise<RelationEdge | null>
  invalidate(paperId: string): void
}

const EDGE_ORDER: EdgeKind[] = ['cites', 'builds-on', 'same-method', 'same-problem', 'uses', 'contradicts']

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function edgeId(edge: Pick<RelationEdge, 'from' | 'to' | 'kind'>): string {
  return `${edge.from}->${edge.to}:${edge.kind}`
}

function isDirected(kind: RelationEdge['kind']): boolean {
  return kind === 'cites' || kind === 'builds-on' || kind === 'uses'
}

/** Two records whose normalised titles match are the same paper, not a relation. */
function titleMapOf(papers: PaperRecord[]): Map<string, string> {
  return new Map(papers.map((paper) => [paper.id, normalizeTitle(paper.title)]))
}

function isDuplicateEdge(edge: Pick<RelationEdge, 'from' | 'to'>, titles: Map<string, string>): boolean {
  const title = titles.get(edge.from)
  return Boolean(title && title === titles.get(edge.to))
}

export function createRelations({
  store,
  summoner,
  log,
}: {
  store: Store
  summoner: Summoner
  log: (message: string, error?: unknown) => void
}): RelationService {
  const profileCache = new Map<string, PaperProfile | null>()
  const referenceCache = new Map<string, ReferenceEntry[]>()
  /** Papers whose reference list came from the PDF during this rebuild. */
  let harvestedReferences = 0
  /** The settings switches: either one off means no model calls here. */
  const modelEnabled = (): boolean => (
    store.config.relationsUseModel !== false && store.config.aiEnabled !== false
  )

  function invalidate(paperId: string): void {
    profileCache.delete(paperId)
    referenceCache.delete(paperId)
  }

  async function papersWithProfiles(papers: PaperRecord[]): Promise<Map<string, PaperProfile>> {
    const map = new Map<string, PaperProfile>()
    const aiOn = modelEnabled()
    for (const paper of papers) {
      const cached = profileCache.get(paper.id)
      if (!aiOn) {
        // The switch means "no model output on this page": use the deterministic
        // profile and keep any AI profile on disk untouched.
        if (cached && cached.model === 'fallback') {
          map.set(paper.id, cached)
          continue
        }
        const fallback = fallbackProfile({ paper, summary: null, pages: null })
        profileCache.set(paper.id, fallback)
        map.set(paper.id, fallback)
        continue
      }
      // A fallback left in memory by the disabled switch must not shadow the
      // AI profile that is still on disk once the switch is turned back on.
      if (!cached || cached.model === 'fallback') {
        profileCache.set(paper.id, await store.readProfile(paper.id).catch(() => null))
      }
      const current = profileCache.get(paper.id)
      if (current && current.paperId === paper.id) map.set(paper.id, current)
    }
    return map
  }

  /**
   * Stored references, else the identifiers harvested from the parsed PDF.
   *
   * Provider metadata (OpenAlex/Crossref) is authoritative when present, but
   * arXiv-native records often have no provider reference list at all. The PDF
   * always does, and it is already parsed, so the citation layer can be filled
   * locally without a network call or a model.
   */
  async function ensureReferences(paper: PaperRecord): Promise<ReferenceEntry[]> {
    if (referenceCache.has(paper.id)) return referenceCache.get(paper.id) ?? []
    const stored = await store.readReferences(paper.id).catch(() => [] as ReferenceEntry[])
    if (stored.length > 0) {
      referenceCache.set(paper.id, stored)
      return stored
    }
    const pages = await store.readPages(paper.id).catch(() => null)
    const harvested = pages && pages.length > 0 ? harvestReferences(pages) : []
    if (harvested.length >= 2) {
      await store.writeReferences(paper.id, harvested).catch(() => {})
      harvestedReferences += 1
      referenceCache.set(paper.id, harvested)
      return harvested
    }
    referenceCache.set(paper.id, stored)
    return stored
  }

  async function referencesFor(papers: PaperRecord[]): Promise<Map<string, ReferenceEntry[]>> {
    const map = new Map<string, ReferenceEntry[]>()
    await Promise.all(papers.map(async (paper) => {
      map.set(paper.id, await ensureReferences(paper))
    }))
    return map
  }

  /** Build or refresh one profile; returns the profile even when it was cached. */
  async function ensureProfile(paper: PaperRecord, { signal, force = false }: { signal?: AbortSignal; force?: boolean } = {}): Promise<PaperProfile | null> {
    const summary = await store.readSummary(paper.id).catch(() => null)
    const pages = await store.readPages(paper.id).catch(() => null)
    const source = { paper, summary: summary as Summary | null, pages }
    const hash = profileContentHash(source)
    const stored = await store.readProfile(paper.id).catch(() => null)
    if (!modelEnabled()) {
      // The switch means "make no model call", not "forget previous results":
      // build the deterministic profile in memory and leave any AI profile on
      // disk untouched for when the switch is turned back on.
      const fallback = fallbackProfile(source)
      profileCache.set(paper.id, fallback)
      return fallback
    }
    // A fallback profile is worth one more model attempt on every rebuild,
    // even though the source hash is unchanged.
    const staleFallback = stored?.model === 'fallback' && await summoner.available()
    if (!force && stored && stored.contentHash === hash && !staleFallback) {
      profileCache.set(paper.id, stored)
      return stored
    }
    const profile = await buildProfile({ summoner, source, signal })
    if (profile) {
      await store.writeProfile(paper.id, profile)
      profileCache.set(paper.id, profile)
      return profile
    }
    if (stored) profileCache.set(paper.id, stored)
    if (!stored) log(`profile unavailable: ${paper.id} ${truncate(paper.title, 60)}`)
    return stored ?? null
  }

  function judgmentCache(modelHint: () => string): JudgmentCache {
    return {
      get(key: string): Judgment | null {
        const row: StoredJudgment | undefined = store.judgments()[key]
        if (!row) return null
        if (!EDGE_ORDER.includes(row.kind as EdgeKind)) return null
        return {
          kind: row.kind as EdgeKind,
          direction: row.direction === 'a2b' || row.direction === 'b2a' ? row.direction : 'none',
          reason: row.reason,
          evidenceA: row.evidenceA ?? '',
          evidenceB: row.evidenceB ?? '',
          confidence: row.confidence,
          model: row.model,
        }
      },
      set(key: string, judgment: Judgment): void {
        store.judgments()[key] = {
          fingerprint: key,
          kind: judgment.kind,
          direction: judgment.direction,
          reason: judgment.reason,
          evidenceA: judgment.evidenceA,
          evidenceB: judgment.evidenceB,
          confidence: judgment.confidence,
          model: judgment.model ?? modelHint(),
          at: nowIso(),
        }
      },
    }
  }

  function pruneJudgments(): void {
    const rows = store.judgments()
    const keys = Object.keys(rows)
    if (keys.length <= 3000) return
    keys.sort((left, right) => String(rows[left].at).localeCompare(String(rows[right].at)))
    for (const key of keys.slice(0, keys.length - 2500)) delete rows[key]
  }

  /** Model label for a batch, resolved once per call site. */
  async function modelLabel(): Promise<string> {
    const target = await summoner.target()
    return target ? `${target.provider}/${target.model}` : ''
  }

  async function analyzePaper(
    paper: PaperRecord,
    { signal, reporter }: { signal?: AbortSignal; reporter?: RelationStepReporter } = {},
  ): Promise<{ edges: RelationEdge[]; profile: PaperProfile | null }> {
    const modelOn = modelEnabled()
    const profile = await ensureProfile(paper, { signal })
    reporter?.('profiles', profile ? 'done' : 'skipped', profile ? '画像就绪' : '未生成画像')

    const papers = store.activePapers()
    const profiles = await papersWithProfiles(papers)
    const references = await referencesFor(papers)

    reporter?.('citations', 'running')
    const citations = citationEdges({ papers, references })
    reporter?.('citations', 'done', `${citations.length} 条引用`)

    reporter?.('pairs', 'running')
    const corpus = buildCorpus({ papers, profiles, references })
    const pairs = shortlist(corpus)
    const byPaper = candidatesByPaper(pairs).get(paper.id) ?? []
    reporter?.('pairs', 'done', `${byPaper.length} 个候选`)

    let edges: RelationEdge[] = citations.filter((edge) => edge.from === paper.id || edge.to === paper.id)
    if (byPaper.length > 0 && modelOn) {
      reporter?.('judge', 'running')
      const model = await modelLabel()
      const selfTitle = normalizeTitle(paper.title)
      const candidates = byPaper
        .map((candidate) => {
          const other = papers.find((item) => item.id === candidate.other)
          if (!other) return null
          // Two records of the same paper are handled by the duplicate badge,
          // not by inventing a semantic relation.
          if (normalizeTitle(other.title) === selfTitle) return null
          return { paper: other, profile: profiles.get(other.id) ?? null, score: candidate.score, signals: candidate.signals }
        })
        .filter((value): value is NonNullable<typeof value> => value !== null)
      const judged = await adjudicate({
        summoner,
        paper,
        profile,
        candidates,
        cache: judgmentCache(() => model),
        signal,
      })
      for (const item of judged) {
        const draft = draftEdge({ paper, candidate: item.candidate, judgment: item.judgment, model })
        edges.push({
          ...draft,
          origin: 'auto',
          status: edgeStatus(draft.confidence),
          at: nowIso(),
        })
      }
      pruneJudgments()
      await store.saveMeta()
      reporter?.('judge', 'done', `${judged.length} 条判定`)
    } else {
      reporter?.(
        'judge',
        'skipped',
        modelOn ? '没有达到门槛的候选' : '关联页模型已关闭，只保留引用与文本信号',
      )
    }

    await store.upsertRelations(edges)
    return { edges, profile }
  }

  async function rebuild(
    { scope, signal, reporter }: { scope?: string; signal?: AbortSignal; reporter?: RelationStepReporter } = {},
  ): Promise<{ papers: number; edges: number; profiles: number }> {
    const all = store.activePapers()
    const targets = scope ? all.filter((paper) => paper.id === scope) : all
    if (targets.length === 0) return { papers: 0, edges: 0, profiles: 0 }
    harvestedReferences = 0
    const modelOn = modelEnabled()

    reporter?.('profiles', 'running', `0/${targets.length}`)
    let profilesBuilt = 0
    for (const [index, paper] of targets.entries()) {
      const before = profileCache.get(paper.id) ?? null
      let profile: PaperProfile | null = null
      try {
        profile = await ensureProfile(paper, { signal })
      } catch (error) {
        log(`profile failed: ${paper.id}`, error)
      }
      if (profile && (!before || before.contentHash !== profile.contentHash)) profilesBuilt += 1
      reporter?.('profiles', 'running', `${index + 1}/${targets.length}`)
      if (modelOn && index < targets.length - 1) await sleep(350)
    }
    const readyProfiles = targets.filter((paper) => profileCache.get(paper.id)).length
    reporter?.(
      'profiles',
      'done',
      `${readyProfiles}/${targets.length} 篇画像就绪${profilesBuilt > 0 ? `（新增 ${profilesBuilt}）` : ''}`,
    )

    // The corpus always spans the whole library: a scoped rebuild compares the
    // target against every paper, never against itself.
    const profiles = await papersWithProfiles(all)
    const references = await referencesFor(all)
    reporter?.('citations', 'running')
    const allCitations = citationEdges({ papers: all, references })
    const citations = scope
      ? allCitations.filter((edge) => targets.some((paper) => paper.id === edge.from || paper.id === edge.to))
      : allCitations
    reporter?.(
      'citations',
      'done',
      `${citations.length} 条引用${harvestedReferences > 0 ? ` · PDF 补 ${harvestedReferences} 篇参考文献` : ''}`,
    )

    reporter?.('pairs', 'running')
    const corpus = buildCorpus({ papers: all, profiles, references })
    const pairs = shortlist(corpus)
    const byPaper = candidatesByPaper(pairs)
    reporter?.('pairs', 'done', `${pairs.length} 对候选`)

    const edges: RelationEdge[] = [...citations]
    const model = modelOn ? await modelLabel() : ''
    if (modelOn) {
      reporter?.('judge', 'running', `0/${targets.length}`)
      const cache = judgmentCache(() => model)
      const judgedPairs = new Set<string>()
      let judgedCount = 0
      for (const [index, paper] of [...targets].sort((a, b) => a.addedAt.localeCompare(b.addedAt)).entries()) {
        const selfTitle = normalizeTitle(paper.title)
        const candidates = (byPaper.get(paper.id) ?? [])
          .filter((candidate) => {
            const key = [paper.id, candidate.other].sort().join('|')
            return !judgedPairs.has(key)
          })
          .map((candidate) => {
            const other = all.find((item) => item.id === candidate.other)
            if (!other) return null
            if (normalizeTitle(other.title) === selfTitle) return null
            return { paper: other, profile: profiles.get(other.id) ?? null, score: candidate.score, signals: candidate.signals }
          })
          .filter((value): value is NonNullable<typeof value> => value !== null)
        if (candidates.length > 0) {
          for (const candidate of candidates) judgedPairs.add([paper.id, candidate.paper.id].sort().join('|'))
          const judged = await adjudicate({ summoner, paper, profile: profiles.get(paper.id) ?? null, candidates, cache, signal })
          for (const item of judged) {
            const draft = draftEdge({ paper, candidate: item.candidate, judgment: item.judgment, model })
            edges.push({ ...draft, origin: 'auto', status: edgeStatus(draft.confidence), at: nowIso() })
          }
          judgedCount += judged.length
        }
        reporter?.('judge', 'running', `${index + 1}/${targets.length}`)
        if (index < targets.length - 1) await sleep(250)
      }
      reporter?.('judge', 'done', `${judgedCount} 条判定`)
    } else {
      reporter?.('judge', 'skipped', '关联页模型已关闭，只保留引用与文本信号')
    }

    let themeCount = 0
    if (!scope) {
      reporter?.('clusters', 'running')
      const titles = new Map(all.map((paper) => [paper.id, paper.title]))
      const detected = detectClusters(
        all.map((paper) => paper.id),
        edges.map((edge) => ({ from: edge.from, to: edge.to, weight: edge.confidence })),
      )
      const groups = groupClusters(detected, profiles, titles)
      themeCount = groups.length
      if (groups.length > 0 && modelOn) {
        const named = await nameClusters({ summoner, groups, signal })
        if (!named.model) log('cluster naming failed; using concept labels')
        store.meta.clusterNames = {
          signature: clusterSignature(groups),
          names: named.names,
          at: nowIso(),
          model: named.model,
        }
      }
      await store.replaceAutoRelations(edges)
      reporter?.('clusters', 'done', `${themeCount} 个主题`)
    } else {
      await store.replaceAutoRelationsFor(targets.map((paper) => paper.id), edges)
      reporter?.('clusters', 'skipped', '单篇重建保留现有主题')
    }

    store.meta.lastRebuild = {
      at: nowIso(),
      papers: targets.length,
      edges: edges.length,
      profiles: readyProfiles,
      model: model || undefined,
    }
    await store.saveMeta()
    return { papers: targets.length, edges: edges.length, profiles: readyProfiles }
  }

  async function currentClusters(): Promise<{
    clusters: ReturnType<typeof clustersFrom>
    labels: Map<string, string>
    groups: ReturnType<typeof groupClusters>
  }> {
    const papers = store.activePapers()
    const profiles = await papersWithProfiles(papers)
    const titles = new Map(papers.map((paper) => [paper.id, paper.title]))
    const usable = store.readRelations().filter((edge) => edge.status !== 'rejected')
    const labels = detectClusters(
      papers.map((paper) => paper.id),
      usable.map((edge) => ({ from: edge.from, to: edge.to, weight: edge.confidence })),
    )
    const groups = groupClusters(labels, profiles, titles)
    const signature = clusterSignature(groups)
    const stored = store.meta.clusterNames
    const aiOn = modelEnabled()
    const fresh = Boolean(aiOn && stored && stored.signature === signature && stored.names.length === groups.length)
    const names = fresh && stored ? stored.names : groups.map((group, index) => fallbackClusterLabel(group, index))
    const aiNamed = Boolean(fresh && stored?.model)
    const solo = papers.filter((paper) => labels.get(paper.id) === 'solo').map((paper) => paper.id)
    return { clusters: clustersFrom(groups, names, aiNamed, solo), labels, groups }
  }

  async function graph({ focus = null, depth = 2, limit = 400 }: { focus?: string | null; depth?: number; limit?: number } = {}): Promise<RelationGraph> {
    const papers = store.activePapers()
    const profileMap = await papersWithProfiles(papers)
    const { clusters, labels } = await currentClusters()
    const normalizedTitle = titleMapOf(papers)
    const edges = store.readRelations().filter((edge) => (
      edge.status !== 'rejected'
      && papers.some((paper) => paper.id === edge.from)
      && papers.some((paper) => paper.id === edge.to)
      && !isDuplicateEdge(edge, normalizedTitle)
    ))

    const duplicates = new Map<string, string>()
    const byTitle = new Map<string, string[]>()
    for (const paper of papers) {
      const key = normalizeTitle(paper.title)
      if (key.length < 12) continue
      const list = byTitle.get(key) ?? []
      list.push(paper.id)
      byTitle.set(key, list)
    }
    for (const ids of byTitle.values()) {
      if (ids.length < 2) continue
      for (const id of ids) {
        const other = ids.find((candidate) => candidate !== id)
        if (other) duplicates.set(id, other)
      }
    }

    const degree = new Map<string, number>()
    const weight = new Map<string, number>()
    for (const edge of edges) {
      for (const side of [edge.from, edge.to]) {
        degree.set(side, (degree.get(side) ?? 0) + 1)
        weight.set(side, (weight.get(side) ?? 0) + edge.confidence)
      }
    }

    let included = new Set(papers.map((paper) => paper.id))
    if (focus && included.has(focus)) {
      included = new Set([focus])
      let frontier = [focus]
      const adjacency = new Map<string, string[]>()
      for (const edge of edges) {
        const list = adjacency.get(edge.from) ?? []
        list.push(edge.to)
        adjacency.set(edge.from, list)
        const back = adjacency.get(edge.to) ?? []
        back.push(edge.from)
        adjacency.set(edge.to, back)
      }
      for (let step = 0; step < Math.max(1, depth); step += 1) {
        const next: string[] = []
        for (const id of frontier) {
          for (const other of adjacency.get(id) ?? []) {
            if (included.has(other)) continue
            included.add(other)
            next.push(other)
          }
        }
        frontier = next
        if (frontier.length === 0) break
      }
    }

    let visible = papers.filter((paper) => included.has(paper.id))
    if (visible.length > limit) {
      visible = [...visible]
        .sort((left, right) => (weight.get(right.id) ?? 0) - (weight.get(left.id) ?? 0) || left.title.localeCompare(right.title))
        .slice(0, Math.max(12, limit))
      included = new Set(visible.map((paper) => paper.id))
    }

    const nodes: RelationGraphNode[] = visible.map((paper) => ({
      id: paper.id,
      title: paper.title,
      year: paper.year,
      venue: paper.venue,
      tldr: paper.tldr,
      tags: paper.tags ?? [],
      cluster: labels.get(paper.id) ?? 'solo',
      degree: degree.get(paper.id) ?? 0,
      weight: Math.round((weight.get(paper.id) ?? 0) * 1000) / 1000,
      isolated: (degree.get(paper.id) ?? 0) === 0,
      missing: paper.missing,
      hasProfile: profileMap.has(paper.id),
      duplicateOf: duplicates.get(paper.id),
    }))
    nodes.sort((left, right) => right.weight - left.weight || left.title.localeCompare(right.title))

    const visibleEdges: RelationGraphEdge[] = edges
      .filter((edge) => included.has(edge.from) && included.has(edge.to))
      .map((edge) => ({
        id: edgeId(edge),
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        reason: edge.reason,
        confidence: Math.round(edge.confidence * 1000) / 1000,
        status: edge.status ?? 'confirmed',
        direction: isDirected(edge.kind) ? 'a2b' : undefined,
        signals: edge.signals,
        evidence: edge.evidence,
        origin: edge.origin,
      }))
    visibleEdges.sort((left, right) => right.confidence - left.confidence)

    const confirmed = edges.filter((edge) => (edge.status ?? 'confirmed') === 'confirmed')
    const covered = new Set<string>()
    for (const edge of confirmed) {
      covered.add(edge.from)
      covered.add(edge.to)
    }
    const aiOn = modelEnabled()
    const stats: RelationStats = {
      papers: papers.length,
      /** Papers dropped by `limit`; the header must not imply the graph is complete. */
      hidden: Math.max(0, papers.length - visible.length),
      edges: edges.length,
      confirmed: confirmed.length,
      suggested: edges.filter((edge) => edge.status === 'suggested').length,
      isolated: papers.filter((paper) => (degree.get(paper.id) ?? 0) === 0).length,
      coverage: papers.length > 0 ? Math.round((covered.size / papers.length) * 100) / 100 : 0,
      ai: aiOn && await summoner.available(),
      ...(aiOn ? {} : { aiDisabled: true }),
    }

    return {
      generatedAt: nowIso(),
      nodes,
      edges: visibleEdges,
      clusters,
      stats,
    }
  }

  async function relationView(paperId: string): Promise<{ paperId: string; edges: EdgeView[] }> {
    const papers = store.activePapers()
    const byId = new Map(papers.map((paper) => [paper.id, paper]))
    const items: EdgeView[] = []
    for (const edge of store.readRelations()) {
      if (edge.from !== paperId && edge.to !== paperId) continue
      if (edge.status === 'rejected') continue
      const otherId = edge.from === paperId ? edge.to : edge.from
      const other = byId.get(otherId)
      if (!other) continue
      const directed = edge.kind === 'cites' || edge.kind === 'builds-on' || edge.kind === 'uses'
      items.push({
        id: edgeId(edge),
        paperId: other.id,
        title: other.title,
        year: other.year,
        kind: edge.kind,
        reason: edge.reason,
        direction: directed ? (edge.from === paperId ? 'out' : 'in') : 'out',
        origin: edge.origin,
        confidence: edge.confidence,
        status: edge.status ?? 'confirmed',
        signals: edge.signals,
        evidence: edge.evidence,
      })
    }
    items.sort((left, right) => {
      const statusOrder = (left.status === 'confirmed' ? 0 : 1) - (right.status === 'confirmed' ? 0 : 1)
      if (statusOrder !== 0) return statusOrder
      return right.confidence - left.confidence
    })
    return { paperId, edges: items }
  }

  async function insight(paperId: string, { refresh = false }: { refresh?: boolean } = {}): Promise<RelationInsight | null> {
    const paper = store.getPaper(paperId)
    if (!paper) return null
    // The settings switch is authoritative: a disabled relations page never
    // spends a model call on the insight, even when the cache is stale.
    if (!modelEnabled()) return null
    const profile = await ensureProfile(paper).catch(() => null)
    const papers = store.activePapers()
    const byId = new Map(papers.map((item) => [item.id, item]))
    const neighbours = store.readRelations()
      .filter((edge) => edge.status !== 'rejected' && (edge.from === paperId || edge.to === paperId))
      .filter((edge) => byId.has(edge.from === paperId ? edge.to : edge.from))
      .map((edge) => {
        const otherId = edge.from === paperId ? edge.to : edge.from
        return {
          paperId: otherId,
          title: byId.get(otherId)?.title ?? otherId,
          kind: edge.kind,
          reason: edge.reason,
          confidence: edge.confidence,
          outbound: edge.from === paperId,
        }
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 8)
    const signature = insightSignature(profile, neighbours.map((item) => ({
      from: item.outbound ? paperId : item.paperId,
      to: item.outbound ? item.paperId : paperId,
      kind: item.kind,
      reason: item.reason,
      origin: 'auto',
      confidence: item.confidence,
    })))
    const cached = await store.readInsight(paperId).catch(() => null)
    if (!refresh && cached) {
      const stale = cached.signature !== signature
      if (!stale || !(await summoner.available())) return { ...cached, stale }
    }
    const built = await buildInsight({ summoner, paper, profile, neighbours, librarySize: papers.length })
    if (!built) return cached ? { ...cached, stale: true } : null
    const stored: RelationInsight = { ...built, signature }
    await store.writeInsight(paperId, stored)
    return stored
  }

  async function feedback({ from, to, kind, action }: { from: string; to: string; kind: string; action: 'accept' | 'reject' | 'pin' | 'delete' }): Promise<RelationEdge | null> {
    if (action === 'delete') {
      await store.removeRelation(from, to, kind)
      return null
    }
    if (action === 'reject') {
      return store.setRelationStatus(from, to, kind, 'rejected', 'user')
    }
    if (action === 'pin') {
      return store.setRelationStatus(from, to, kind, 'confirmed', 'user')
    }
    return store.setRelationStatus(from, to, kind, 'confirmed', 'auto')
  }

  return {
    analyzePaper,
    rebuild,
    graph,
    relationView,
    insight,
    feedback,
    invalidate,
  }
}
