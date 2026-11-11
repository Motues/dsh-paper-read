/**
 * Per-focus ranking, computed from the graph the page already has.
 *
 * The server ships the whole library graph; "what should I read next from this
 * paper" is a view of it, not another request. Adamic-Adar is what makes the
 * two questions different: a neighbour that shares rare intermediaries is a
 * better lead than a neighbour that merely has a strong edge.
 */

import type { RelationGraphEdge } from '../../types.js'

export interface NeighbourRank {
  id: string
  score: number
  confidence: number
  adamic: number
  concept: number
}

export interface LineageHit {
  id: string
  count: number
}

function adjacencyOf(edges: RelationGraphEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (a === b) return
    const set = map.get(a) ?? new Set<string>()
    set.add(b)
    map.set(a, set)
  }
  for (const edge of edges) {
    link(edge.from, edge.to)
    link(edge.to, edge.from)
  }
  return map
}

/**
 * Rank the focus paper's direct neighbours by
 * `confidence + 0.25 · AdamicAdar/max + 0.15 · concept overlap`.
 *
 * The weights mirror `DESIGN-RELATIONS.md` §5.5; the score is clamped to 1
 * because it is a ranking key, not a probability.
 */
export function neighbourRanks(focusId: string, edges: RelationGraphEdge[]): NeighbourRank[] {
  const adjacency = adjacencyOf(edges)
  const focusNeighbours = adjacency.get(focusId)
  if (!focusNeighbours || focusNeighbours.size === 0) return []

  const byPeer = new Map<string, NeighbourRank>()
  for (const edge of edges) {
    if (edge.from !== focusId && edge.to !== focusId) continue
    const other = edge.from === focusId ? edge.to : edge.from
    if (other === focusId) continue
    let adamic = 0
    const peerNeighbours = adjacency.get(other)
    if (peerNeighbours) {
      for (const shared of focusNeighbours) {
        if (!peerNeighbours.has(shared)) continue
        const degree = adjacency.get(shared)?.size ?? 0
        if (degree >= 2) adamic += 1 / Math.log(degree)
      }
    }
    // Two edges to the same paper (a citation plus a semantic relation) are one
    // neighbour; the stronger observation carries the ranking.
    const existing = byPeer.get(other)
    if (existing && existing.confidence >= edge.confidence) continue
    byPeer.set(other, {
      id: other,
      confidence: edge.confidence,
      adamic,
      concept: edge.signals?.concept ?? 0,
      score: 0,
    })
  }

  const ranks = [...byPeer.values()]
  const maxAdamic = Math.max(0, ...ranks.map((rank) => rank.adamic)) || 1
  for (const rank of ranks) {
    // Deliberately not clamped: the score is an ordering key, and clamping turns
    // several strong neighbours into an uninformative row of 100s.
    rank.score = rank.confidence + 0.25 * (rank.adamic / maxAdamic) + 0.15 * rank.concept
  }
  return ranks.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
}

/**
 * Prior / derivative works, folded out of the citation edges.
 *
 * Prior: what the focus and its neighbours cite (shared ancestors), counted, so
 * a paper several neighbours build on outranks a single direct reference.
 * Derivative: papers that cite the focus itself. Counting citations of the
 * neighbours instead would list siblings — in a library dominated by one hub
 * every paper becomes a "derivative", which is worse than an empty list.
 */
export function lineage(focusId: string, edges: RelationGraphEdge[]): { prior: LineageHit[]; derivative: LineageHit[] } {
  const adjacency = adjacencyOf(edges)
  const scope = new Set<string>([focusId, ...(adjacency.get(focusId) ?? [])])
  const prior = new Map<string, number>()
  const derivative = new Map<string, number>()
  for (const edge of edges) {
    if (edge.kind !== 'cites') continue
    if (scope.has(edge.from) && edge.to !== focusId) prior.set(edge.to, (prior.get(edge.to) ?? 0) + 1)
    if (edge.to === focusId && edge.from !== focusId) derivative.set(edge.from, (derivative.get(edge.from) ?? 0) + 1)
  }
  const rank = (counts: Map<string, number>): LineageHit[] => [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }))
  return { prior: rank(prior), derivative: rank(derivative) }
}
