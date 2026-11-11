/**
 * Deterministic relatedness: the part that still works with no model.
 *
 * Four signals, all naturally in 0–1 so no corpus-wide rescaling is needed:
 * shared references (bibliographic coupling), IDF-weighted concept overlap,
 * claim/fingerprint overlap, and plain lexical overlap. Citation edges are
 * derived separately because they are evidence, not similarity.
 */

import type {
  PaperProfile,
  PaperRecord,
  ReferenceEntry,
  RelationEdge,
  RelationSignals,
} from '../../shared/domain.js'
import { tokenize, truncate, clamp } from '../util/util.js'
import {
  buildTitleIndex,
  matchReferenceTitle,
  normalizeArxiv,
  normalizeDoi,
  normalizePmid,
  parseReference,
  paperKeys,
  referenceKey,
  type PaperKeys,
} from './keys.js'

export const FUSION = { ref: 0.2, concept: 0.3, claim: 0.25, lexical: 0.25 } as const
export const CANDIDATE_THRESHOLD = 0.08
export const CANDIDATE_LIMIT = 6

export interface CorpusDoc {
  id: string
  lexical: Map<string, number>
  lexicalNorm: number
  claim: Map<string, number>
  claimNorm: number
  concepts: Map<string, number>
  conceptNorm: number
  /** Exact concept phrases, for the small probability of a literal overlap. */
  phrases: Set<string>
  refs: Set<string>
  refTitles: Map<string, string>
}

export interface Corpus {
  docs: Map<string, CorpusDoc>
  size: number
}

function weightedVector(tokens: string[], df: Map<string, number>, total: number): { vector: Map<string, number>; norm: number } {
  const tf = new Map<string, number>()
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
  const vector = new Map<string, number>()
  let sum = 0
  for (const [token, count] of tf) {
    // Same capped idf as concepts: this is a similarity feature, not a ranking
    // feature, and BM25's idf drives shared vocabulary to zero in small corpora.
    const idf = 1 + 0.45 * Math.log(1 + total / Math.max(1, df.get(token) ?? 1))
    const weight = (1 + Math.log(count)) * idf
    if (weight <= 0) continue
    vector.set(token, weight)
    sum += weight * weight
  }
  return { vector, norm: Math.sqrt(sum) }
}

/**
 * Academic filler that says nothing about the topic. Shared references and
 * concepts already carry the precise vocabulary; these tokens only add noise to
 * the cosine.
 */
const GENERIC_TOKENS = new Set([
  'new', 'being', 'while', 'large', 'propose', 'proposed', 'proposal', 'result', 'results',
  'show', 'shows', 'shown', 'using', 'used', 'use', 'based', 'paper', 'work', 'works',
  'different', 'similar', 'performance', 'experiment', 'experiments', 'dataset', 'datasets',
  'approach', 'method', 'methods', 'model', 'models', 'task', 'tasks', 'state-of-the-art',
  'first', 'also', 'however', 'thus', 'therefore', 'further', 'many', 'much', 'one', 'two',
])

function featureTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !GENERIC_TOKENS.has(token))
}

/**
 * Concept similarity runs on *tokens of the concept phrases*, not the literal
 * phrases: two models rarely phrase the same idea identically, but "自注意力"
 * and "self-attention / 自注意力" share enough tokens to be comparable. The IDF
 * is deliberately capped — in a small library a term shared by two papers is
 * the strongest signal we have, and the BM25-style idf would suppress it.
 */
function conceptVector(tokens: string[], df: Map<string, number>, total: number): { vector: Map<string, number>; norm: number } {
  const tf = new Map<string, number>()
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
  const vector = new Map<string, number>()
  let sum = 0
  for (const [token, count] of tf) {
    const idf = 1 + 0.45 * Math.log(1 + total / Math.max(1, df.get(token) ?? 1))
    const weight = (1 + Math.log(count)) * idf
    vector.set(token, weight)
    sum += weight * weight
  }
  return { vector, norm: Math.sqrt(sum) }
}

function cosine(a: Map<string, number>, normA: number, b: Map<string, number>, normB: number): number {
  if (normA === 0 || normB === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [key, value] of small) {
    const other = large.get(key)
    if (other) dot += value * other
  }
  return clamp(dot / (normA * normB), 0, 1)
}

export function buildCorpus({
  papers,
  profiles,
  references,
}: {
  papers: PaperRecord[]
  profiles: Map<string, PaperProfile>
  references: Map<string, ReferenceEntry[]>
}): Corpus {
  const docsMeta = papers.map((paper) => {
    const profile = profiles.get(paper.id)
    // The title is the most discriminative piece of text; repeating it gives it
    // twice the weight of the abstract in the TF-IDF vector.
    const lexicalText = [paper.title, paper.title, paper.abstract ?? '', paper.tldr ?? ''].join(' ')
    const claimText = [
      profile?.question ?? '',
      profile?.method ?? '',
      profile?.approach ?? '',
      profile?.claims.join('。') ?? '',
      profile?.tasks.join('、') ?? '',
      profile?.fingerprint ?? '',
    ].join(' ')
    const conceptPhrases = profile?.concepts ?? []
    return { paper, profile, lexicalText, claimText, conceptPhrases, conceptTokens: tokenize(conceptPhrases.join(' ')) }
  })

  const dfLexical = new Map<string, number>()
  const dfClaim = new Map<string, number>()
  const dfConcept = new Map<string, number>()
  const tokenized = docsMeta.map((meta) => {
    const lexical = featureTokens(tokenize(meta.lexicalText))
    const claim = featureTokens(tokenize(meta.claimText))
    for (const token of new Set(lexical)) dfLexical.set(token, (dfLexical.get(token) ?? 0) + 1)
    for (const token of new Set(claim)) dfClaim.set(token, (dfClaim.get(token) ?? 0) + 1)
    for (const token of new Set(meta.conceptTokens)) dfConcept.set(token, (dfConcept.get(token) ?? 0) + 1)
    return { meta, lexical, claim }
  })

  const total = docsMeta.length || 1

  const docs = new Map<string, CorpusDoc>()
  for (const { meta, lexical, claim } of tokenized) {
    const lexicalVector = weightedVector(lexical, dfLexical, total)
    const claimVector = weightedVector(claim, dfClaim, total)
    const concepts = conceptVector(meta.conceptTokens, dfConcept, total)
    const phrases = new Set(meta.conceptPhrases.map((phrase) => phrase.toLowerCase().trim()).filter(Boolean))
    const refs = new Set<string>()
    const refTitles = new Map<string, string>()
    for (const [index, entry] of (references.get(meta.paper.id) ?? []).entries()) {
      const parsed = parseReference(entry, index)
      const key = referenceKey(parsed)
      if (!key) continue
      refs.add(key)
      if (!refTitles.has(key)) refTitles.set(key, truncate(entry.title || entry.raw || key, 90))
    }
    docs.set(meta.paper.id, {
      id: meta.paper.id,
      lexical: lexicalVector.vector,
      lexicalNorm: lexicalVector.norm,
      claim: claimVector.vector,
      claimNorm: claimVector.norm,
      concepts: concepts.vector,
      conceptNorm: concepts.norm,
      phrases,
      refs,
      refTitles,
    })
  }
  return { docs, size: papers.length }
}

/**
 * Which of the four signals could actually be computed for this pair.
 *
 * Missing is not the same as zero: a paper whose references were never parsed
 * has no `ref` signal at all, and scoring it as 0 would punish it for a gap in
 * the data. Fusion only averages over the signals both sides can supply.
 */
export interface SignalAvailability {
  ref: boolean
  concept: boolean
  claim: boolean
  lexical: boolean
}

export interface PairSignals {
  ref: number
  concept: number
  claim: number
  lexical: number
  available: SignalAvailability
  sharedRefs: string[]
  sharedConcepts: string[]
}

const SIGNAL_KEYS = ['ref', 'concept', 'claim', 'lexical'] as const

type SignalValues = Pick<PairSignals, 'ref' | 'concept' | 'claim' | 'lexical'>

export function signalsFor(a: CorpusDoc, b: CorpusDoc): PairSignals {
  let ref = 0
  const sharedRefs: string[] = []
  if (a.refs.size > 0 && b.refs.size > 0) {
    let shared = 0
    for (const key of a.refs) {
      if (!b.refs.has(key)) continue
      shared += 1
      if (sharedRefs.length < 4) sharedRefs.push(a.refTitles.get(key) ?? key)
    }
    ref = shared / Math.sqrt(a.refs.size * b.refs.size)
  }
  const sharedConcepts: string[] = []
  const phraseMatches: string[] = []
  for (const phrase of a.phrases) {
    if (!b.phrases.has(phrase)) continue
    phraseMatches.push(phrase)
    if (sharedConcepts.length < 4) sharedConcepts.push(phrase)
  }
  const phraseScore = phraseMatches.length / Math.sqrt(Math.max(1, a.phrases.size) * Math.max(1, b.phrases.size))
  const tokenSimilarity = cosine(a.concepts, a.conceptNorm, b.concepts, b.conceptNorm)
  return {
    ref: clamp(ref, 0, 1),
    concept: clamp(0.7 * tokenSimilarity + 0.3 * phraseScore, 0, 1),
    claim: cosine(a.claim, a.claimNorm, b.claim, b.claimNorm),
    lexical: cosine(a.lexical, a.lexicalNorm, b.lexical, b.lexicalNorm),
    available: {
      ref: a.refs.size > 0 && b.refs.size > 0,
      concept: (a.concepts.size > 0 || a.phrases.size > 0) && (b.concepts.size > 0 || b.phrases.size > 0),
      claim: a.claimNorm > 0 && b.claimNorm > 0,
      lexical: a.lexicalNorm > 0 && b.lexicalNorm > 0,
    },
    sharedRefs,
    sharedConcepts,
  }
}

/**
 * Weighted mean over the signals both papers can supply. When every signal is
 * present this is exactly the old fixed-weight sum; when one is missing its
 * weight is redistributed instead of being counted as zero.
 */
export function fuseSignals(signals: SignalValues & { available?: SignalAvailability }, external = 0): number {
  let weight = 0
  let sum = 0
  for (const key of SIGNAL_KEYS) {
    if (signals.available && !signals.available[key]) continue
    const w = FUSION[key]
    weight += w
    sum += w * signals[key]
  }
  const base = weight > 0 ? sum / weight : 0
  if (external <= 0) return clamp(base, 0, 1)
  return clamp(base * 0.9 + 0.1 * external, 0, 1)
}

/** Persisted signals: a missing signal stays missing rather than saving a 0. */
export function signalsRecord(signals: PairSignals): RelationSignals {
  const round = (value: number): number => Math.round(value * 1000) / 1000
  const record: RelationSignals = {}
  for (const key of SIGNAL_KEYS) {
    if (signals.available && !signals.available[key]) continue
    record[key] = round(signals[key])
  }
  return record
}

export interface CandidatePair {
  a: string
  b: string
  score: number
  signals: PairSignals
}

/** Every pair above the bar, capped per paper so a hub cannot flood the graph. */
export function shortlist(corpus: Corpus, { threshold = CANDIDATE_THRESHOLD, limit = CANDIDATE_LIMIT } = {}): CandidatePair[] {
  const ids = [...corpus.docs.keys()]
  const pairs: CandidatePair[] = []
  for (let i = 0; i < ids.length; i += 1) {
    const a = corpus.docs.get(ids[i]) as CorpusDoc
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = corpus.docs.get(ids[j]) as CorpusDoc
      const signals = signalsFor(a, b)
      const score = fuseSignals(signals)
      if (score < threshold) continue
      // Two independent signals, or one when only one could be computed at all.
      const usable = SIGNAL_KEYS.filter((key) => signals.available[key])
      const strong = usable.filter((key) => signals[key] >= 0.06).length
      if (strong < Math.min(2, usable.length)) continue
      pairs.push({ a: a.id, b: b.id, score, signals })
    }
  }
  pairs.sort((left, right) => right.score - left.score || left.a.localeCompare(right.a) || left.b.localeCompare(right.b))
  const perNode = new Map<string, number>()
  const kept: CandidatePair[] = []
  for (const pair of pairs) {
    const countA = perNode.get(pair.a) ?? 0
    const countB = perNode.get(pair.b) ?? 0
    if (countA >= limit || countB >= limit) continue
    perNode.set(pair.a, countA + 1)
    perNode.set(pair.b, countB + 1)
    kept.push(pair)
  }
  return kept
}

/** Per-paper candidate lists (the unit the adjudicator works in). */
export function candidatesByPaper(pairs: CandidatePair[]): Map<string, Array<{ other: string; score: number; signals: PairSignals }>> {
  const map = new Map<string, Array<{ other: string; score: number; signals: PairSignals }>>()
  for (const pair of pairs) {
    const forward = map.get(pair.a) ?? []
    forward.push({ other: pair.b, score: pair.score, signals: pair.signals })
    map.set(pair.a, forward)
    const backward = map.get(pair.b) ?? []
    backward.push({ other: pair.a, score: pair.score, signals: pair.signals })
    map.set(pair.b, backward)
  }
  for (const list of map.values()) list.sort((left, right) => right.score - left.score)
  return map
}

interface PaperLookup {
  keys: PaperKeys
  id: string
}

/**
 * Resolve each paper's reference list against the live library. DOI wins, then
 * arXiv/PMID, then an exact title, then a strict fuzzy title.
 */
export function citationEdges({
  papers,
  references,
}: {
  papers: PaperRecord[]
  references: Map<string, ReferenceEntry[]>
}): RelationEdge[] {
  const live = papers.filter((paper) => !paper.deletedAt)
  const lookups: PaperLookup[] = live.map((paper) => ({ id: paper.id, keys: paperKeys(paper) }))
  const byDoi = new Map<string, string>()
  const byArxiv = new Map<string, string>()
  const byPmid = new Map<string, string>()
  for (const lookup of lookups) {
    if (lookup.keys.doi) byDoi.set(lookup.keys.doi, lookup.id)
    if (lookup.keys.arxiv) byArxiv.set(lookup.keys.arxiv, lookup.id)
    if (lookup.keys.pmid) byPmid.set(lookup.keys.pmid, lookup.id)
  }
  const titleIndex = buildTitleIndex(live)

  const edges = new Map<string, RelationEdge>()
  for (const paper of live) {
    for (const [index, entry] of (references.get(paper.id) ?? []).entries()) {
      const parsed = parseReference(entry, index)
      let target: string | undefined
      let confidence = 0
      if (parsed.doi) {
        target = byDoi.get(parsed.doi)
        confidence = 0.98
      }
      if (!target && parsed.arxiv) {
        target = byArxiv.get(parsed.arxiv)
        confidence = 0.97
      }
      if (!target && parsed.pmid) {
        target = byPmid.get(parsed.pmid)
        confidence = 0.96
      }
      if (!target) {
        const match = matchReferenceTitle(parsed, titleIndex)
        if (match) {
          target = match.paperId
          confidence = match.score >= 1 ? 0.92 : 0.8 * match.score
        }
      }
      if (!target || target === paper.id) continue
      const key = `${paper.id}->${target}`
      const existing = edges.get(key)
      if (existing && existing.confidence >= confidence) continue
      edges.set(key, {
        from: paper.id,
        to: target,
        kind: 'cites',
        reason: truncate(`参考文献 [${index + 1}]：${entry.title || entry.raw || parsed.doi || parsed.arxiv || ''}`, 120),
        origin: 'auto',
        confidence,
        status: 'confirmed',
        evidence: { refIndex: index },
      })
    }
  }
  return [...edges.values()]
}

/** Normalise a DOI/arXiv id captured from a reference string. */
export function referenceIdentifiers(entry: ReferenceEntry): { doi: string; arxiv: string; pmid: string } {
  return { doi: normalizeDoi(entry.doi), arxiv: normalizeArxiv(entry.url), pmid: normalizePmid(entry.pmid) }
}
