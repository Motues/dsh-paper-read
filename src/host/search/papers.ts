/**
 * Library-wide search over paper metadata, notes and parsed full text.
 *
 * Metadata is matched directly (so abstracts, venues and identifiers are
 * searchable even when a paper has no parsed text), while notes and full text
 * reuse the existing BM25 indexes. The client only needs paper ids and the
 * best snippet: the library page already owns the card list.
 */

import type {
  LibrarySearchField,
  LibrarySearchMatch,
  LibrarySearchPayload,
  PaperRecord,
} from '../../shared/domain.js'
import { normalizeSpace, truncate } from '../util/util.js'
import type { Store } from '../library/store.js'
import type { Indexer } from './indexer.js'

const FIELD_ORDER: LibrarySearchField[] = [
  'title',
  'author',
  'tag',
  'summary',
  'abstract',
  'venue',
  'identifier',
  'note',
  'fulltext',
]

interface WorkingMatch {
  paperId: string
  fields: Set<LibrarySearchField>
  page?: number
  quote?: string
  score: number
}

function metadataHaystacks(paper: PaperRecord): Array<[LibrarySearchField, string]> {
  return [
    ['title', paper.title ?? ''],
    ['author', (paper.authors ?? []).join(' ')],
    ['tag', (paper.tags ?? []).join(' ')],
    ['summary', paper.tldr ?? ''],
    ['abstract', paper.abstract ?? ''],
    ['venue', paper.venue ?? ''],
    ['identifier', [paper.doi, paper.arxivId, paper.pmid].filter(Boolean).join(' ')],
  ]
}

function matchesText(text: string, needle: string, terms: string[]): boolean {
  const haystack = normalizeSpace(text).toLowerCase()
  if (!haystack) return false
  if (terms.length > 1) return terms.every((term) => haystack.includes(term))
  return haystack.includes(needle)
}

export async function searchLibraryPapers({
  store,
  indexer,
  query,
  limit = 200,
}: {
  store: Store
  indexer: Indexer
  query: string
  limit?: number
}): Promise<LibrarySearchPayload> {
  const trimmed = normalizeSpace(query)
  if (!trimmed) return { query: '', matches: [], total: 0 }
  const needle = trimmed.toLowerCase()
  const terms = needle.split(/\s+/).filter(Boolean)
  const papers = store.activePapers()
  const byId = new Map(papers.map((paper) => [paper.id, paper]))
  const matches = new Map<string, WorkingMatch>()

  const ensure = (paperId: string): WorkingMatch => {
    const existing = matches.get(paperId)
    if (existing) return existing
    const created: WorkingMatch = { paperId, fields: new Set(), score: 0 }
    matches.set(paperId, created)
    return created
  }

  // ── metadata: direct, case-insensitive matching ──────────────────────────
  for (const paper of papers) {
    for (const [field, text] of metadataHaystacks(paper)) {
      if (!matchesText(text, needle, terms)) continue
      const entry = ensure(paper.id)
      entry.fields.add(field)
      if (!entry.quote && (field === 'abstract' || field === 'venue')) {
        entry.quote = truncate(normalizeSpace(text), 180)
      }
    }
  }

  // ── notes + full text: the existing BM25 indexes ─────────────────────────
  await indexer.ensureIndex()
  const noteHits = indexer.notesIndex.search(trimmed, { limit: 400 })
  const chunkHits = indexer.index.search(trimmed, { limit: 800 })
  const best = new Map<string, { score: number; field: LibrarySearchField; page: number; quote: string }>()
  for (const hit of [...noteHits, ...chunkHits]) {
    if (!byId.has(hit.doc.paperId)) continue
    const field: LibrarySearchField = hit.doc.kind === 'note' ? 'note' : 'fulltext'
    const current = best.get(hit.doc.paperId)
    if (!current || hit.score > current.score) {
      best.set(hit.doc.paperId, {
        score: hit.score,
        field,
        page: hit.doc.page,
        quote: truncate(normalizeSpace(hit.doc.text), 180),
      })
    }
  }
  for (const [paperId, hit] of best) {
    const entry = ensure(paperId)
    entry.fields.add(hit.field)
    if (hit.score >= entry.score) {
      entry.score = hit.score
      entry.page = hit.page
      entry.quote = hit.quote
    }
  }

  const total = matches.size
  const list: LibrarySearchMatch[] = [...matches.values()]
    .sort((left, right) => right.score - left.score || left.paperId.localeCompare(right.paperId))
    .slice(0, Math.max(1, Math.min(500, limit)))
    .map((entry) => ({
      paperId: entry.paperId,
      fields: FIELD_ORDER.filter((field) => entry.fields.has(field)),
      ...(entry.page !== undefined ? { page: entry.page } : {}),
      ...(entry.quote ? { quote: entry.quote } : {}),
    }))

  return { query: trimmed, matches: list, total }
}
