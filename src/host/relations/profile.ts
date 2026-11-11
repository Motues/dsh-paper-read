/**
 * AI paper profiles: the structured half of the relation engine.
 *
 * A profile is cheap (one call) and stable: title/abstract/summary/first page
 * only. Everything downstream — concept similarity, candidate explanations,
 * cluster naming, the insight — reads it instead of the PDF.
 */

import type { PageText, PaperProfile, PaperRecord, Summary } from '../../shared/domain.js'
import { pagesToText } from '../pdf/extract.js'
import { normalizeSpace, sha1, tokenize, truncate } from '../util/util.js'
import type { Summoner } from '../ai/summoner.js'

const PROFILE_SYSTEM = [
  'You build a structured profile for a paper-relation engine. Use only the supplied material; do not add outside knowledge.',
  'Output JSON, without explanation:',
  '{"question","method","approach","claims":[],"concepts":[],"tasks":[],"limitations":[],"fingerprint"}',
  'question: the research question as a noun phrase, at most 40 Chinese characters.',
  'method: the method family in canonical English terms, at most 4 words (e.g. sparse attention, state space model); do not copy the title.',
  'approach: one sentence on what it does, at most 60 Chinese characters.',
  'claims: 3-5 main conclusions, each at most 40 Chinese characters; they must be the conclusions of the paper itself.',
  'concepts: 6-8 comparable technical concepts, always in canonical English, optionally with a Chinese gloss, e.g. self-attention (自注意力), linear complexity (线性复杂度). Do not use generic words such as deep learning or experiment.',
  'tasks: 2-4 tasks / datasets / application scenarios, in Simplified Chinese.',
  'limitations: 1-3 items; empty array when the material does not mention any.',
  'fingerprint: a 60-100 character self-description in Simplified Chinese. Describe the specific mechanism or assumption so another paper about the same thing reads as related; do not write "studies X".',
  'Output JSON only.',
  'Write question, approach, claims, tasks, limitations and fingerprint in Simplified Chinese; keep method and concepts in English.',
].join('\n')

/** Bump when the prompt changes: every stored profile becomes stale. */
const PROFILE_VERSION = 'v3'

export interface ProfileSource {
  paper: Pick<PaperRecord, 'id' | 'title' | 'abstract' | 'tldr' | 'year' | 'tags'>
  summary?: Summary | null
  pages?: PageText[] | null
}

/** Deterministic hash of everything the profile prompt can see. */
export function profileContentHash({ paper, summary, pages }: ProfileSource): string {
  const body = [
    PROFILE_VERSION,
    paper.title,
    paper.abstract ?? '',
    paper.tldr ?? '',
    summary?.tldr ?? '',
    summary?.problem ?? '',
    summary?.method ?? '',
    (summary?.findings ?? []).join('；'),
    truncate(pagesToText(pages ?? [], { maxChars: 2600 }), 2600),
  ].join('\n')
  return sha1(body).slice(0, 16)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function stringList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = truncate(normalizeSpace(typeof item === 'string' ? item : ''), maxLength)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= max) break
  }
  return out
}

/** Concepts are the unit of comparison, so fold case and punctuation hard. */
export function normalizeConcept(value: string): string {
  return normalizeSpace(value).toLowerCase().replace(/[，,。.;；]+$/, '')
}

export function normalizeProfile(raw: unknown, source: ProfileSource, model: string): PaperProfile {
  const data = asRecord(raw)
  const claims = stringList(data.claims, 5, 90)
  const concepts = stringList(data.concepts, 12, 40)
    .map(normalizeConcept)
    .filter((concept, index, list) => list.indexOf(concept) === index)
  const fallbackQuestion = truncate(normalizeSpace(source.paper.title), 60)
  return {
    paperId: source.paper.id,
    question: truncate(normalizeSpace(data.question ?? ''), 80) || fallbackQuestion,
    method: truncate(normalizeSpace(data.method ?? ''), 40),
    approach: truncate(normalizeSpace(data.approach ?? ''), 140),
    claims,
    concepts: concepts.slice(0, 10),
    tasks: stringList(data.tasks, 4, 40),
    limitations: stringList(data.limitations, 3, 60),
    fingerprint: truncate(normalizeSpace(data.fingerprint ?? ''), 220),
    contentHash: profileContentHash(source),
    model,
    createdAt: new Date().toISOString(),
  }
}

const FALLBACK_STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'into', 'over',
  'using', 'based', 'paper', 'work', 'propose', 'proposed', 'result', 'results', 'show',
  'new', 'while', 'being', 'large', 'different', 'similar', 'model', 'models', 'method',
  'methods', 'approach', 'task', 'tasks', 'performance', 'experiment', 'experiments',
])

function fallbackConcepts(title: string, body: string): string[] {
  const titleTokens = tokenize(title).filter((token) => token.length > 2 && !FALLBACK_STOP.has(token))
  const bodyTokens = tokenize(body).filter((token) => token.length > 2 && !FALLBACK_STOP.has(token))
  const weight = new Map<string, number>()
  for (const token of titleTokens) weight.set(token, (weight.get(token) ?? 0) + 4)
  for (const token of bodyTokens) weight.set(token, (weight.get(token) ?? 0) + 1)
  const ranked = [...weight.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([token]) => token)
  // Title bigrams survive tokenisation as their two words; they are what lets a
  // fallback profile still overlap "structured state space" with a real profile.
  const bigrams: string[] = []
  for (let index = 0; index < titleTokens.length - 1; index += 1) {
    bigrams.push(`${titleTokens[index]} ${titleTokens[index + 1]}`)
  }
  return [...bigrams.slice(0, 3), ...ranked].slice(0, 10)
}

/**
 * A profile derived without the model, used when the provider keeps failing.
 * It cannot invent concepts, so it reuses the title/abstract vocabulary: enough
 * for concept + lexical signals and for the adjudicator to still see the paper.
 */
export function fallbackProfile(source: ProfileSource): PaperProfile {
  const { paper, pages } = source
  const text = pagesToText(pages ?? [], { maxChars: 1800 })
  const body = `${paper.abstract ?? ''} ${text}`
  return {
    paperId: paper.id,
    question: truncate(paper.title, 80),
    method: '',
    approach: truncate(body, 160),
    claims: [],
    concepts: fallbackConcepts(paper.title, body),
    tasks: [],
    limitations: [],
    fingerprint: truncate(body, 260),
    contentHash: profileContentHash(source),
    model: 'fallback',
    createdAt: new Date().toISOString(),
  }
}

export function profilePrompt(source: ProfileSource): string {
  const { paper, summary, pages } = source
  const findings = (summary?.findings ?? []).map((item) => `- ${item}`).join('\n')
  return [
    `标题：${paper.title}`,
    paper.year ? `年份：${paper.year}` : '',
    paper.tags?.length ? `标签：${paper.tags.join('、')}` : '',
    paper.abstract ? `摘要：${truncate(paper.abstract, 1200)}` : '',
    summary?.tldr ? `导读一句话：${summary.tldr}` : '',
    summary?.problem ? `问题：${summary.problem}` : '',
    summary?.method ? `方法：${summary.method}` : '',
    findings ? `结论：\n${findings}` : '',
    pages && pages.length > 0
      ? `正文开头：\n${truncate(pagesToText(pages.slice(0, 2), { maxChars: 2600 }), 2600)}`
      : '',
    '',
    '据此输出画像 JSON。',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * One profile. Returns `null` when the model is unavailable or keeps returning
 * unusable JSON — the relation page degrades to deterministic signals instead
 * of failing the import.
 */
export async function buildProfile({
  summoner,
  source,
  signal,
}: {
  summoner: Summoner
  source: ProfileSource
  signal?: AbortSignal
}): Promise<PaperProfile | null> {
  if (!(await summoner.available())) return null
  const target = await summoner.target()
  const model = target ? `${target.provider}/${target.model}` : ''
  const user = profilePrompt(source)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await summoner.json({
        system: PROFILE_SYSTEM,
        user,
        temperature: attempt === 0 ? 0.2 : 0.1,
        maxTokens: 1800,
        signal,
        purpose: 'profile',
      })
      const profile = normalizeProfile(raw, source, model)
      if (profile.concepts.length === 0 && profile.claims.length === 0 && !profile.fingerprint) continue
      return profile
    } catch {
      // Providers throttle bursts; back off before the next attempt.
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
    }
  }
  // The provider is reachable but keeps producing unusable JSON; keep the paper
  // in the graph with a deterministic profile instead of dropping it silently.
  return fallbackProfile(source)
}
