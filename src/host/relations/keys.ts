/**
 * Identifier normalisation for the relation engine.
 *
 * Citation matching is the one deterministic signal we fully trust, so the
 * rules live in one place and both the paper side and the reference side go
 * through them. A reference key is only produced when it is specific enough to
 * be evidence: a DOI, an arXiv id, or a title of reasonable length.
 */

import type { PaperRecord, ReferenceEntry } from '../../shared/domain.js'

export function normalizeDoi(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/[.,;]+$/, '')
}

export function normalizeArxiv(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, '')
    .replace(/^arxiv:\s*/, '')
    .replace(/\.pdf$/, '')
    .replace(/v\d+$/, '')
}

export function normalizePmid(value: unknown): string {
  const digits = String(value ?? '').replace(/\D+/g, '')
  return digits.length > 0 ? digits : ''
}

/** Keep letters and digits in every script; collapse everything else to a space. */
export function normalizeTitle(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Title tokens used for the fuzzy fallback; very short titles never fuzzy match. */
export function titleTokens(value: unknown): string[] {
  return normalizeTitle(value).split(' ').filter((token) => token.length > 1)
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const item of a) if (b.has(item)) shared += 1
  return shared / (a.size + b.size - shared)
}

export interface PaperKeys {
  doi: string
  arxiv: string
  pmid: string
  title: string
  tokens: string[]
}

export function paperKeys(paper: Pick<PaperRecord, 'doi' | 'arxivId' | 'pmid' | 'title'>): PaperKeys {
  return {
    doi: normalizeDoi(paper.doi),
    arxiv: normalizeArxiv(paper.arxivId),
    pmid: normalizePmid(paper.pmid),
    title: normalizeTitle(paper.title),
    tokens: titleTokens(paper.title),
  }
}

export interface ParsedReference {
  index: number
  entry: ReferenceEntry
  doi: string
  arxiv: string
  pmid: string
  title: string
  tokens: string[]
}

export function parseReference(entry: ReferenceEntry, index: number): ParsedReference {
  return {
    index,
    entry,
    doi: normalizeDoi(entry.doi),
    arxiv: normalizeArxiv((entry as { arxivId?: string }).arxivId),
    pmid: normalizePmid(entry.pmid),
    title: normalizeTitle(entry.title),
    tokens: titleTokens(entry.title),
  }
}

/**
 * A stable key for bibliographic coupling. References without an id are keyed
 * by their normalised title (only if it is long enough to be meaningful), which
 * is what makes coupling work for older papers that predate DOIs.
 */
export function referenceKey(reference: ParsedReference): string | null {
  if (reference.doi) return `doi:${reference.doi}`
  if (reference.arxiv) return `arxiv:${reference.arxiv}`
  if (reference.pmid) return `pmid:${reference.pmid}`
  if (reference.title.length >= 22 && reference.tokens.length >= 4) return `title:${reference.title}`
  return null
}

export interface TitleIndex {
  exact: Map<string, string>
  byToken: Map<string, string[]>
  tokens: Map<string, Set<string>>
}

export function buildTitleIndex(papers: Array<{ id: string; title: string }>): TitleIndex {
  const exact = new Map<string, string>()
  const byToken = new Map<string, string[]>()
  const tokens = new Map<string, Set<string>>()
  for (const paper of papers) {
    const normalized = normalizeTitle(paper.title)
    if (normalized.length < 8) continue
    exact.set(normalized, paper.id)
    const set = new Set(titleTokens(normalized))
    tokens.set(paper.id, set)
    for (const token of set) {
      const list = byToken.get(token)
      if (list) list.push(paper.id)
      else byToken.set(token, [paper.id])
    }
  }
  return { exact, byToken, tokens }
}

/**
 * Best title match for a reference, or `null`.
 *
 * Exact normalised equality wins; otherwise a candidate must share at least
 * three tokens and reach 0.9 Jaccard, which tolerates a dropped subtitle but
 * still refuses "A Survey of X" style near-collisions.
 */
export function matchReferenceTitle(
  reference: ParsedReference,
  index: TitleIndex,
): { paperId: string; score: number } | null {
  if (reference.title.length < 8) return null
  const exact = index.exact.get(reference.title)
  if (exact) return { paperId: exact, score: 1 }
  if (reference.tokens.length < 4) return null
  const counts = new Map<string, number>()
  const referenceSet = new Set(reference.tokens)
  for (const token of referenceSet) {
    for (const paperId of index.byToken.get(token) ?? []) {
      counts.set(paperId, (counts.get(paperId) ?? 0) + 1)
    }
  }
  let best: { paperId: string; score: number } | null = null
  for (const [paperId, shared] of counts) {
    if (shared < 3) continue
    const candidateTokens = index.tokens.get(paperId)
    if (!candidateTokens) continue
    const score = jaccard(referenceSet, candidateTokens)
    if (score < 0.9) continue
    if (!best || score > best.score) best = { paperId, score }
  }
  return best
}
