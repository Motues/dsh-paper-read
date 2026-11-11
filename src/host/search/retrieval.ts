/**
 * Read-side retrieval: related candidates, the relation view, and ranked search.
 *
 * BM25 produces candidates; the model reranks the top hits and writes the
 * one-line "why this is relevant" shown in the UI. Without a model the BM25
 * order is still useful, so reranking degrades instead of failing.
 */

import type {
  EdgeView,
  PaperRecord,
  SearchHit,
  SearchPayload,
} from '../../shared/domain.js'
import type { Store } from '../library/store.js'
import { truncate, normalizeSpace } from '../util/util.js'
import type { Indexer } from './indexer.js'
import type { Summoner } from '../ai/summoner.js'

export interface Candidate {
  id: string
  title: string
  year?: number
  tags: string[]
  tldr: string
  why: string[]
}

export interface RelationView {
  paperId: string
  edges: EdgeView[]
}

export interface Retrieval {
  candidatesFor(paper: PaperRecord, limit?: number): Candidate[]
  relationView(paperId: string): Promise<RelationView>
  searchLibrary(args: {
    query: string
    limit?: number
    rerank?: boolean
    signal?: AbortSignal
  }): Promise<SearchPayload>
}

export function createRetrieval({
  store,
  indexer,
  summoner,
  log,
}: {
  store: Store
  indexer: Indexer
  summoner: Summoner
  log: (message: string, error?: unknown) => void
}): Retrieval {
  const asRecord = (value: unknown): Record<string, unknown> => (
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  )

  function candidatesFor(paper: PaperRecord, limit = 8): Candidate[] {
    const others = store.activePapers().filter((item) => item.id !== paper.id && !item.missing)
    if (others.length === 0) return []
    const byId = new Map(others.map((item) => [item.id, item]))
    const scores = new Map<string, { score: number; why: string[] }>()

    const add = (id: string, score: number, why: string | null): void => {
      const current = scores.get(id) ?? { score: 0, why: [] }
      current.score += score
      if (why) current.why.push(why)
      scores.set(id, current)
    }

    for (const other of others) {
      const shared = (other.tags ?? []).filter((tag) => (paper.tags ?? []).includes(tag))
      if (shared.length > 0) add(other.id, shared.length * 1.2, `同标签 ${shared.join('、')}`)
    }

    const query = [paper.title, paper.abstract ?? '', paper.tldr ?? ''].join(' ')
    for (const hit of indexer.index.search(query, { limit: 24 })) {
      if (!byId.has(hit.doc.paperId)) continue
      add(hit.doc.paperId, Math.min(3, hit.score / 8), null)
    }
    for (const edge of store.readRelations()) {
      if (edge.from === paper.id) add(edge.to, 2, '已有引用关系')
      if (edge.to === paper.id) add(edge.from, 2, '已有引用关系')
    }

    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([id, meta]) => {
        const other = byId.get(id) as PaperRecord
        return {
          id,
          title: other.title,
          year: other.year,
          tags: other.tags ?? [],
          tldr: other.tldr ?? '',
          why: meta.why,
        }
      })
  }

  async function relationView(paperId: string): Promise<RelationView> {
    await indexer.ensureIndex()
    const edges = store.readRelations()
    const involve = edges.filter((edge) => edge.from === paperId || edge.to === paperId)
    const byId = new Map(store.activePapers().map((paper) => [paper.id, paper]))
    const items = involve
      .map((edge): EdgeView | null => {
        const otherId = edge.from === paperId ? edge.to : edge.from
        const other = byId.get(otherId)
        if (!other) return null
        return {
          id: `${edge.from}->${edge.to}:${edge.kind}`,
          paperId: other.id,
          title: other.title,
          year: other.year,
          kind: edge.kind,
          reason: edge.reason,
          direction: edge.from === paperId ? 'out' : 'in',
          origin: edge.origin,
          confidence: edge.confidence,
        }
      })
      .filter((edge): edge is EdgeView => edge !== null)
    return { paperId, edges: items }
  }

  async function searchLibrary({
    query,
    limit = 6,
    rerank = true,
    signal,
  }: {
    query: string
    limit?: number
    rerank?: boolean
    signal?: AbortSignal
  }): Promise<SearchPayload> {
    await indexer.ensureIndex()
    const trimmed = normalizeSpace(query)
    if (!trimmed) return { query: '', hits: [], reranked: false }
    const chunkHits = indexer.index.search(trimmed, { limit: 30 })
    const noteHits = indexer.notesIndex.search(trimmed, { limit: 10 })
    const merged = [...noteHits, ...chunkHits].slice(0, 30)
    if (merged.length === 0) return { query: trimmed, hits: [], reranked: false }

    const byId = new Map(store.activePapers().map((paper) => [paper.id, paper]))
    const base = merged
      .map((hit): SearchHit | null => {
        const paper = byId.get(hit.doc.paperId)
        if (!paper) return null
        return {
          paperId: paper.id,
          title: paper.title,
          year: paper.year,
          page: hit.doc.page,
          quote: truncate(normalizeSpace(hit.doc.text), 220),
          kind: hit.doc.kind,
          score: Math.round(hit.score * 100) / 100,
          reason: '',
        }
      })
      .filter((hit): hit is SearchHit => hit !== null)

    if (!rerank || base.length === 0) return { query: trimmed, hits: base.slice(0, limit), reranked: false }
    const available = await summoner.available()
    if (!available) return { query: trimmed, hits: base.slice(0, limit), reranked: false }

    try {
      const list = base
        .slice(0, 12)
        .map((hit, i) => `[${i}] 《${hit.title}》${hit.year ?? ''} 第${hit.page}页\n${hit.quote}`)
        .join('\n\n')
      const raw = await summoner.json({
        system: [
          '你在为一个论文库做检索重排。',
          '只输出 JSON 数组：[{"index":0,"reason":"为什么这段能回答提问，≤ 30 字"}]',
          '只保留真正相关的条目，最多 5 条；都不相关就输出空数组。',
        ].join('\n'),
        user: `提问：${trimmed}\n\n候选片段：\n${list}`,
        temperature: 0.1,
        maxTokens: 700,
        signal,
        purpose: 'search',
      })
      const rows: unknown[] = Array.isArray(raw)
        ? raw
        : Array.isArray(asRecord(raw).hits)
          ? (asRecord(raw).hits as unknown[])
          : []
      const picked = rows
        .map((entry): SearchHit | null => {
          const row = asRecord(entry)
          const hit = base[Number(row.index)]
          if (!hit) return null
          return { ...hit, reason: truncate(normalizeSpace(row.reason ?? ''), 60) }
        })
        .filter((hit): hit is SearchHit => hit !== null)
        .slice(0, limit)
      return { query: trimmed, hits: picked.length > 0 ? picked : base.slice(0, limit), reranked: picked.length > 0 }
    } catch (error) {
      log('rerank failed', error)
      return { query: trimmed, hits: base.slice(0, limit), reranked: false }
    }
  }

  return { candidatesFor, relationView, searchLibrary }
}
