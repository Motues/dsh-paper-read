/**
 * The relation page's search language.
 *
 * Free text filters papers (title / author / tag / tldr); `key:value` prefixes
 * narrow by metadata. Everything is parsed locally, so typing never waits on a
 * request — Enter is the only thing that hits the host's semantic search.
 */

import type { EdgeKind, Paper, RelationGraph, RelationGraphEdge } from '../../types.js'
import { EDGE_KINDS } from '../../types.js'

export interface ParsedQuery {
  text: string
  tags: string[]
  authors: string[]
  kinds: EdgeKind[]
  clusters: string[]
  yearMin?: number
  yearMax?: number
  onlyIsolated: boolean
  onlyPending: boolean
  onlyMissing: boolean
}

const EMPTY: ParsedQuery = {
  text: '',
  tags: [],
  authors: [],
  kinds: [],
  clusters: [],
  onlyIsolated: false,
  onlyPending: false,
  onlyMissing: false,
}

function tokenizeQuery(raw: string): string[] {
  const tokens: string[] = []
  const pattern = /(?:[^\s"]+|"[^"]*")+/g
  for (const match of raw.matchAll(pattern)) {
    const value = match[0].replace(/^"|"$/g, '')
    if (value) tokens.push(value)
  }
  return tokens
}

function parseYear(value: string): { min?: number; max?: number } {
  const gt = value.match(/^>(\d{4})$/)
  if (gt) return { min: Number(gt[1]) + 1 }
  const lt = value.match(/^<(\d{4})$/)
  if (lt) return { max: Number(lt[1]) - 1 }
  const range = value.match(/^(\d{4})-(\d{4})$/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const exact = value.match(/^(\d{4})$/)
  if (exact) return { min: Number(exact[1]), max: Number(exact[1]) }
  return {}
}

export function parseQuery(raw: string): ParsedQuery {
  const text = raw.trim()
  if (text === '') return { ...EMPTY }
  const query: ParsedQuery = { ...EMPTY, text: '', tags: [], authors: [], kinds: [], clusters: [] }
  const words: string[] = []
  for (const token of tokenizeQuery(text)) {
    const index = token.indexOf(':')
    if (index <= 0) {
      words.push(token)
      continue
    }
    const key = token.slice(0, index).toLowerCase()
    const value = token.slice(index + 1).trim()
    if (!value) continue
    switch (key) {
      case 'tag':
        query.tags.push(value.toLowerCase())
        break
      case 'author':
        query.authors.push(value.toLowerCase())
        break
      case 'kind': {
        const kind = EDGE_KINDS.find((item) => item === value || item.startsWith(value))
        if (kind) query.kinds.push(kind)
        break
      }
      case 'cluster':
        query.clusters.push(value.toLowerCase())
        break
      case 'year': {
        const range = parseYear(value)
        if (range.min !== undefined) query.yearMin = range.min
        if (range.max !== undefined) query.yearMax = range.max
        break
      }
      case 'is':
        if (value === 'isolated') query.onlyIsolated = true
        else if (value === 'pending' || value === 'suggested') query.onlyPending = true
        else if (value === 'missing') query.onlyMissing = true
        break
      default:
        words.push(token)
    }
  }
  query.text = words.join(' ').toLowerCase()
  return query
}

export interface MatchResult {
  nodes: Set<string>
  edges: Set<string>
  /** True when the query is empty: callers skip dimming. */
  empty: boolean
}

function paperSearchText(paper: Paper | undefined): string {
  if (!paper) return ''
  return [paper.title, paper.authorLine ?? '', paper.tldr ?? '', (paper.tags ?? []).join(' '), paper.venue ?? '']
    .join(' ')
    .toLowerCase()
}

export function matchGraph(query: ParsedQuery, graph: RelationGraph, papers: Map<string, Paper>): MatchResult {
  const empty = query.text === ''
    && query.tags.length === 0
    && query.authors.length === 0
    && query.kinds.length === 0
    && query.clusters.length === 0
    && query.yearMin === undefined
    && query.yearMax === undefined
    && !query.onlyIsolated
    && !query.onlyPending
    && !query.onlyMissing
  if (empty) return { nodes: new Set(graph.nodes.map((node) => node.id)), edges: new Set(graph.edges.map((edge) => edge.id)), empty: true }

  const nodes = new Set<string>()
  const clusterLabels = new Map(graph.clusters.map((cluster) => [cluster.id, cluster.label.toLowerCase()]))
  for (const node of graph.nodes) {
    const paper = papers.get(node.id)
    const haystack = `${paperSearchText(paper)} ${node.tags.join(' ')}`.toLowerCase()
    if (query.text && !query.text.split(/\s+/).every((word) => haystack.includes(word))) continue
    if (query.tags.length > 0 && !query.tags.every((tag) => (paper?.tags ?? node.tags ?? []).some((item) => item.toLowerCase().includes(tag)))) continue
    if (query.authors.length > 0 && !query.authors.every((author) => (paper?.authorLine ?? '').toLowerCase().includes(author))) continue
    if (query.yearMin !== undefined && (paper?.year ?? node.year ?? 0) < query.yearMin) continue
    if (query.yearMax !== undefined && (paper?.year ?? node.year ?? 9999) > query.yearMax) continue
    if (query.clusters.length > 0) {
      const label = clusterLabels.get(node.cluster) ?? ''
      if (!query.clusters.some((value) => node.cluster.toLowerCase().includes(value) || label.includes(value))) continue
    }
    if (query.onlyIsolated && !node.isolated) continue
    if (query.onlyMissing && !node.missing) continue
    nodes.add(node.id)
  }

  const edges = new Set<string>()
  for (const edge of graph.edges) {
    const reason = edge.reason.toLowerCase()
    const reasonHit = query.text !== '' && query.text.split(/\s+/).every((word) => reason.includes(word))
    if (query.onlyPending && edge.status !== 'suggested') continue
    if (reasonHit) {
      edges.add(edge.id)
      nodes.add(edge.from)
      nodes.add(edge.to)
      continue
    }
    if (nodes.has(edge.from) && nodes.has(edge.to)) edges.add(edge.id)
  }
  return { nodes, edges, empty: false }
}

export function edgeMatchesKinds(edge: RelationGraphEdge, kinds: Set<EdgeKind>): boolean {
  return kinds.size === 0 || kinds.has(edge.kind)
}
