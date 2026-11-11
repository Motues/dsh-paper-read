/**
 * Keeps the two BM25 indexes (full text + notes) in step with the store.
 *
 * The index is built lazily on first search: a cold plugin start must not read
 * every paper before answering a request.
 */

import type { Store } from '../library/store.js'
import { Bm25Index } from './bm25.js'

export interface ReindexResult {
  papers: number
  chunks: number
  notes: number
}

export interface Indexer {
  index: Bm25Index
  notesIndex: Bm25Index
  ensureIndex(): Promise<void>
  reindexPaper(paperId: string): Promise<void>
  reindexAll(): Promise<ReindexResult>
  removePaper(paperId: string): void
}

function reset(index: Bm25Index): void {
  index.docs = []
  index.df.clear()
  index.byId.clear()
  index.totalLen = 0
}

export function createIndexer(store: Store): Indexer {
  const index = new Bm25Index()
  const notesIndex = new Bm25Index()
  let indexLoading: Promise<void> | null = null
  let indexLoaded = false

  async function ensureIndex(): Promise<void> {
    if (indexLoaded) return
    indexLoading ??= (async () => {
      reset(index)
      reset(notesIndex)
      for (const paper of store.activePapers()) {
        if (paper.missing) continue
        const chunks = await store.readChunks(paper.id)
        index.addDocs(chunks.map((chunk) => ({ ...chunk, kind: 'chunk' })))
        const notes = await store.readNotes(paper.id)
        notesIndex.addDocs(
          notes
            .filter((note) => note.body.length > 0)
            .map((note) => ({
              id: note.id,
              paperId: paper.id,
              page: note.page ?? 1,
              text: note.body,
              kind: 'note',
            })),
        )
        const annotations = await store.readAnnotations(paper.id)
        notesIndex.addDocs(
          annotations
            .filter((annotation) => (annotation.note ?? '').trim().length > 0)
            .map((annotation) => ({
              id: `annotation:${annotation.id}`,
              paperId: paper.id,
              page: annotation.page,
              text: annotation.note ?? '',
              kind: 'note',
            })),
        )
      }
      indexLoaded = true
    })()
    await indexLoading
  }

  async function reindexPaper(paperId: string): Promise<void> {
    indexLoaded = false
    indexLoading = null
    index.removePaper(paperId)
    notesIndex.removePaper(paperId)
    // A trashed paper stays out of the index until it is restored.
    if (store.getPaper(paperId)?.deletedAt) return
    const chunks = await store.readChunks(paperId)
    if (chunks.length > 0) index.addDocs(chunks.map((chunk) => ({ ...chunk, kind: 'chunk' })))
    const notes = await store.readNotes(paperId)
    if (notes.length > 0) {
      notesIndex.addDocs(
        notes.map((note) => ({ id: note.id, paperId, page: note.page ?? 1, text: note.body, kind: 'note' })),
      )
    }
    const annotations = await store.readAnnotations(paperId)
    const annotated = annotations.filter((annotation) => (annotation.note ?? '').trim().length > 0)
    if (annotated.length > 0) {
      notesIndex.addDocs(
        annotated.map((annotation) => ({
          id: `annotation:${annotation.id}`,
          paperId,
          page: annotation.page,
          text: annotation.note ?? '',
          kind: 'note',
        })),
      )
    }
  }

  async function reindexAll(): Promise<ReindexResult> {
    reset(index)
    reset(notesIndex)
    indexLoaded = false
    indexLoading = null
    await ensureIndex()
    return { papers: store.activePapers().length, chunks: index.size, notes: notesIndex.size }
  }

  function removePaper(paperId: string): void {
    index.removePaper(paperId)
    notesIndex.removePaper(paperId)
  }

  return { index, notesIndex, ensureIndex, reindexPaper, reindexAll, removePaper }
}
