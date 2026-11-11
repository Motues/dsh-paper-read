/**
 * Themes: deterministic community detection plus a model-written name.
 *
 * Weighted label propagation is enough for the library sizes this plugin sees
 * (a few hundred papers) and is ~40 lines, which is why there is no Louvain
 * implementation here. Determinism matters more than modularity: the same
 * library must produce the same clusters on every host start.
 */

import type { PaperProfile, RelationCluster } from '../../shared/domain.js'
import type { Summoner } from '../ai/summoner.js'
import { sha1, truncate } from '../util/util.js'

export interface ClusterEdge {
  from: string
  to: string
  weight: number
}

const MAX_ROUNDS = 20

/** paperId → cluster label (paper id of the representative, or `solo`). */
export function detectClusters(nodeIds: string[], edges: ClusterEdge[]): Map<string, string> {
  const adjacency = new Map<string, Map<string, number>>()
  for (const id of nodeIds) adjacency.set(id, new Map())
  for (const edge of edges) {
    if (edge.from === edge.to) continue
    if (edge.weight <= 0) continue
    adjacency.get(edge.from)?.set(edge.to, (adjacency.get(edge.from)?.get(edge.to) ?? 0) + edge.weight)
    adjacency.get(edge.to)?.set(edge.from, (adjacency.get(edge.to)?.get(edge.from) ?? 0) + edge.weight)
  }

  const labels = new Map<string, string>(nodeIds.map((id) => [id, id]))
  const order = [...nodeIds].sort((left, right) => {
    const degree = (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0)
    return degree !== 0 ? degree : left.localeCompare(right)
  })

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let changed = false
    for (const id of order) {
      const neighbours = adjacency.get(id)
      if (!neighbours || neighbours.size === 0) continue
      const tally = new Map<string, number>()
      for (const [other, weight] of neighbours) {
        const label = labels.get(other) ?? other
        tally.set(label, (tally.get(label) ?? 0) + weight)
      }
      let bestLabel = labels.get(id) ?? id
      let bestWeight = -1
      for (const [label, weight] of tally) {
        if (weight > bestWeight || (weight === bestWeight && label < bestLabel)) {
          bestLabel = label
          bestWeight = weight
        }
      }
      if (bestLabel !== labels.get(id)) {
        labels.set(id, bestLabel)
        changed = true
      }
    }
    if (!changed) break
  }

  // Isolated nodes get their own singleton cluster; they are shown as 未关联.
  for (const id of nodeIds) {
    if ((adjacency.get(id)?.size ?? 0) === 0) labels.set(id, 'solo')
  }
  return labels
}

export interface ClusterGroup {
  /** Stable key for naming caches: smallest paper id in the group. */
  key: string
  paperIds: string[]
  concepts: string[]
  titles: string[]
}

export function groupClusters(
  labels: Map<string, string>,
  profiles: Map<string, PaperProfile>,
  titles: Map<string, string>,
): ClusterGroup[] {
  const groups = new Map<string, string[]>()
  for (const [paperId, label] of labels) {
    if (label === 'solo') continue
    const list = groups.get(label)
    if (list) list.push(paperId)
    else groups.set(label, [paperId])
  }
  const result: ClusterGroup[] = []
  for (const [label, paperIds] of groups) {
    const sorted = [...paperIds].sort()
    const weights = new Map<string, number>()
    for (const paperId of sorted) {
      const profile = profiles.get(paperId)
      for (const concept of profile?.concepts ?? []) {
        weights.set(concept, (weights.get(concept) ?? 0) + 1)
      }
    }
    const concepts = [...weights.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([concept]) => concept)
    result.push({
      key: label,
      paperIds: sorted,
      concepts,
      titles: sorted.slice(0, 3).map((paperId) => titles.get(paperId) ?? paperId),
    })
  }
  result.sort((left, right) => right.paperIds.length - left.paperIds.length || left.key.localeCompare(right.key))
  return result
}

export function clusterSignature(groups: ClusterGroup[]): string {
  return sha1(groups.map((group) => `${group.key}:${group.paperIds.join(',')}`).join('|')).slice(0, 16)
}

export function fallbackClusterLabel(group: ClusterGroup, index: number): string {
  const clean = (concept: string): string => truncate(concept.replace(/[（(].*$/, '').trim(), 18)
  const concepts = group.concepts.map(clean).filter(Boolean)
  if (concepts.length >= 2) return truncate(`${concepts[0]} · ${concepts[1]}`, 36)
  if (concepts.length === 1) return truncate(concepts[0], 24)
  return `主题 ${index + 1}`
}

const NAME_SYSTEM = [
  'You name one cluster of papers in a library.',
  'Output a JSON array only, in the same order as the input groups, e.g. ["Linear attention and state space","Thin-film lithium niobate modulators"].',
  'Each name must be 4-8 Chinese characters and specific to the technical route; do not use "related work" or "others".',
  'Write the names in Simplified Chinese.',
].join('\n')

const NAME_SYSTEM_OBJECT = [
  'You name one cluster of papers in a library.',
  'Output a JSON object only: {"0":"name","1":"name"}; the key is the group index.',
  'Each name must be 4-8 Chinese characters and specific to the technical route; do not use "related work" or "others".',
  'Write the names in Simplified Chinese.',
].join('\n')

/**
 * Ask the model for every cluster name in one call. Falls back to the top two
 * concepts per cluster, which still beats an opaque "主题 3".
 */
export async function nameClusters({
  summoner,
  groups,
  signal,
}: {
  summoner: Summoner
  groups: ClusterGroup[]
  signal?: AbortSignal
}): Promise<{ names: string[]; model: string }> {
  const fallback = groups.map((group, index) => fallbackClusterLabel(group, index))
  if (groups.length === 0) return { names: [], model: '' }
  if (!(await summoner.available())) return { names: fallback, model: '' }
  const list = groups
    .map((group, index) => (
      `[${index}] 概念：${group.concepts.join('、') || '无'}\n`
      + `    标题：${group.titles.map((title) => truncate(title, 60)).join(' / ')}`
    ))
    .join('\n')
  const target = await summoner.target()
  const model = target ? `${target.provider}/${target.model}` : ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await summoner.json({
        system: attempt === 0 ? NAME_SYSTEM : NAME_SYSTEM_OBJECT,
        user: `共 ${groups.length} 组论文：\n${list}\n\n按顺序给每组一个主题名。`,
        temperature: attempt === 0 ? 0.2 : 0.1,
        maxTokens: 500,
        signal,
        purpose: 'cluster',
      })
      const values: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'object' && raw !== null
          ? Object.entries(raw as Record<string, unknown>)
            .sort((left, right) => Number(left[0]) - Number(right[0]))
            .map(([, value]) => value)
          : []
      let named = 0
      const names = groups.map((_group, index) => {
        const value = String(values[index] ?? '').trim()
        if (value.length >= 2) {
          named += 1
          return truncate(value, 16)
        }
        return fallback[index]
      })
      if (named > 0) return { names, model }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
  }
  return { names: fallback, model: '' }
}

export function clustersFrom(
  groups: ClusterGroup[],
  names: string[],
  aiNamed: boolean,
  soloIds: string[],
): RelationCluster[] {
  const clusters: RelationCluster[] = groups.map((group, index) => ({
    id: group.key,
    label: names[index] ?? fallbackClusterLabel(group, index),
    paperIds: group.paperIds,
    color: index % 6,
    aiNamed,
  }))
  if (soloIds.length > 0) {
    clusters.push({ id: 'solo', label: '未关联', paperIds: [...soloIds].sort(), color: -1, aiNamed: false })
  }
  return clusters
}
