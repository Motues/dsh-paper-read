/**
 * The PaperReader host application: composition root for storage, retrieval,
 * jobs and prompts.
 *
 * It deliberately knows nothing about HTTP or Cordis — `http/handler.ts` adapts
 * it to `ctx.webServer`, and `index.ts` adapts it to the plugin context.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { Job, JobSource, JobStepState, Paper, PaperDetail, PaperRecord } from '../shared/domain.js'
import { createAskService, type AskInput, type AskPlan } from './ai/ask.js'
import { createPaperChat, type ChatBridge, type PaperChat } from './ai/chat.js'
import { createTranslationService, type TranslationService } from './ai/translate.js'
import { createEngineRegistry, type CredentialsLike, type EngineRegistry } from './ai/engines/registry.js'
import type { NativeTranslatorService } from './ai/engines/mt.js'
import type { LlmService, ModelRoute } from './ai/summoner.js'
import { Summoner } from './ai/summoner.js'
import { createJobQueue } from './jobs/queue.js'
import { TaskCenter } from './tasks/center.js'
import {
  cardOf,
  createLibraryQueries,
  type FolderView,
  type ListOptions,
} from './library/queries.js'
import { Store } from './library/store.js'
import { createIndexer, type Indexer, type ReindexResult } from './search/indexer.js'
import type { Bm25Index } from './search/bm25.js'
import { createRetrieval, type Candidate, type RelationView } from './search/retrieval.js'
import { createRelations, type RelationService } from './relations/service.js'
import { UsageLedger } from './usage/ledger.js'
import { RELATION_STEP_KEYS, RELATION_STEP_LABELS } from './jobs/job.js'
import type { SearchPayload } from '../shared/domain.js'

export interface CreateAppOptions {
  home: string
  getLlm: () => LlmService | undefined
  getSelection: () => ModelRoute | undefined
  /** Harness credential store; optional so degraded/test profiles still load. */
  getCredentials?: () => CredentialsLike | undefined
  /** Harness machine-translation service (Bing/Google); optional. */
  getTranslator?: () => NativeTranslatorService | undefined
  /** Harness services for the session-backed conversation; omitted in tests. */
  bridge?: ChatBridge
  log?: (message: string, error?: unknown) => void
}

export interface ScanResult {
  scanned: number
  added: number
  jobs: string[]
}

export interface CleanMissingResult {
  removed: string[]
  count: number
}

/** The surface routes and the import pipeline program against. */
export interface HostApp {
  home: string
  store: Store
  summoner: Summoner
  indexer: Indexer
  /** `indexer.index`, kept for read-only health stats. */
  index: Bm25Index
  log: (message: string, error?: unknown) => void
  cardOf(paper: PaperRecord): Paper
  listPapers(options?: ListOptions): PaperRecord[]
  folderView(): FolderView
  paperView(paper: PaperRecord): Promise<Omit<PaperDetail, 'fileUrl'>>
  ensureIndex(): Promise<void>
  reindexPaper(paperId: string): Promise<void>
  reindexAll(): Promise<ReindexResult>
  findMissing(): Promise<Paper[]>
  cleanMissing(): Promise<CleanMissingResult>
  candidatesFor(paper: PaperRecord, limit?: number): Candidate[]
  relationView(paperId: string): Promise<RelationView>
  /** Profiles, deterministic signals, adjudication, clusters and the cached insight. */
  relations: RelationService
  /** Queue a full or single-paper rebuild; progress is a normal job stream. */
  enqueueRelationRebuild(scope?: string): Job
  searchLibrary(args: { query: string; limit?: number; rerank?: boolean; signal?: AbortSignal }): Promise<SearchPayload>
  /** The session-backed paper conversation (one DSH session per paper). */
  chat: PaperChat
  /** Full-text translation: per-page model calls plus a durable page cache. */
  translation: TranslationService
  /** Resolve/configure the translation engines behind the settings page. */
  translationEngines: EngineRegistry
  /** Durable daily token ledger behind 设置 → 用量. */
  usage: UsageLedger
  /** Active and archived tasks behind the task list page. */
  tasks: TaskCenter
  /** One-shot prompt construction: translation and the degraded fallback. */
  buildAsk(input: AskInput): Promise<AskPlan | null>
  scanWatchFolders(): Promise<ScanResult>
  enqueueJob(source: JobSource): Job
  /** Import/relations jobs that are running or queued right now. */
  activeJobs(): Job[]
  onJobRunner(fn: (job: Job) => Promise<void> | void): void
  waitIdle(): Promise<void>
  /** Soft delete: move the paper to the recycle bin. */
  trashPaper(paperId: string): Promise<PaperRecord | null>
  /** Take a paper out of the recycle bin. */
  restorePaper(paperId: string): Promise<PaperRecord | null>
  /** Hard delete: drop the record, its relations and its per-paper directory. */
  removePaper(paperId: string): Promise<boolean>
  /** Hard-delete every paper in the recycle bin. */
  emptyTrash(): Promise<string[]>
  subscribeJob(jobId: string, listener: (job: Job) => void): () => void
  saveJob(job: Job): Promise<void>
  setStep(job: Job, key: string, state: JobStepState, detail?: string): Promise<void>
}

/** A bridge that reports every harness service as missing: the degraded profile. */
export function inertBridge(): ChatBridge {
  return {
    service: () => undefined,
    on: () => () => {},
  }
}

export async function createApp({
  home,
  getLlm,
  getSelection,
  getCredentials = () => undefined,
  getTranslator = () => undefined,
  bridge = inertBridge(),
  log = () => {},
}: CreateAppOptions): Promise<HostApp> {
  const store = new Store(home)
  await store.load()

  const usage = new UsageLedger(store.root)
  await usage.load()
  const tasks = new TaskCenter({
    root: store.root,
    resolveTitle: (paperId) => store.getPaper(paperId)?.title,
    log,
  })
  await tasks.load()
  const recordUsage = (sample: Parameters<UsageLedger['record']>[0]): void => {
    usage.record(sample)
    tasks.record(sample)
  }
  const summoner = new Summoner({
    getLlm,
    getSelection,
    getConfig: () => store.config,
    log,
    recordUsage,
  })
  const indexer = createIndexer(store)
  const queries = createLibraryQueries(store)
  const retrieval = createRetrieval({ store, indexer, summoner, log })
  const ask = createAskService({ store, indexer })
  const jobs = createJobQueue({ store, log })
  const relations = createRelations({ store, summoner, log })

  /** Register every queued job with the task list as soon as it exists. */
  function enqueueJob(source: JobSource): Job {
    const job = jobs.enqueue(source)
    tasks.trackJob(job, jobs.subscribeJob)
    return job
  }

  function enqueueRelationRebuild(scope?: string): Job {
    const job = jobs.enqueueTask({
      kind: 'relations',
      source: { kind: 'relations', scope: scope && scope !== 'all' ? scope : 'all' },
      sourceLabel: scope && scope !== 'all' ? '单篇关联' : '全库关联',
      steps: RELATION_STEP_KEYS.map((key) => ({ key, label: RELATION_STEP_LABELS[key] })),
    })
    tasks.trackJob(job, jobs.subscribeJob)
    return job
  }
  const chat = createPaperChat({
    store,
    indexer,
    summoner,
    bridge,
    buildAsk: ask.buildAsk,
    log,
    recordUsage,
    tasks,
  })
  const translationEngines = createEngineRegistry({
    summoner,
    config: () => store.config,
    getCredentials,
    getTranslator,
    log,
  })
  const translation = createTranslationService({
    store,
    summoner,
    log,
    tasks,
    resolveEngine: (source) => translationEngines.resolve(source),
    keyStatus: () => translationEngines.keys(),
  })

  async function scanWatchFolders(): Promise<ScanResult> {
    const found: string[] = []
    for (const folder of store.config.watchFolders ?? []) {
      let entries: Array<import('node:fs').Dirent>
      try {
        entries = await fs.readdir(folder, { withFileTypes: true })
      } catch (error) {
        log(`watch folder unreadable: ${folder}`, error)
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue
        found.push(path.join(folder, entry.name))
      }
    }

    const known = new Set(
      store.papers().map((paper) => (paper.filePath ? path.resolve(paper.filePath).toLowerCase() : '')).filter(Boolean),
    )
    const added: string[] = []
    for (const filePath of found) {
      const key = path.resolve(filePath).toLowerCase()
      if (known.has(key)) continue
      known.add(key)
      added.push(filePath)
    }

    const jobIds = added.map((filePath) => enqueueJob({ kind: 'file', filePath }).id)
    return { scanned: found.length, added: added.length, jobs: jobIds }
  }

  async function removePaper(paperId: string): Promise<boolean> {
    const removed = await store.removePaper(paperId)
    if (removed) {
      indexer.removePaper(paperId)
      translation.forget(paperId)
      await chat.dropWorkspace(paperId)
    }
    return removed
  }

  async function trashPaper(paperId: string): Promise<PaperRecord | null> {
    const paper = await store.trashPaper(paperId)
    if (paper) {
      indexer.removePaper(paperId)
      // The sidebar group belongs to this paper; hiding the paper hides it.
      await chat.dropWorkspace(paperId)
    }
    return paper
  }

  async function restorePaper(paperId: string): Promise<PaperRecord | null> {
    const paper = await store.restorePaper(paperId)
    if (paper) {
      await indexer.reindexPaper(paperId)
      // Rebuild the paper's group when conversations are visible in the sidebar.
      if (store.config.paperSessionInSidebar === true) await chat.syncSidebar(true)
    }
    return paper
  }

  async function emptyTrash(): Promise<string[]> {
    const removed = await store.emptyTrash()
    for (const id of removed) indexer.removePaper(id)
    return removed
  }

  async function findMissing(): Promise<Paper[]> {
    const missing: Paper[] = []
    for (const paper of store.activePapers()) {
      if (!paper.filePath) continue
      try {
        await fs.access(paper.filePath)
        if (paper.missing) await store.updatePaper(paper.id, { missing: false })
      } catch {
        missing.push(cardOf(paper))
        if (!paper.missing) await store.updatePaper(paper.id, { missing: true })
      }
    }
    return missing
  }

  async function cleanMissing(): Promise<CleanMissingResult> {
    const missing = await findMissing()
    const removed: string[] = []
    for (const card of missing) {
      if (await removePaper(card.id)) removed.push(card.id)
    }
    return { removed, count: removed.length }
  }

  return {
    home,
    store,
    summoner,
    indexer,
    index: indexer.index,
    log,
    cardOf: queries.cardOf,
    listPapers: queries.listPapers,
    folderView: queries.folderView,
    paperView: queries.paperView,
    ensureIndex: indexer.ensureIndex,
    reindexPaper: indexer.reindexPaper,
    reindexAll: indexer.reindexAll,
    findMissing,
    cleanMissing,
    candidatesFor: retrieval.candidatesFor,
    relationView: relations.relationView,
    relations,
    enqueueRelationRebuild,
    searchLibrary: retrieval.searchLibrary,
    chat,
    translation,
    translationEngines,
    usage,
    tasks,
    buildAsk: ask.buildAsk,
    scanWatchFolders,
    enqueueJob,
    activeJobs: jobs.active,
    onJobRunner: jobs.onJobRunner,
    waitIdle: jobs.waitIdle,
    trashPaper,
    restorePaper,
    removePaper,
    emptyTrash,
    subscribeJob: jobs.subscribeJob,
    saveJob: jobs.saveJob,
    setStep: jobs.setStep,
  }
}
