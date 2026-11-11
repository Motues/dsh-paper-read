/**
 * The model half of the relation engine: type a candidate pair, point at the
 * evidence, and say how sure it is.
 *
 * Deterministic signals decide *which* pairs are worth asking about and how
 * confident the final edge is; the model only decides what kind of relation it
 * is and writes the sentence a reader can check.
 */

import type {
  EdgeKind,
  PaperProfile,
  PaperRecord,
  RelationEvidence,
  RelationSignals,
} from '../../shared/domain.js'
import type { Summoner } from '../ai/summoner.js'
import { clamp, normalizeSpace, truncate } from '../util/util.js'
import { signalsRecord, type PairSignals } from './signals.js'

const EDGE_KINDS: EdgeKind[] = ['cites', 'builds-on', 'same-method', 'same-problem', 'uses', 'contradicts']
const BANNED_REASON = /^(主题相关|内容相关|都属于|同一领域|相关研究|研究主题相近)[。.]?$/

const ADJUDICATE_SYSTEM = [
  'You decide whether two papers are substantively related. Prefer none over inventing a vague relation to fill the list.',
  'kind must be one of:',
  '- cites: an explicit citation (deterministic matching already covers this; use it only when the material confirms it)',
  '- builds-on: same problem, and A directly improves, replaces or extends the method of B (A claims to be better or stronger)',
  '- uses: A borrows the method, data or tooling of B to solve a different problem',
  '- same-method: same method family, developed independently (neither builds on the other)',
  '- same-problem: same problem, but a different technical route',
  '- contradicts: conclusions or key assumptions conflict (you must be able to name the conflict)',
  '- none: only shared topic words, with no testable relation',
  'direction: required for cites / builds-on / uses; a2b = the new paper points at the candidate, b2a = the candidate points at the new paper; otherwise none.',
  'reason: at most 40 Chinese characters; name the method, assumption or conclusion. Never write "related topic", "both belong to" or "same field".',
  'evidenceA / evidenceB: each at most 30 Chinese characters, distilled from the material; empty string when absent.',
  'confidence: decimal 0-1; below 0.5 when unsure.',
  'Output a JSON array only: [{"index":0,"kind":"same-method","direction":"none","reason":"...","evidenceA":"...","evidenceB":"...","confidence":0.7}]',
  'Omit candidates with no substantive relation.',
  'Write reason, evidenceA and evidenceB in Simplified Chinese; keep the kind and direction values exactly as listed.',
].join('\n')

export interface AdjudicationCandidate {
  paper: PaperRecord
  profile: PaperProfile | null
  score: number
  signals: PairSignals
}

export interface Judgment {
  kind: EdgeKind
  direction: 'a2b' | 'b2a' | 'none'
  reason: string
  evidenceA: string
  evidenceB: string
  confidence: number
  /** `provider/model` that wrote it, when it came from the model. */
  model?: string
}

export interface JudgmentCache {
  get(key: string): Judgment | null
  set(key: string, judgment: Judgment): void
}

export function judgmentKey(paperId: string, hashA: string, otherId: string, hashB: string): string {
  return `${paperId}:${hashA}>${otherId}:${hashB}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function isUsableReason(reason: string): boolean {
  if (reason.length < 6) return false
  return !BANNED_REASON.test(reason)
}

/** A specific, signal-derived sentence used only when the model's reason fails the bar. */
export function fallbackReason(signals: PairSignals): string {
  const parts: string[] = []
  if (signals.sharedConcepts.length > 0) parts.push(`共享概念「${signals.sharedConcepts.slice(0, 2).join('、')}」`)
  if (signals.sharedRefs.length > 0) parts.push(`共同引用 ${signals.sharedRefs.length} 篇`)
  if (parts.length === 0 && signals.lexical >= 0.4) parts.push('标题与摘要在用词上高度重合')
  return parts.length > 0 ? parts.join('；') : '文本与引用信号均显示相近'
}

function buildPrompt(
  paper: PaperRecord,
  profile: PaperProfile | null,
  candidates: AdjudicationCandidate[],
): string {
  const self = [
    `新论文：《${paper.title}》${paper.year ? `（${paper.year}）` : ''}`,
    profile?.question ? `问题：${profile.question}` : '',
    profile?.method ? `方法：${profile.method}` : '',
    profile?.approach ? `做法：${profile.approach}` : '',
    profile?.claims?.length ? `结论：${profile.claims.slice(0, 3).join('；')}` : '',
    profile?.fingerprint ? `自述：${profile.fingerprint}` : '',
    paper.abstract ? `摘要：${truncate(paper.abstract, 500)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const list = candidates
    .map((candidate, index) => {
      const other = candidate.profile
      const signals = candidate.signals
      return [
        `[${index}] 《${candidate.paper.title}》${candidate.paper.year ? `（${candidate.paper.year}）` : ''}`,
        other?.method ? `    方法：${other.method}` : '',
        other?.question ? `    问题：${other.question}` : '',
        other?.claims?.length ? `    结论：${other.claims.slice(0, 2).join('；')}` : '',
        other?.fingerprint ? `    自述：${other.fingerprint}` : '',
        `    共享概念：${signals.sharedConcepts.join('、') || '无'}`,
        `    共同引用：${signals.sharedRefs.slice(0, 2).join('；') || '无'}`,
        `    信号：概念 ${signals.concept.toFixed(2)} / 引用 ${signals.ref.toFixed(2)} / 词法 ${signals.lexical.toFixed(2)}`,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')

  return `${self}\n\n库内候选：\n${list}\n\n逐条判断新论文与每个候选的关系。只输出 JSON 数组。`
}

function normalizeJudgment(row: unknown, pool: AdjudicationCandidate[]): { candidate: AdjudicationCandidate; judgment: Judgment } | null {
  const data = asRecord(row)
  const candidate = pool[Number(data.index)]
  if (!candidate) return null
  const kind = String(data.kind ?? '') as EdgeKind
  if (!EDGE_KINDS.includes(kind)) return null
  const rawDirection = String(data.direction ?? 'none')
  const direction = rawDirection === 'a2b' || rawDirection === 'b2a' ? rawDirection : 'none'
  const reason = truncate(normalizeSpace(data.reason ?? ''), 80)
  const confidence = Number(data.confidence)
  if (!Number.isFinite(confidence) || confidence < 0.45) return null
  return {
    candidate,
    judgment: {
      kind,
      direction: kind === 'same-method' || kind === 'same-problem' || kind === 'contradicts' ? 'none' : direction,
      reason,
      evidenceA: truncate(normalizeSpace(data.evidenceA ?? ''), 60),
      evidenceB: truncate(normalizeSpace(data.evidenceB ?? ''), 60),
      confidence: clamp(confidence, 0, 1),
    },
  }
}

/**
 * One batch call for one paper's shortlist. Failures are non-fatal: the caller
 * keeps deterministic scores and reports the step as degraded.
 */
export async function adjudicate({
  summoner,
  paper,
  profile,
  candidates,
  cache,
  signal,
}: {
  summoner: Summoner
  paper: PaperRecord
  profile: PaperProfile | null
  candidates: AdjudicationCandidate[]
  cache?: JudgmentCache
  signal?: AbortSignal
}): Promise<Array<{ candidate: AdjudicationCandidate; judgment: Judgment }>> {
  if (candidates.length === 0) return []
  const pool: AdjudicationCandidate[] = []
  const judgments: Array<{ candidate: AdjudicationCandidate; judgment: Judgment }> = []

  for (const candidate of candidates.slice(0, 8)) {
    const key = cache ? judgmentKey(paper.id, profile?.contentHash ?? '-', candidate.paper.id, candidate.profile?.contentHash ?? '-') : ''
    const cached = key && cache ? cache.get(key) : null
    if (cached) {
      judgments.push({ candidate, judgment: cached })
      continue
    }
    pool.push(candidate)
  }
  if (pool.length === 0) return judgments

  const available = await summoner.available()
  if (!available) return judgments
  const target = await summoner.target()
  const model = target ? `${target.provider}/${target.model}` : ''

  let rows: unknown[] = []
  try {
    const raw = await summoner.json({
      system: ADJUDICATE_SYSTEM,
      user: buildPrompt(paper, profile, pool),
      temperature: 0.1,
      maxTokens: 1100,
      signal,
      purpose: 'relation',
    })
    rows = Array.isArray(raw) ? raw : []
  } catch {
    return judgments
  }

  const seen = new Set<number>()
  for (const row of rows) {
    const parsed = normalizeJudgment(row, pool)
    if (!parsed) continue
    const index = pool.indexOf(parsed.candidate)
    if (seen.has(index)) continue
    seen.add(index)
    if (!isUsableReason(parsed.judgment.reason)) {
      parsed.judgment.reason = fallbackReason(parsed.candidate.signals)
      parsed.judgment.confidence *= 0.85
    }
    judgments.push(parsed)
    if (cache) {
      cache.set(
        judgmentKey(paper.id, profile?.contentHash ?? '-', parsed.candidate.paper.id, parsed.candidate.profile?.contentHash ?? '-'),
        { ...parsed.judgment, model } as Judgment,
      )
    }
  }
  return judgments
}

export interface EdgeDraft {
  from: string
  to: string
  kind: EdgeKind
  reason: string
  confidence: number
  signals: RelationSignals
  evidence: RelationEvidence
  model: string
}

/** Turn one judgment into the stored edge (direction, confidence, status). */
export function draftEdge({
  paper,
  candidate,
  judgment,
  model,
}: {
  paper: PaperRecord
  candidate: AdjudicationCandidate
  judgment: Judgment
  model: string
}): EdgeDraft {
  const reversed = judgment.direction === 'b2a'
  const from = reversed ? candidate.paper.id : paper.id
  const to = reversed ? paper.id : candidate.paper.id
  const confidence = clamp(0.7 * judgment.confidence + 0.3 * candidate.score, 0, 1)
  const evidence: RelationEvidence = {
    sharedConcepts: candidate.signals.sharedConcepts,
    sharedRefs: candidate.signals.sharedRefs,
    direction: judgment.direction === 'none' ? undefined : judgment.direction,
  }
  if (judgment.evidenceA) evidence.noteA = judgment.evidenceA
  if (judgment.evidenceB) evidence.noteB = judgment.evidenceB
  return {
    from,
    to,
    kind: judgment.kind,
    reason: judgment.reason,
    confidence,
    signals: signalsRecord(candidate.signals),
    evidence,
    model,
  }
}

export function edgeStatus(confidence: number): 'confirmed' | 'suggested' {
  return confidence >= 0.62 ? 'confirmed' : 'suggested'
}

/** Public for the pipeline and tests: a cached judgment is a valid edge recipe. */
export function judgmentIsRejectedReason(reason: string): boolean {
  return !isUsableReason(reason)
}
