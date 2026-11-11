/**
 * Durable library storage.
 *
 * Layout ($DSH_HOME/paperreader/):
 *   library.json                  papers + collections
 *   config.json                   watch folders, model route, limits
 *   relations.json                every Edge, both directions derived on read
 *   (paper records live in library.json; papers/<id>/ holds derived data)
 *   papers/<id>/summary.json      Summary
 *   papers/<id>/pages.json        PageText[]
 *   papers/<id>/references.json   ReferenceEntry[]
 *   papers/<id>/chunks.json       Chunk[]
 *   papers/<id>/annotations.json  Annotation[]
 *   papers/<id>/notes.json        Note[]
 *   workspace/                    shared cwd of every per-paper DSH session
 *   jobs/<jobId>.json             import job state
 *   inbox/                        default watch folder for uploads
 *   files/<id>.pdf                copies of PDFs downloaded from links
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Annotation,
  AppConfig,
  Folder,
  HighlightColor,
  Job,
  Note,
  PageText,
  PaperProfile,
  PaperRecord,
  ReferenceEntry,
  RelationEdge,
  RelationInsight,
  Summary,
  TranslationFile,
} from '../../shared/domain.js'
import type { Chunk } from '../pdf/chunk.js'
import type { VisualFile } from '../pdf/visuals.js'
import { EDGE_KINDS } from '../../shared/labels.js'
import { normalizeTranslationSettings } from '../../shared/translation.js'
import { ensureDir, newId, nowIso, readJson, readJsonBackup, writeJson } from '../util/util.js'

/** A folder as persisted: the API adds the computed `count` on read. */
export type StoredFolder = Omit<Folder, 'count'> & { count?: number }

/** Cached judgment for one ordered pair; a content hash change invalidates it. */
export interface StoredJudgment {
  fingerprint: string
  kind: string
  direction?: string
  reason: string
  evidenceA?: string
  evidenceB?: string
  confidence: number
  model?: string
  at: string
}

/** `relations-meta.json`: caches that are too noisy to live in the edge file. */
export interface RelationsMeta {
  version: number
  clusterNames?: { signature: string; names: string[]; at: string; model: string }
  judgments?: Record<string, StoredJudgment>
  lastRebuild?: { at: string; papers: number; edges: number; profiles: number; model?: string }
}

const EMPTY_META = (): RelationsMeta => ({ version: 1, judgments: {} })

interface LibraryFile {
  version: number
  papers: PaperRecord[]
  folders: StoredFolder[]
}

interface AnnotationInput {
  page?: unknown
  rects?: unknown
  quote?: unknown
  prefix?: unknown
  suffix?: unknown
  color?: HighlightColor
  note?: unknown
  noteId?: unknown
}

interface AnnotationPatch {
  color?: HighlightColor
  note?: string
  rects?: number[][]
  page?: number
  noteId?: string
}

interface NoteInput {
  page?: unknown
  body?: unknown
  origin?: unknown
}

const EMPTY_LIBRARY = (): LibraryFile => ({ version: 3, papers: [], folders: [] })

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  watchFolders: [],
  provider: '',
  model: '',
  autoSummarize: true,
  summarizeBudgetChars: 60000,
  maxImportBytes: 80 * 1024 * 1024,
  aiEnabled: true,
  paperSessionInSidebar: false,
  relationsUseModel: true,
  experimentalFullTextTranslation: false,
  experimentalTranslationSources: false,
  translation: normalizeTranslationSettings(undefined),
  experimentalTaskCenter: false,
  libraryDefaultView: 'list',
  recentLimit: 20,
}

export class Store {
  home: string
  root: string
  libraryFile: string
  configFile: string
  relationsFile: string
  metaFile: string
  inbox: string
  filesDir: string
  jobsDir: string
  library: LibraryFile
  config: AppConfig
  relations: RelationEdge[]
  meta: RelationsMeta
  private queues = new Map<string, Promise<unknown>>()
  private loaded: Promise<this> | null = null

  constructor(home: string) {
    this.home = home
    this.root = path.join(home, 'paperreader')
    this.libraryFile = path.join(this.root, 'library.json')
    this.configFile = path.join(this.root, 'config.json')
    this.relationsFile = path.join(this.root, 'relations.json')
    this.metaFile = path.join(this.root, 'relations-meta.json')
    this.inbox = path.join(this.root, 'inbox')
    this.filesDir = path.join(this.root, 'files')
    this.jobsDir = path.join(this.root, 'jobs')

    this.library = EMPTY_LIBRARY()
    this.config = { ...DEFAULT_CONFIG }
    this.relations = []
    this.meta = EMPTY_META()
  }

  /** Load once; concurrent callers share the same promise. */
  load(): Promise<this> {
    this.loaded ??= this.#load()
    return this.loaded
  }

  async #load(): Promise<this> {
    await ensureDir(this.root)
    await ensureDir(this.inbox)
    await ensureDir(this.filesDir)
    await ensureDir(this.jobsDir)
    await ensureDir(this.workspaceDir)
    this.library = await readJson(this.libraryFile, EMPTY_LIBRARY())
    const storedConfig = await readJson<Partial<AppConfig>>(this.configFile, {})
    this.config = {
      ...DEFAULT_CONFIG,
      ...storedConfig,
      // Nested settings need their own merge; a shallow spread would drop every
      // field the previous version did not write.
      translation: normalizeTranslationSettings(storedConfig.translation),
    } as AppConfig
    this.relations = this.#migrateRelations(await readJson<RelationEdge[]>(this.relationsFile, []))
    this.meta = { ...EMPTY_META(), ...(await readJson<Partial<RelationsMeta>>(this.metaFile, {})) } as RelationsMeta
    if (!this.config.watchFolders?.length) {
      this.config.watchFolders = [this.inbox]
      await writeJson(this.configFile, this.config)
    }
    if (!this.library.papers) this.library.papers = []
    if (!Array.isArray(this.library.folders)) this.library.folders = []
    // Migration: v3 nests folders with `parentId`; v2 folders were flat.
    const folderIds = new Set(this.library.folders.map((folder) => folder.id))
    for (const folder of this.library.folders) {
      if (folder.parentId === undefined) folder.parentId = null
      // A dangling parent would hide the folder from the tree; make it a root.
      if (folder.parentId !== null && !folderIds.has(folder.parentId)) folder.parentId = null
    }
    this.library.version = 3
    // Migration: v1 stored `collections: string[]`, v2 stores one `folder`.
    // References briefly lived in library.json before moving to per-paper files.
    let migrated = false
    for (const paper of this.library.papers) {
      if (paper.folder === undefined) paper.folder = null
      if (paper.collections !== undefined) delete paper.collections
      const legacy = paper as PaperRecord & { references?: ReferenceEntry[] }
      if (Array.isArray(legacy.references)) {
        if (legacy.references.length > 0) await this.writeReferences(paper.id, legacy.references)
        delete legacy.references
        migrated = true
      }
    }
    if (migrated) await this.saveLibrary()
    return this
  }

  folders(): StoredFolder[] {
    return this.library.folders
  }

  getFolder(id: string): StoredFolder | undefined {
    return this.library.folders.find((folder) => folder.id === id)
  }

  /** Direct children of a folder (`null` = top level), in creation order. */
  childFolders(parentId: string | null): StoredFolder[] {
    return this.library.folders.filter((folder) => (folder.parentId ?? null) === parentId)
  }

  /** The folder itself plus every descendant folder id. */
  folderSubtree(id: string): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const walk = (current: string): void => {
      if (seen.has(current)) return
      seen.add(current)
      out.push(current)
      for (const child of this.childFolders(current)) walk(child.id)
    }
    walk(id)
    return out
  }

  #sameSiblingName(name: string, parentId: string | null, exceptId?: string): boolean {
    return this.library.folders.some((folder) => (
      folder.id !== exceptId
      && (folder.parentId ?? null) === parentId
      && folder.name.toLowerCase() === name.toLowerCase()
    ))
  }

  async addFolder(name: unknown, parentId: unknown = null): Promise<Folder> {
    const trimmed = String(name ?? '').trim().slice(0, 60)
    if (trimmed === '') throw new Error('文件夹名不能为空')
    const parent = parentId === null || parentId === undefined || parentId === '' ? null : String(parentId)
    if (parent !== null && !this.getFolder(parent)) throw new Error('上级文件夹不存在')
    if (this.#sameSiblingName(trimmed, parent)) throw new Error('同一层已经有同名文件夹')
    const folder: StoredFolder = {
      id: `f_${newId('').slice(1, 13)}`,
      name: trimmed,
      parentId: parent,
      createdAt: nowIso(),
    }
    this.library.folders.push(folder)
    await this.saveLibrary()
    return { ...folder, count: 0 }
  }

  async renameFolder(id: string, name: unknown): Promise<StoredFolder | null> {
    const folder = this.getFolder(id)
    if (!folder) return null
    const trimmed = String(name ?? '').trim().slice(0, 60)
    if (trimmed === '') throw new Error('文件夹名不能为空')
    if (this.#sameSiblingName(trimmed, folder.parentId ?? null, id)) throw new Error('同一层已经有同名文件夹')
    folder.name = trimmed
    await this.saveLibrary()
    return folder
  }

  /**
   * Move one folder under `parentId` (`null` = root) and place it before
   * `beforeId` among that parent's children. A null `beforeId` appends it as
   * the last child. Sibling order is the flat array's order, so the move is a
   * remove + insert; descendants follow their parent by `parentId`.
   */
  async moveFolder(id: string, parentId: string | null, beforeId: string | null): Promise<StoredFolder | null> {
    const folder = this.getFolder(id)
    if (!folder) return null
    if (parentId !== null && !this.getFolder(parentId)) throw new Error('上级文件夹不存在')
    if (parentId !== null && this.folderSubtree(id).includes(parentId)) {
      throw new Error('不能移动到自己的子文件夹里')
    }
    if (this.#sameSiblingName(folder.name, parentId, id)) throw new Error('同一层已经有同名文件夹')
    if (beforeId !== null) {
      if (beforeId === id) throw new Error('目标位置已变化，请重试')
      const before = this.getFolder(beforeId)
      if (!before || (before.parentId ?? null) !== parentId) throw new Error('目标位置已变化，请重试')
    }

    const list = this.library.folders
    const index = list.indexOf(folder)
    if (index >= 0) list.splice(index, 1)
    folder.parentId = parentId

    let insertAt = list.length
    if (beforeId !== null) {
      const targetIndex = list.findIndex((entry) => entry.id === beforeId)
      if (targetIndex >= 0) insertAt = targetIndex
    } else {
      // Append after the last sibling in the flat array. Folders of other
      // branches can sit in between; only the relative sibling order matters.
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if ((list[i].parentId ?? null) === parentId) {
          insertAt = i + 1
          break
        }
      }
    }
    list.splice(insertAt, 0, folder)
    await this.saveLibrary()
    return folder
  }

  /**
   * Deleting a folder removes its whole subtree and never deletes papers:
   * every paper inside those folders becomes unfiled.
   *
   * Returns the removed folder ids (empty when the folder did not exist).
   */
  async removeFolder(id: string): Promise<string[]> {
    const targets = this.folderSubtree(id)
    const referenced = new Set(this.library.folders.map((folder) => folder.id))
    if (!referenced.has(id)) return []
    const removed = new Set(targets)
    this.library.folders = this.library.folders.filter((folder) => !removed.has(folder.id))
    for (const paper of this.library.papers) {
      if (paper.folder && removed.has(paper.folder)) paper.folder = null
    }
    await this.saveLibrary()
    return targets
  }

  /** Soft delete: the record, its PDF and all annotations stay on disk. */
  async trashPaper(id: string): Promise<PaperRecord | null> {
    const paper = this.getPaper(id)
    if (!paper) return null
    if (!paper.deletedAt) {
      paper.deletedAt = nowIso()
      paper.updatedAt = nowIso()
      await this.saveLibrary()
    }
    return paper
  }

  async restorePaper(id: string): Promise<PaperRecord | null> {
    const paper = this.getPaper(id)
    if (!paper) return null
    if (paper.deletedAt) {
      delete paper.deletedAt
      paper.updatedAt = nowIso()
      await this.saveLibrary()
    }
    return paper
  }

  paperDir(id: string): string {
    return path.join(this.root, 'papers', id)
  }

  paperFile(id: string, name: string): string {
    return path.join(this.paperDir(id), name)
  }

  /** Serialize writes per file so two handlers never interleave. */
  #queue<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(run, run)
    this.queues.set(key, next.catch(() => undefined))
    return next
  }

  papers(): PaperRecord[] {
    return this.library.papers
  }

  /** Live papers only: the recycle bin is excluded from every read model. */
  activePapers(): PaperRecord[] {
    return this.library.papers.filter((paper) => !paper.deletedAt)
  }

  trashedPapers(): PaperRecord[] {
    return this.library.papers
      .filter((paper) => Boolean(paper.deletedAt))
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
  }

  getPaper(id: string): PaperRecord | undefined {
    return this.library.papers.find((paper) => paper.id === id)
  }

  /**
   * Stable DSH session id for one paper.
   *
   * `paper.json`'s own `sessionId` wins when present so a record moved between
   * homes keeps its conversation; otherwise the rule is `pr-<paperId>` and the
   * field is written the first time the session is created.
   */
  sessionIdFor(paper: PaperRecord): string {
    const stored = paper.sessionId?.trim()
    return stored ? stored : `pr-${paper.id}`
  }

  async saveLibrary(): Promise<void> {
    await this.#queue('library', () => writeJson(this.libraryFile, this.library))
  }

  async saveConfig(): Promise<void> {
    await this.#queue('config', () => writeJson(this.configFile, this.config))
  }

  async addPaper(paper: PaperRecord): Promise<PaperRecord> {
    this.library.papers.unshift(paper)
    await this.saveLibrary()
    return paper
  }

  async updatePaper(id: string, patch: Partial<PaperRecord>): Promise<PaperRecord | null> {
    const paper = this.getPaper(id)
    if (!paper) return null
    Object.assign(paper, patch, { updatedAt: nowIso() })
    await this.saveLibrary()
    return paper
  }

  async removePaper(id: string): Promise<boolean> {
    const index = this.library.papers.findIndex((paper) => paper.id === id)
    if (index < 0) return false
    this.library.papers.splice(index, 1)
    this.relations = this.relations.filter((edge) => edge.from !== id && edge.to !== id)
    await Promise.all([this.saveLibrary(), this.saveRelations()])
    await fs.rm(this.paperDir(id), { recursive: true, force: true })
    return true
  }

  /** Empty the recycle bin: hard-delete every trashed paper. */
  async emptyTrash(): Promise<string[]> {
    const ids = this.trashedPapers().map((paper) => paper.id)
    const removed: string[] = []
    for (const id of ids) {
      if (await this.removePaper(id)) removed.push(id)
    }
    return removed
  }

  #readPaper<T>(id: string, name: string, fallback: T): Promise<T> {
    return readJson(this.paperFile(id, name), fallback)
  }

  #writePaper(id: string, name: string, value: unknown): Promise<void> {
    return this.#queue(`${id}/${name}`, () => writeJson(this.paperFile(id, name), value))
  }

  readSummary(id: string): Promise<Summary | null> {
    return this.#readPaper<Summary | null>(id, 'summary.json', null)
  }

  async writeSummary(id: string, summary: Summary): Promise<void> {
    await this.#writePaper(id, 'summary.json', summary)
  }

  readPages(id: string): Promise<PageText[] | null> {
    return this.#readPaper<PageText[] | null>(id, 'pages.json', null)
  }

  async writePages(id: string, pages: PageText[]): Promise<void> {
    await this.#writePaper(id, 'pages.json', pages)
  }

  readTranslation(id: string): Promise<TranslationFile | null> {
    return this.#readPaper<TranslationFile | null>(id, 'translation.json', null)
  }

  async writeTranslation(id: string, translation: TranslationFile): Promise<void> {
    await this.#writePaper(id, 'translation.json', translation)
  }

  readVisuals(id: string): Promise<VisualFile | null> {
    return this.#readPaper<VisualFile | null>(id, 'visuals.json', null)
  }

  async writeVisuals(id: string, visuals: VisualFile): Promise<void> {
    await this.#writePaper(id, 'visuals.json', visuals)
  }

  readReferences(id: string): Promise<ReferenceEntry[]> {
    return this.#readPaper<ReferenceEntry[]>(id, 'references.json', [])
  }

  async writeReferences(id: string, references: ReferenceEntry[]): Promise<void> {
    await this.#writePaper(id, 'references.json', references)
  }

  readProfile(id: string): Promise<PaperProfile | null> {
    return this.#readPaper<PaperProfile | null>(id, 'profile.json', null)
  }

  async writeProfile(id: string, profile: PaperProfile): Promise<void> {
    await this.#writePaper(id, 'profile.json', profile)
  }

  readInsight(id: string): Promise<RelationInsight | null> {
    return this.#readPaper<RelationInsight | null>(id, 'relation-insight.json', null)
  }

  async writeInsight(id: string, insight: RelationInsight): Promise<void> {
    await this.#writePaper(id, 'relation-insight.json', insight)
  }

  readChunks(id: string): Promise<Chunk[]> {
    return this.#readPaper<Chunk[]>(id, 'chunks.json', [])
  }

  async writeChunks(id: string, chunks: Chunk[]): Promise<void> {
    await this.#writePaper(id, 'chunks.json', chunks)
  }

  async #readAnnotationsNow(id: string): Promise<Annotation[]> {
    const value = await readJsonBackup<Annotation[] | null>(this.paperFile(id, 'annotations.json'), null)
    return Array.isArray(value) ? value : []
  }

  readAnnotations(id: string): Promise<Annotation[]> {
    return this.#readAnnotationsNow(id)
  }

  /** Mirror every successful snapshot to `.bak` for crash recovery. */
  async #writeAnnotationsWithBackup(id: string, annotations: Annotation[]): Promise<void> {
    const file = this.paperFile(id, 'annotations.json')
    await writeJson(file, annotations)
    try {
      await fs.copyFile(file, `${file}.bak`)
    } catch {
      /* the main file is already durable */
    }
  }

  async writeAnnotations(id: string, annotations: Annotation[]): Promise<void> {
    await this.#queue(`${id}/annotations.json`, () => this.#writeAnnotationsWithBackup(id, annotations))
  }

  async addAnnotation(id: string, input: AnnotationInput): Promise<Annotation> {
    return this.#queue(`${id}/annotations.json`, async () => {
      const annotations = await this.#readAnnotationsNow(id)
      const annotation: Annotation = {
        id: newId('an'),
        paperId: id,
        page: Number(input.page) || 1,
        rects: Array.isArray(input.rects) ? (input.rects as number[][]) : [],
        quote: String(input.quote ?? ''),
        prefix: String(input.prefix ?? ''),
        suffix: String(input.suffix ?? ''),
        color: input.color ?? 'yellow',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      annotations.push(annotation)
      await this.#writeAnnotationsWithBackup(id, annotations)
      return annotation
    })
  }

  async updateAnnotation(id: string, annotationId: string, patch: AnnotationPatch): Promise<Annotation | null> {
    return this.#queue(`${id}/annotations.json`, async () => {
      const annotations = await this.#readAnnotationsNow(id)
      const found = annotations.find((item) => item.id === annotationId)
      if (!found) return null
      if (patch.color) found.color = patch.color
      if (patch.note !== undefined) found.note = patch.note
      if (Array.isArray(patch.rects)) found.rects = patch.rects
      if (patch.page) found.page = patch.page
      if (patch.noteId !== undefined) found.noteId = patch.noteId
      found.updatedAt = nowIso()
      await this.#writeAnnotationsWithBackup(id, annotations)
      return found
    })
  }

  async removeAnnotation(id: string, annotationId: string): Promise<boolean> {
    return this.#queue(`${id}/annotations.json`, async () => {
      const annotations = await this.#readAnnotationsNow(id)
      const next = annotations.filter((item) => item.id !== annotationId)
      if (next.length === annotations.length) return false
      await this.#writeAnnotationsWithBackup(id, next)
      return true
    })
  }

  readNotes(id: string): Promise<Note[]> {
    return this.#readPaper<Note[]>(id, 'notes.json', [])
  }

  async writeNotes(id: string, notes: Note[]): Promise<void> {
    await this.#writePaper(id, 'notes.json', notes)
  }

  async addNote(id: string, input: NoteInput): Promise<Note> {
    const notes = await this.readNotes(id)
    const note: Note = {
      id: newId('note'),
      paperId: id,
      page: input.page ? Number(input.page) : undefined,
      body: String(input.body ?? '').trim(),
      origin: input.origin === 'ai' ? 'ai' : 'user',
      createdAt: nowIso(),
    }
    notes.push(note)
    await this.writeNotes(id, notes)
    return note
  }

  async removeNote(id: string, noteId: string): Promise<boolean> {
    const notes = await this.readNotes(id)
    const next = notes.filter((note) => note.id !== noteId)
    if (next.length === notes.length) return false
    await this.writeNotes(id, next)
    return true
  }

  /** Shared cwd of every per-paper DSH session; also the sidebar's workspace group. */
  get workspaceDir(): string {
    return path.join(this.root, 'workspace')
  }

  readRelations(): RelationEdge[] {
    return this.relations
  }

  async saveRelations(): Promise<void> {
    await this.#queue('relations', () => writeJson(this.relationsFile, this.relations))
  }

  async saveMeta(): Promise<void> {
    await this.#queue('relations-meta', () => writeJson(this.metaFile, this.meta))
  }

  /** Judgments are cached per ordered pair; the caller owns the fingerprint. */
  judgments(): Record<string, StoredJudgment> {
    this.meta.judgments ??= {}
    return this.meta.judgments
  }

  /** Symmetric kinds have no meaningful direction: canonicalise to id order. */
  #relationKey(edge: Pick<RelationEdge, 'from' | 'to' | 'kind'>): string {
    const symmetric = edge.kind === 'same-method' || edge.kind === 'same-problem' || edge.kind === 'contradicts'
    const [left, right] = symmetric ? [edge.from, edge.to].sort() : [edge.from, edge.to]
    return `${left}|${right}|${edge.kind}`
  }

  #migrateRelations(raw: RelationEdge[]): RelationEdge[] {
    const out = new Map<string, RelationEdge>()
    for (const item of Array.isArray(raw) ? raw : []) {
      if (!item || typeof item.from !== 'string' || typeof item.to !== 'string') continue
      if (!EDGE_KINDS.includes(item.kind)) continue
      if (item.from === item.to) continue
      const edge: RelationEdge = {
        ...item,
        reason: item.reason ?? '',
        origin: item.origin === 'user' ? 'user' : 'auto',
        confidence: Number.isFinite(item.confidence) ? item.confidence : 0.5,
        status: item.status ?? 'confirmed',
      }
      const key = this.#relationKey(edge)
      const existing = out.get(key)
      if (!existing || edge.confidence > existing.confidence || (edge.origin === 'user' && existing.origin !== 'user')) {
        out.set(key, edge)
      }
    }
    return [...out.values()]
  }

  /**
   * Insert or refresh edges.
   *
   * Rules that keep user intent authoritative:
   * - a rejected pair is never re-added by the automatic engine;
   * - a user-owned edge is never overwritten by an auto one;
   * - a symmetric kind keeps one row regardless of direction.
   */
  async upsertRelations(edges: RelationEdge[]): Promise<{ added: number; updated: number; skipped: number }> {
    let added = 0
    let updated = 0
    let skipped = 0
    for (const edge of edges) {
      if (!edge || edge.from === edge.to || !EDGE_KINDS.includes(edge.kind)) {
        skipped += 1
        continue
      }
      const key = this.#relationKey(edge)
      const index = this.relations.findIndex((item) => this.#relationKey(item) === key)
      if (index < 0) {
        this.relations.push({
          ...edge,
          reason: edge.reason ?? '',
          origin: edge.origin ?? 'auto',
          confidence: Number.isFinite(edge.confidence) ? edge.confidence : 0.5,
          status: edge.status ?? 'confirmed',
          at: edge.at ?? nowIso(),
        })
        added += 1
        continue
      }
      const existing = this.relations[index]
      if (existing.status === 'rejected' && edge.origin !== 'user') {
        skipped += 1
        continue
      }
      if (existing.origin === 'user' && edge.origin === 'auto') {
        skipped += 1
        continue
      }
      const merged: RelationEdge = {
        ...existing,
        ...edge,
        status: existing.origin === 'user' ? existing.status : edge.status ?? existing.status,
        origin: existing.origin === 'user' ? 'user' : (edge.origin ?? 'auto'),
        at: nowIso(),
      }
      this.relations[index] = merged
      updated += 1
    }
    if (added > 0 || updated > 0) await this.saveRelations()
    return { added, updated, skipped }
  }

  /** Compatibility shim used by the old call sites. */
  async addRelations(edges: RelationEdge[]): Promise<RelationEdge[]> {
    await this.upsertRelations(edges)
    return this.relations
  }

  /** Full rebuild: drop re-derivable edges, keep user decisions and rejections. */
  async replaceAutoRelations(edges: RelationEdge[]): Promise<{ added: number; updated: number; skipped: number }> {
    this.relations = this.relations.filter((edge) => edge.origin === 'user' || edge.status === 'rejected')
    await this.saveRelations()
    return this.upsertRelations(edges)
  }

  /**
   * Scoped rebuild: only re-derive the edges *leaving* these papers. Incoming
   * edges belong to the other paper's perspective and stay put; citations to a
   * target are re-added by the rebuild itself.
   */
  async replaceAutoRelationsFor(
    paperIds: string[],
    edges: RelationEdge[],
  ): Promise<{ added: number; updated: number; skipped: number }> {
    const scope = new Set(paperIds)
    this.relations = this.relations.filter((edge) => (
      edge.origin === 'user'
      || edge.status === 'rejected'
      || !scope.has(edge.from)
    ))
    await this.saveRelations()
    return this.upsertRelations(edges)
  }

  async setRelationStatus(
    from: string,
    to: string,
    kind: string,
    status: 'confirmed' | 'suggested' | 'rejected',
    origin: 'auto' | 'user' = 'user',
  ): Promise<RelationEdge | null> {
    const probe = { from, to, kind: kind as RelationEdge['kind'] }
    const key = this.#relationKey(probe)
    const edge = this.relations.find((item) => this.#relationKey(item) === key)
    if (!edge) return null
    edge.status = status
    edge.origin = origin
    edge.at = nowIso()
    await this.saveRelations()
    return edge
  }

  async removeRelation(from: string, to: string, kind?: string): Promise<boolean> {
    const before = this.relations.length
    const keys = new Set<string>()
    if (kind) keys.add(this.#relationKey({ from, to, kind: kind as RelationEdge['kind'] }))
    else {
      for (const candidate of EDGE_KINDS) keys.add(this.#relationKey({ from, to, kind: candidate }))
    }
    this.relations = this.relations.filter((edge) => !keys.has(this.#relationKey(edge)))
    if (this.relations.length !== before) await this.saveRelations()
    return this.relations.length !== before
  }

  async readJob(jobId: string): Promise<Job | null> {
    return readJson<Job | null>(path.join(this.jobsDir, `${jobId}.json`), null)
  }

  async writeJob(job: Job): Promise<void> {
    await writeJson(path.join(this.jobsDir, `${job.id}.json`), job)
  }

  async listJobs(limit = 20): Promise<Job[]> {
    let entries: string[] = []
    try {
      entries = await fs.readdir(this.jobsDir)
    } catch {
      return []
    }
    const jobs: Job[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const job = await readJson<Job | null>(path.join(this.jobsDir, entry), null)
      if (job) jobs.push(job)
    }
    jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return jobs.slice(0, limit)
  }

  /** Remove paper directories whose paper no longer exists in library.json. */
  async pruneOrphans(liveIds: Set<string>): Promise<number> {
    const dir = path.join(this.root, 'papers')
    let entries: Array<import('node:fs').Dirent> = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    let removed = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || liveIds.has(entry.name)) continue
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true })
      removed += 1
    }
    return removed
  }
}
