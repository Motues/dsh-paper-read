/** Read models over the store: cards, filters, folder counts, detail views. */

import type {
  Folder,
  Paper,
  PaperDetail,
  PaperRecord,
  Status,
} from '../../shared/domain.js'
import type { Store } from './store.js'

export type FolderFilter = string | null | undefined

export interface ListOptions {
  q?: string
  status?: string
  tag?: string | null
  folder?: FolderFilter
  author?: string | null
  year?: number | null
  venue?: string | null
  sort?: string
}

const CARD_FIELDS = [
  'id', 'title', 'authors', 'year', 'venue', 'pmid', 'tags', 'folder', 'status', 'progress',
  'source', 'pageCount', 'addedAt', 'updatedAt', 'hasFullText', 'hasSummary', 'missing', 'pdfUnavailable',
  'deletedAt',
] as const

export interface FolderView {
  folders: Folder[]
  unfiled: number
  trash: number
}

export interface LibraryQueries {
  cardOf(paper: PaperRecord): Paper
  listPapers(options?: ListOptions): PaperRecord[]
  folderView(): FolderView
  /** Everything the detail endpoint needs except the field that depends on the request (fileUrl). */
  paperView(paper: PaperRecord): Promise<Omit<PaperDetail, 'fileUrl'>>
}

export function cardOf(paper: PaperRecord): Paper {
  const view = {} as Record<string, unknown>
  for (const field of CARD_FIELDS) view[field] = paper[field]
  view.authorLine = (paper.authors ?? []).slice(0, 4).join(', ')
  view.tldr = paper.tldr ?? ''
  view.lastReadAt = paper.lastRead?.at ?? null
  view.lastReadPage = paper.lastRead?.page ?? null
  return view as unknown as Paper
}

export function createLibraryQueries(store: Store): LibraryQueries {
  /** Filtered + sorted card list for the library and recent views. */
  function listPapers({
    q = '',
    status = 'all',
    tag = null,
    folder = null,
    author = null,
    year = null,
    venue = null,
    sort = 'added',
  }: ListOptions = {}): PaperRecord[] {
    const needle = q.trim().toLowerCase()
    let papers = [...store.activePapers()]
    if (status === 'missing') papers = papers.filter((paper) => paper.missing)
    else if (status && status !== 'all') papers = papers.filter((paper) => paper.status === (status as Status))
    if (tag) papers = papers.filter((paper) => (paper.tags ?? []).includes(tag))
    if (folder === 'unfiled') papers = papers.filter((paper) => !paper.folder)
    else if (folder) papers = papers.filter((paper) => paper.folder === folder)
    if (author) papers = papers.filter((paper) => (paper.authors ?? []).includes(author))
    if (year) papers = papers.filter((paper) => paper.year === year)
    if (venue) papers = papers.filter((paper) => paper.venue === venue)
    if (needle) {
      papers = papers.filter((paper) => (
        paper.title?.toLowerCase().includes(needle)
        || (paper.authors ?? []).join(' ').toLowerCase().includes(needle)
        || (paper.tldr ?? '').toLowerCase().includes(needle)
        || (paper.abstract ?? '').toLowerCase().includes(needle)
        || (paper.venue ?? '').toLowerCase().includes(needle)
        || (paper.doi ?? '').toLowerCase().includes(needle)
        || (paper.arxivId ?? '').toLowerCase().includes(needle)
        || (paper.pmid ?? '').toLowerCase().includes(needle)
        || (paper.tags ?? []).some((item) => item.toLowerCase().includes(needle))
      ))
    }
    if (sort === 'recent') {
      papers = papers
        .filter((paper) => Boolean(paper.lastRead?.at))
        .sort((a, b) => String(b.lastRead?.at).localeCompare(String(a.lastRead?.at)))
    }
    return papers
  }

  function folderView(): FolderView {
    const counts = new Map<string, number>()
    let unfiled = 0
    let trash = 0
    for (const paper of store.papers()) {
      if (paper.deletedAt) {
        trash += 1
        continue
      }
      if (!paper.folder) {
        unfiled += 1
        continue
      }
      counts.set(paper.folder, (counts.get(paper.folder) ?? 0) + 1)
    }
    return {
      folders: store.folders().map((folder) => ({ ...folder, count: counts.get(folder.id) ?? 0 })) as Folder[],
      unfiled,
      trash,
    }
  }

  async function paperView(paper: PaperRecord): Promise<Omit<PaperDetail, 'fileUrl'>> {
    const [summary, annotations, notes, references] = await Promise.all([
      store.readSummary(paper.id),
      store.readAnnotations(paper.id),
      store.readNotes(paper.id),
      store.readReferences(paper.id),
    ])
    return {
      ...cardOf(paper),
      abstract: paper.abstract,
      doi: paper.doi,
      arxivId: paper.arxivId,
      references,
      sourceUrl: paper.sourceUrl,
      filePath: paper.filePath,
      lastRead: paper.lastRead,
      summary: summary ?? null,
      annotations,
      notes,
    }
  }

  return { cardOf, listPapers, folderView, paperView }
}
