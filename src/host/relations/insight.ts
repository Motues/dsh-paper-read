/**
 * "Where this paper sits in the library": one cached paragraph per paper.
 *
 * It is written from the profile plus the edges the engine already has, so it
 * never invents a paper that is not in the graph. Regenerated only when the
 * profile hash or the neighbour list changes.
 */

import type { PaperProfile, PaperRecord, RelationEdge, RelationInsight } from '../../shared/domain.js'
import type { Summoner } from '../ai/summoner.js'
import { sha1, truncate } from '../util/util.js'
import { EDGE_LABEL } from '../../shared/labels.js'

export interface StoredInsight extends RelationInsight {
  /** Opaque hash of (profile, neighbours); differs means `stale`. */
  signature: string
}

const INSIGHT_SYSTEM = [
  'You describe where one paper sits inside a library. The reader has already read this paper; do not restate the abstract.',
  'Write only from the supplied relations. Do not mention papers outside the library and do not judge paper quality.',
  'Output JSON: {"text":"2-3 sentences, at most 120 Chinese characters","bullets":["2-4 items, each at most 26 Chinese characters"]}',
  'text must state which papers it shares roots with, which it complements or contradicts, and what role it plays in this set.',
  'Each bullet is one concrete judgment, naming the short title or method of a paper.',
  'Output JSON only.',
  'Write all human-readable strings in Simplified Chinese; keep method names and titles in their original form.',
].join('\n')

export function insightSignature(profile: PaperProfile | null, neighbours: RelationEdge[]): string {
  const body = [
    profile?.contentHash ?? '',
    profile?.method ?? '',
    ...neighbours
      .map((edge) => `${edge.from === profile?.paperId ? '>' : '<'}${edge.from === profile?.paperId ? edge.to : edge.from}:${edge.kind}:${Math.round(edge.confidence * 100)}`)
      .sort(),
  ].join('|')
  return sha1(body).slice(0, 16)
}

export interface NeighbourContext {
  paperId: string
  title: string
  kind: RelationEdge['kind']
  reason: string
  confidence: number
  outbound: boolean
}

function shortTitle(title: string): string {
  return truncate(title, 34)
}

export async function buildInsight({
  summoner,
  paper,
  profile,
  neighbours,
  librarySize,
  signal,
}: {
  summoner: Summoner
  paper: PaperRecord
  profile: PaperProfile | null
  neighbours: NeighbourContext[]
  librarySize: number
  signal?: AbortSignal
}): Promise<StoredInsight | null> {
  if (!(await summoner.available())) return null
  const target = await summoner.target()
  const model = target ? `${target.provider}/${target.model}` : ''
  const list = neighbours.length > 0
    ? neighbours
      .map((item) => (
        `- 《${shortTitle(item.title)}》 ${EDGE_LABEL[item.kind]}：${item.reason}（置信 ${item.confidence.toFixed(2)}）`
      ))
      .join('\n')
    : '（暂无已确认的关联）'
  const user = [
    `本文：《${paper.title}》${paper.year ? `（${paper.year}）` : ''}`,
    profile?.question ? `问题：${profile.question}` : '',
    profile?.method ? `方法：${profile.method}` : '',
    profile?.approach ? `做法：${profile.approach}` : '',
    profile?.fingerprint ? `自述：${profile.fingerprint}` : '',
    '',
    `库内共 ${librarySize} 篇，本文的关联：`,
    list,
    '',
    '据此输出 JSON。',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const raw = await summoner.json({ system: INSIGHT_SYSTEM, user, temperature: 0.3, maxTokens: 500, signal, purpose: 'insight' })
    const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const text = truncate(String(data.text ?? '').replace(/\s+/g, ' ').trim(), 220)
    const bullets = Array.isArray(data.bullets)
      ? data.bullets.map((item) => truncate(String(item).replace(/\s+/g, ' ').trim(), 60)).filter(Boolean).slice(0, 4)
      : []
    if (text.length < 8 && bullets.length === 0) return null
    return {
      paperId: paper.id,
      text,
      bullets,
      model,
      createdAt: new Date().toISOString(),
      stale: false,
      signature: insightSignature(profile, neighbours.map((item) => ({
        from: item.outbound ? paper.id : item.paperId,
        to: item.outbound ? item.paperId : paper.id,
        kind: item.kind,
        reason: item.reason,
        origin: 'auto',
        confidence: item.confidence,
      }))),
    }
  } catch {
    return null
  }
}
