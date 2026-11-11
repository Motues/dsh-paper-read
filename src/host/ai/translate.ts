/**
 * Full-text translation.
 *
 * A PDF is a bitmap, so the reader reconstructs the translated page from the
 * parsed `PageText` geometry instead of rewriting the file. This service owns
 * the model work and the durable cache.
 *
 * Design notes (why it looks like this):
 *
 * - One page is split into small blocks and sent as JSONL. The reply is parsed
 *   as a stream, so a truncated answer loses at most the last block instead of
 *   the whole page; a failed block can be retried or split on its own.
 * - Translation is cached by the *source text hash*, not by `Block.id`. Parsing
 *   a PDF again renumbers blocks, which used to invalidate every page; a content
 *   hash keeps the cache warm across re-imports and repeated headers.
 * - The system prompt carries the paper title/abstract and is byte-identical for
 *   every request in a run, which is what makes provider prefix caching possible.
 * - Pages are translated with a small worker pool; references, metadata, running
 *   heads, figure/table text and already-Chinese blocks are skipped before any
 *   token is spent (see `plan.ts`).
 */

import fs from 'node:fs/promises'
import type {
  Block,
  GlossaryEntry,
  PageText,
  PaperRecord,
  TranslationApiKind,
  TranslationBlockInput,
  TranslationCommitResult,
  TranslationDocument,
  TranslationFile,
  TranslationPage,
  TranslationPagePayload,
  TranslationPageStatus,
  TranslationRuntime,
  TranslationSettings,
  TranslationSource,
  TranslationStatus,
  VisualRegion,
} from '../../shared/domain.js'
import type { Store } from '../library/store.js'
import type { TaskCenter, TaskHandle } from '../tasks/center.js'
import { detectVisuals, visualSource, VISUALS_VERSION, type VisualFile } from '../pdf/visuals.js'
import { ensurePageGeometry } from '../pdf/refresh.js'
import { glossaryPrompt, protectMath, restoreMath, splitProtected, type ProtectedText } from '../../shared/math.js'
import {
  effectiveTranslationSource,
  normalizeTranslationSettings,
  translationAllowed,
  translationSourceLabel,
} from '../../shared/translation.js'
import { estimateTokens, extractJson, nowIso, sha1, truncate } from '../util/util.js'
import { planDocument, type DocumentPlan } from './plan.js'
import type { Summoner } from './summoner.js'
import { createDshEngine } from './engines/dsh.js'
import { TranslationEngineError, unavailableEngine, type EngineLimits, type TranslationEngine } from './engines/types.js'

export const TRANSLATION_LANG = 'zh'

/** Cache format version. v1 pages are still readable and are upgraded on write. */
const FILE_VERSION = 2

/** Blocks around this many characters keep one request comfortably sized. */
const CHUNK_CHARS = 2200
const MAX_CHUNK_BLOCKS = 40
const ATTEMPTS_PER_UNIT = 2
const WRITE_INTERVAL_MS = 700

const RULES = [
  'You translate the body text of a research paper paragraph by paragraph into Simplified Chinese, for a reader who compares the translation with the original.',
  'Output JSONL only: one {"id":"<block id>","t":"<translation>"} per line. Do not output an array, a code block, explanations, or any surrounding text.',
  'Translate only the supplied paragraphs. Keep formulas, variable names, citation numbers, URLs and DOIs unchanged. Do not merge or split paragraphs.',
  'Placeholders such as ⟦0⟧ stand for formulas, citations or symbols. Copy every placeholder exactly once, in the same order; never translate, move or drop one.',
  'Keep terminology consistent. Keep translations concise, ideally no longer than the source.',
  'Write the translations in Simplified Chinese.',
].join('\n')

export interface TranslationOptions {
  pages?: number[]
  force?: boolean
}

export interface TranslationService {
  status(paperId: string): Promise<TranslationStatus>
  page(paperId: string, page: number): Promise<TranslationPagePayload | null>
  /** The whole paper, for the continuous reflowed view. */
  document(paperId: string): Promise<TranslationDocument>
  /** Start (or resume) a background run; resolves with the status at kickoff. */
  start(paperId: string, options?: TranslationOptions): Promise<TranslationStatus>
  cancel(paperId: string): Promise<TranslationStatus>
  /** Runs that are currently in flight, for the task page. */
  active(): TranslationRun[]
  /** Effective source, engine and switch state for the settings page. */
  describe(): Promise<TranslationRuntime>
  /** One-shot/streaming translation for the selection bubble. */
  streamText(text: string, signal?: AbortSignal): AsyncGenerator<string>
  translateText(text: string, signal?: AbortSignal): Promise<string>
  /** Accept translations produced in the browser page. */
  commitExternal(
    paperId: string,
    page: number,
    blocks: TranslationBlockInput[],
    label?: string,
  ): Promise<TranslationCommitResult>
  /** Stop every in-flight run; used when the experiment switch turns off. */
  cancelAll(): Promise<void>
  /** Drop in-memory caches for a deleted paper. */
  forget(paperId: string): void
  dispose(): void
}

/** One in-flight full-text translation, as reported by the task page. */
export interface TranslationRun {
  paperId: string
  page: number | null
  startedAt: string
}

interface RunState {
  controller: AbortController
  page: number | null
  reused: number
  startedAt: string
  taskId?: string
}

interface PlanCache {
  revision: string
  plan: DocumentPlan
}

interface WorkItem {
  text: PageText
  entry: TranslationPage
  translatable: Block[]
  missing: Block[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function abortError(): Error {
  return Object.assign(new Error('已取消'), { name: 'AbortError' })
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string })?.name === 'AbortError'
}

function isFatal(error: unknown): boolean {
  const value = error as { name?: string; code?: string; status?: number; message?: string }
  if (value?.name === 'AbortError') return true
  if (value?.code === 'LLM_UNAVAILABLE') return true
  if (value?.code === 'TRANSLATION_AUTH' || value?.code === 'TRANSLATION_ENDPOINT') return true
  if (value?.code === 'TRANSLATION_CONFIG' || value?.code === 'CREDENTIALS_UNAVAILABLE') return true
  if (value?.status === 401 || value?.status === 403) return true
  return /unauthorized|forbidden|invalid api key|没有可用的模型/i.test(String(value?.message ?? ''))
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hashOf(text: string): string {
  return sha1(normalize(text))
}

/** The v1 per-page hash, kept only to seed caches written by older versions. */
function legacyPageHash(page: PageText): string {
  const blocks = page.blocks.filter((block) => (
    block.kind !== 'equation'
    && block.kind !== 'ref'
    && block.text.trim().length >= 2
  ))
  return sha1(blocks.map((block) => `${block.id}\u0000${block.text}`).join('\u0001'))
}

/** Split a page's missing blocks into request-sized slices. */
/**
 * A paragraph split by a column or page break. Chunks may overrun their size
 * budget by one block rather than cut it in half: the model translates what it
 * sees, and half a sentence translates worse than a slightly long request.
 */
function continuesInto(previous: Block, next: Block): boolean {
  if (previous.kind !== 'para' || next.kind !== 'para') return false
  if (Math.abs((previous.size ?? 10) - (next.size ?? 10)) > 1.5) return false
  const text = previous.text.trim()
  if (text === '' || /[.!?。！？:：;；)】]$/.test(text)) return false
  return true
}

function chunkBlocks(blocks: Block[]): Block[][] {
  const chunks: Block[][] = []
  let current: Block[] = []
  let size = 0
  for (const block of blocks) {
    const length = block.text.length
    const full = current.length > 0 && (size + length > CHUNK_CHARS || current.length >= MAX_CHUNK_BLOCKS)
    if (full && !continuesInto(current[current.length - 1], block)) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(block)
    size += length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

function planningRevision(pages: PageText[], visuals: Record<string, VisualRegion[]>): string {
  const body = pages.map((page) => [
    page.page,
    page.width,
    page.height,
    page.blocks.map((block) => [block.id, block.text, block.kind, block.bbox]),
  ])
  return sha1(JSON.stringify(body) + '|' + sha1(JSON.stringify(visuals)))
}

export function createTranslationService({
  store,
  summoner,
  log,
  tasks,
  resolveEngine,
  keyStatus,
}: {
  store: Store
  summoner: Summoner
  log: (message: string, error?: unknown) => void
  tasks?: TaskCenter
  /** Configured engine factory; tests fall back to the DSH model only. */
  resolveEngine?: (source: TranslationSource) => Promise<TranslationEngine>
  keyStatus?: () => Promise<Partial<Record<TranslationApiKind | 'local', boolean>>>
}): TranslationService {
  const resolve = resolveEngine ?? (async () => createDshEngine(summoner))
  const readKeys = keyStatus ?? (async () => ({}))
  const files = new Map<string, TranslationFile>()
  const runs = new Map<string, RunState>()
  const finishing = new Map<string, Promise<void>>()
  const errors = new Map<string, string>()
  const plans = new Map<string, PlanCache>()
  const visualsCache = new Map<string, { source: string; pages: Record<string, VisualRegion[]> }>()
  const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function currentSettings(): TranslationSettings {
    return normalizeTranslationSettings(store.config.translation)
  }

  function currentSource(): TranslationSource {
    return effectiveTranslationSource(store.config)
  }

  /** Settings with `source` forced to the effective one (the switch can hide it). */
  function activeSettings(): TranslationSettings {
    const settings = currentSettings()
    const source = currentSource()
    return settings.source === source ? settings : { ...settings, source }
  }

  function aiEnabled(): boolean {
    return store.config.aiEnabled !== false
  }

  function sanitizeFile(paper: PaperRecord, stored: TranslationFile | null): TranslationFile {
    const file: TranslationFile = stored ?? {
      version: FILE_VERSION,
      paperId: paper.id,
      targetLang: TRANSLATION_LANG,
      model: '',
      totalPages: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      pages: {},
    }
    file.version = FILE_VERSION
    if (!file.pages || typeof file.pages !== 'object') file.pages = {}
    for (const [key, entry] of Object.entries(file.pages)) {
      if (!entry || typeof entry !== 'object') {
        delete file.pages[key]
        continue
      }
      entry.page = Number(entry.page) || Number(key)
      entry.blocks = entry.blocks && typeof entry.blocks === 'object' ? entry.blocks : {}
      if (!entry.sources || typeof entry.sources !== 'object') entry.sources = undefined
      if (!entry.status) entry.status = 'partial'
      entry.model = entry.model ?? ''
      entry.at = entry.at ?? nowIso()
    }
    file.totalPages = Number(file.totalPages) || 0
    return file
  }

  async function loadFile(paper: PaperRecord): Promise<TranslationFile> {
    const cached = files.get(paper.id)
    if (cached) return cached
    const stored = await store.readTranslation(paper.id)
    const file = sanitizeFile(paper, stored)
    files.set(paper.id, file)
    return file
  }

  async function ensureVisuals(paper: PaperRecord): Promise<Record<string, VisualRegion[]>> {
    if (!paper.filePath || paper.pdfUnavailable) return {}
    const source = await visualSource(paper.filePath)
    if (!source) return {}
    const cached = visualsCache.get(paper.id)
    if (cached && cached.source === source) return cached.pages
    const stored = await store.readVisuals(paper.id).catch(() => null)
    if (stored && stored.version === VISUALS_VERSION && stored.source === source) {
      visualsCache.set(paper.id, { source, pages: stored.pages })
      return stored.pages
    }
    try {
      const bytes = await fs.readFile(paper.filePath)
      const pages = await store.readPages(paper.id)
      if (!pages || pages.length === 0) return {}
      const detected = await detectVisuals(new Uint8Array(bytes), pages)
      const file: VisualFile = { version: VISUALS_VERSION, source, pages: detected }
      visualsCache.set(paper.id, { source, pages: detected })
      void store.writeVisuals(paper.id, file).catch((error) => log('visuals write failed', error))
      return detected
    } catch (error) {
      log('visuals detection failed', error)
      return {}
    }
  }

  async function planFor(
    paper: PaperRecord,
    pages: PageText[],
    visuals: Record<string, VisualRegion[]>,
  ): Promise<DocumentPlan> {
    const revision = planningRevision(pages, visuals)
    const cached = plans.get(paper.id)
    if (cached && cached.revision === revision) return cached.plan
    const plan = planDocument(pages, visuals)
    plans.set(paper.id, { revision, plan })
    return plan
  }

  async function planPaper(paper: PaperRecord): Promise<{ pages: PageText[]; plan: DocumentPlan } | null> {
    const pages = await ensurePageGeometry(store, paper, log)
    if (!pages || pages.length === 0) return null
    const visuals = await ensureVisuals(paper)
    const plan = await planFor(paper, pages, visuals)
    return { pages, plan }
  }

  /** The tail of the previous page, so a sentence split by the page break reads. */
  function contextBefore(
    pages: PageText[],
    plan: DocumentPlan,
    page: number,
  ): string {
    const index = pages.findIndex((item) => item.page === page)
    for (let back = index - 1; back >= 0 && back >= index - 2; back -= 1) {
      const text = pages[back]
      const pagePlan = plan.pages.get(text.page)
      if (!pagePlan) continue
      const byId = new Map(text.blocks.map((block) => [block.id, block]))
      for (let at = pagePlan.order.length - 1; at >= 0; at -= 1) {
        const block = byId.get(pagePlan.order[at])
        if (!block || pagePlan.skipped[block.id] || block.kind === 'ref') continue
        const tail = block.text.trim().slice(-500)
        if (tail.length >= 40) return tail
      }
    }
    return ''
  }

  /** Content-hash index, seeded from everything already on disk. */
  function buildIndex(file: TranslationFile, pages: PageText[]): Map<string, string> {
    const index = new Map<string, string>()
    for (const entry of Object.values(file.pages)) {
      if (!entry) continue
      if (entry.sources) {
        for (const [id, hash] of Object.entries(entry.sources)) {
          const value = entry.blocks?.[id]
          if (typeof hash === 'string' && typeof value === 'string' && value !== '') index.set(hash, value)
        }
        continue
      }
      const text = pages.find((page) => page.page === entry.page)
      if (!text || legacyPageHash(text) !== entry.sourceHash) continue
      const byId = new Map(text.blocks.map((block) => [block.id, block]))
      for (const [id, value] of Object.entries(entry.blocks ?? {})) {
        const block = byId.get(id)
        if (block && typeof value === 'string' && value !== '') index.set(hashOf(block.text), value)
      }
    }
    return index
  }

  function systemFor(paper: PaperRecord, glossary: GlossaryEntry[] = []): string {
    const authors = (paper.authors ?? []).slice(0, 12).join(', ') || '未知'
    const place = [paper.venue, paper.year].filter(Boolean).join(' ') || '未知'
    const abstract = truncate(paper.abstract ?? '', 1800)
    const terms = glossaryPrompt(glossary)
    return [
      RULES,
      '',
      `论文标题：${paper.title || '未命名论文'}`,
      `作者：${authors}`,
      `发表：${place}`,
      `摘要：${abstract || '（无摘要）'}`,
      ...(terms ? ['', terms] : []),
    ].join('\n')
  }

  function normalizeGlossary(parsed: unknown): GlossaryEntry[] {
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { terms?: unknown })?.terms)
        ? (parsed as { terms: unknown[] }).terms
        : []
    const seen = new Set<string>()
    const entries: GlossaryEntry[] = []
    for (const row of rows) {
      const en = Array.isArray(row) ? row[0] : (row as { en?: unknown; term?: unknown })?.en ?? (row as { term?: unknown })?.term
      const zh = Array.isArray(row) ? row[1] : (row as { zh?: unknown; translation?: unknown })?.zh ?? (row as { translation?: unknown })?.translation
      if (typeof en !== 'string' || typeof zh !== 'string') continue
      const source = en.replace(/\s+/g, ' ').trim()
      const target = zh.replace(/\s+/g, ' ').trim()
      if (source.length < 2 || source.length > 80 || target.length < 1 || target.length > 80) continue
      if (!/[\u3400-\u9fff]/.test(target)) continue
      const key = source.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ en: source, zh: target })
      if (entries.length >= 24) break
    }
    return entries
  }

  /**
   * Build the per-paper glossary once. Terminology drift is what makes a long
   * translation read as if several people wrote it, and pinning a few dozen
   * terms costs one small request per paper.
   */
  async function ensureGlossary(
    engine: TranslationEngine,
    paper: PaperRecord,
    file: TranslationFile,
    signal?: AbortSignal,
  ): Promise<GlossaryEntry[]> {
    if (file.glossary) return file.glossary
    if (engine.mode !== 'llm' || !engine.stream) return []
    const source = [paper.title ?? '', truncate(paper.abstract ?? '', 2200)].filter(Boolean).join('\n')
    if (source.trim().length < 40) return []
    try {
      let text = ''
      for await (const delta of engine.stream({
        system: '你为学术论文翻译建立术语表。只输出 JSON 数组，不要解释、不要代码围栏。',
        user: [
          '从下面的标题与摘要中挑出 8–24 个领域术语或缩写，给出简体中文译名。',
          '只收真正需要统一的术语（方法名、指标、缩写、领域名词），不要收普通动词和虚词。',
          '输出格式：[{"en":"attention","zh":"注意力"}]',
          '',
          source,
        ].join('\n'),
        maxTokens: 900,
        signal: signal ?? new AbortController().signal,
      })) {
        text += delta
      }
      const entries = normalizeGlossary(extractJson(text))
      if (entries.length > 0) {
        file.glossary = entries
        scheduleWrite(paper.id)
      }
      return entries
    } catch (error) {
      if (signal?.aborted) throw abortError()
      log('glossary extraction failed', error)
      return []
    }
  }

  function scheduleWrite(paperId: string): void {
    if (writeTimers.has(paperId)) return
    const timer = setTimeout(() => {
      writeTimers.delete(paperId)
      const file = files.get(paperId)
      if (!file) return
      void store.writeTranslation(paperId, file).catch((error) => log('translation write failed', error))
    }, WRITE_INTERVAL_MS)
    writeTimers.set(paperId, timer)
  }

  async function flushWrite(paperId: string): Promise<void> {
    const timer = writeTimers.get(paperId)
    if (timer) {
      clearTimeout(timer)
      writeTimers.delete(paperId)
    }
    const file = files.get(paperId)
    if (!file) return
    await store.writeTranslation(paperId, file).catch((error) => log('translation write failed', error))
  }

  function pageStatus(entry: TranslationPage | undefined): TranslationPageStatus {
    if (!entry) return 'pending'
    if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'partial') return entry.status
    return 'partial'
  }

  /**
   * Translations for one page, keyed by the *current* block ids.
   *
   * Re-parsing a paper (the geometry upgrade, a new parser version) renumbers
   * blocks. A stored entry still holds the old ids, so the id lookup is tried
   * first and the content hash second; without that a translated paper would
   * look untranslated until the user paid for a full re-run.
   */
  function pageBlocks(file: TranslationFile, text: PageText): Record<string, string> {
    const entry = file.pages[String(text.page)]
    if (!entry) return {}
    const byHash = new Map<string, string>()
    if (entry.sources) {
      for (const [id, hash] of Object.entries(entry.sources)) {
        const value = entry.blocks[id]
        if (typeof hash === 'string' && typeof value === 'string' && value !== '' && !byHash.has(hash)) {
          byHash.set(hash, value)
        }
      }
    }
    const out: Record<string, string> = {}
    for (const block of text.blocks) {
      const direct = entry.blocks[block.id]
      const hash = hashOf(block.text)
      if (typeof direct === 'string' && direct !== '' && (!entry.sources || entry.sources[block.id] === hash)) {
        out[block.id] = direct
        continue
      }
      const reused = byHash.get(hash)
      if (reused) out[block.id] = reused
    }
    return out
  }

  function countFromPlan(
    file: TranslationFile,
    pages: PageText[],
    plan: DocumentPlan,
  ): { totalBlocks: number; translatedBlocks: number; skippedBlocks: number } {
    let totalBlocks = 0
    let translatedBlocks = 0
    let skippedBlocks = 0
    for (const page of pages) {
      const pagePlan = plan.pages.get(page.page)
      if (!pagePlan) continue
      const byId = new Map(page.blocks.map((block) => [block.id, block]))
      const entry = file.pages[String(page.page)]
      for (const id of pagePlan.order) {
        const block = byId.get(id)
        if (!block) continue
        if (pagePlan.skipped[id]) {
          skippedBlocks += 1
          continue
        }
        if (block.text.trim().length < 2) continue
        totalBlocks += 1
        if (entry?.blocks[id]) translatedBlocks += 1
      }
    }
    return { totalBlocks, translatedBlocks, skippedBlocks }
  }

  async function status(paperId: string): Promise<TranslationStatus> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    const file = await loadFile(paper)
    const run = runs.get(paperId)
    const settings = activeSettings()
    const source = currentSource()
    let engine: TranslationEngine
    try {
      engine = await resolve(source)
    } catch (error) {
      log('translation engine resolution failed', error)
      engine = unavailableEngine(source, source, 'llm', 'dsh', '翻译来源不可用')
    }
    const available = engine.external
      ? true
      : await engine.available().catch((error) => {
          log('translation engine availability failed', error)
          return false
        })

    let counts = file.counts
    if (!counts) {
      // Status only needs block counts; the geometry upgrade happens on the
      // first page/document/run request, not on a one-second status poll.
      const pages = await store.readPages(paperId)
      if (pages && pages.length > 0) {
        const plan = planDocument(pages, {})
        const counted = countFromPlan(file, pages, plan)
        counts = { totalPages: pages.length, ...counted, reusedBlocks: 0 }
        file.counts = counts
        if (!file.totalPages) file.totalPages = pages.length
      }
    }

    const pages: Record<string, TranslationPageStatus> = {}
    let donePages = 0
    let failedPages = 0
    let partialPages = 0
    for (const entry of Object.values(file.pages)) {
      if (!entry || typeof entry.page !== 'number') continue
      const state = pageStatus(entry)
      pages[String(entry.page)] = state
      if (state === 'done') donePages += 1
      else if (state === 'failed') failedPages += 1
      else if (state === 'partial') partialPages += 1
    }

    return {
      available,
      targetLang: file.targetLang || TRANSLATION_LANG,
      model: file.model || engine.label,
      source,
      sourceLabel: translationSourceLabel(settings),
      mode: engine.mode,
      allowed: translationAllowed(aiEnabled(), settings),
      sourceLanguage: settings.browser.sourceLanguage,
      totalPages: file.totalPages || counts?.totalPages || paper.pageCount || 0,
      donePages,
      failedPages,
      partialPages,
      translatedBlocks: counts?.translatedBlocks ?? 0,
      totalBlocks: counts?.totalBlocks ?? 0,
      skippedBlocks: counts?.skippedBlocks ?? 0,
      reusedBlocks: run?.reused ?? file.counts?.reusedBlocks ?? 0,
      running: Boolean(run),
      ...(run?.page ? { runningPage: run.page } : {}),
      ...(file.updatedAt ? { updatedAt: file.updatedAt } : {}),
      ...(errors.get(paperId) ? { error: errors.get(paperId) } : {}),
      pages,
    }
  }

  async function page(paperId: string, pageNumber: number): Promise<TranslationPagePayload | null> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    const pages = await ensurePageGeometry(store, paper, log)
    if (!pages) throw Object.assign(new Error('还没有解析全文'), { status: 404 })
    const text = pages.find((item) => item.page === pageNumber)
    if (!text) return null
    const file = await loadFile(paper)
    const visuals = await ensureVisuals(paper)
    const plan = await planFor(paper, pages, visuals)
    const pagePlan = plan.pages.get(pageNumber)
    const entry = file.pages[String(pageNumber)]
    return {
      page: text,
      status: pageStatus(entry),
      blocks: pageBlocks(file, text),
      ...(pagePlan
        ? {
            skipped: pagePlan.skipped,
            order: pagePlan.order,
            visuals: pagePlan.visuals,
          }
        : {}),
      ...(entry?.model ? { model: entry.model } : {}),
      ...(entry?.error ? { error: entry.error } : {}),
    }
  }

  async function document(paperId: string): Promise<TranslationDocument> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    const planned = await planPaper(paper)
    if (!planned) throw Object.assign(new Error('还没有解析全文'), { status: 404 })
    const file = await loadFile(paper)
    const { pages, plan } = planned
    return {
      paperId,
      title: paper.title,
      authors: paper.authors ?? [],
      ...(paper.venue ? { venue: paper.venue } : {}),
      ...(paper.year ? { year: paper.year } : {}),
      targetLang: file.targetLang || TRANSLATION_LANG,
      model: file.model || '',
      referencePages: plan.referencePages,
      pages: pages.map((text) => {
        const pagePlan = plan.pages.get(text.page)
        const entry = file.pages[String(text.page)]
        return {
          page: text,
          status: pageStatus(entry),
          blocks: pageBlocks(file, text),
          ...(pagePlan
            ? {
                skipped: pagePlan.skipped,
                order: pagePlan.order,
                visuals: pagePlan.visuals,
              }
            : {}),
          ...(entry?.model ? { model: entry.model } : {}),
          ...(entry?.error ? { error: entry.error } : {}),
        }
      }),
    }
  }

  type BlockHandler = (parsed: unknown) => void

  function acceptBlock(
    out: Record<string, string>,
    expected: Set<string>,
    id: unknown,
    value: unknown,
  ): void {
    if (typeof id !== 'string' || typeof value !== 'string') return
    const text = value.trim()
    if (text === '' || !expected.has(id) || out[id]) return
    out[id] = text
  }

  /**
   * Parse complete JSON values out of a stream. Handles JSONL, a pretty-printed
   * object, and an array; incomplete tail values stay buffered for the next
   * delta, so truncation costs only the unfinished value.
   */
  function drainJson(output: string, handle: BlockHandler): string {
    let rest = output
    for (;;) {
      const start = rest.search(/[[{]/)
      if (start < 0) return ''
      rest = rest.slice(start)
      const open = rest[0]
      const close = open === '{' ? '}' : ']'
      let depth = 0
      let inString = false
      let escaped = false
      let end = -1
      for (let index = 0; index < rest.length; index += 1) {
        const char = rest[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === open) depth += 1
        else if (char === close) {
          depth -= 1
          if (depth === 0) {
            end = index
            break
          }
        }
      }
      if (end < 0) return rest
      const body = rest.slice(0, end + 1)
      rest = rest.slice(end + 1)
      try {
        handle(JSON.parse(body) as unknown)
      } catch {
        /* a malformed value: skip it and keep draining */
      }
    }
  }

  async function translateLlmChunk(
    engine: TranslationEngine,
    system: string,
    pageText: PageText,
    blocks: Block[],
    signal: AbortSignal,
    context = '',
  ): Promise<{ done: Record<string, string>; error?: unknown }> {
    if (!engine.stream) {
      throw new TranslationEngineError('该翻译来源不支持大模型调用', 'TRANSLATION_CONFIG')
    }
    const expected = new Set(blocks.map((block) => block.id))
    const out: Record<string, string> = {}
    const protectedById = new Map(blocks.map((block) => [block.id, protectMath(block.text)]))
    const user = [
      context ? `上文（上一页结尾，仅供理解，不要翻译）：${context}` : '',
      `第 ${pageText.page} 页，共 ${blocks.length} 段。`,
      ...blocks.map((block) => JSON.stringify({
        id: block.id,
        s: protectedById.get(block.id)?.text ?? block.text,
      })),
    ].filter(Boolean).join('\n')
    const sourceText = blocks.map((block) => block.text).join(' ')
    const maxTokens = Math.min(8192, Math.max(1800, Math.ceil(estimateTokens(sourceText) * 3) + 400))

    let output = ''
    let error: unknown
    const handle: BlockHandler = (parsed) => {
      if (Array.isArray(parsed)) {
        parsed.forEach((item, index) => {
          if (Array.isArray(item) && item.length >= 2) acceptBlock(out, expected, item[0], item[1])
          else if (item && typeof item === 'object' && !Array.isArray(item)) {
            const record = item as Record<string, unknown>
            acceptBlock(out, expected, record.id, record.t ?? record.translation ?? record.text)
          } else if (typeof item === 'string') {
            acceptBlock(out, expected, blocks[index]?.id, item)
          }
        })
        return
      }
      if (!parsed || typeof parsed !== 'object') return
      const record = parsed as Record<string, unknown>
      if (typeof record.id === 'string') {
        acceptBlock(out, expected, record.id, record.t ?? record.translation ?? record.text)
        return
      }
      if (record.translations && typeof record.translations === 'object') {
        for (const [id, value] of Object.entries(record.translations as Record<string, unknown>)) {
          acceptBlock(out, expected, id, value)
        }
        return
      }
      for (const [id, value] of Object.entries(record)) acceptBlock(out, expected, id, value)
    }

    try {
      for await (const delta of engine.stream({
        system,
        user,
        maxTokens,
        signal,
      })) {
        output += delta
        output = drainJson(output, handle)
      }
      output = drainJson(output, handle)
    } catch (cause) {
      if (signal.aborted || isAbort(cause)) throw abortError()
      error = cause
      if (output) output = drainJson(output, handle)
    }

    // A translation-specialized local/API model often ignores the JSONL
    // protocol and returns prose. If nothing parsed at all, switch this chunk
    // to one plain request per block instead of failing the page.
    if (engine.plainFallback && Object.keys(out).length === 0 && !error) {
      return translatePlainBlocks(engine, pageText, blocks, signal, protectedById)
    }

    // A reply that lost or moved a formula placeholder is not a translation of
    // this paragraph: drop it so the retry path translates the block again.
    const done: Record<string, string> = {}
    for (const [id, value] of Object.entries(out)) {
      const spans = protectedById.get(id)?.spans ?? []
      const restored = restoreMath(value, spans)
      if (restored === null) continue
      done[id] = restored
    }
    return { done, ...(error ? { error } : {}) }
  }

  /**
   * Plain per-block fallback for LLM engines that do not follow JSONL: the
   * provider still gets the protected text and its reply is validated against
   * the same placeholders, so a specialized translation model is usable
   * without pretending to be a chat model that returns block ids.
   */
  async function translatePlainBlocks(
    engine: TranslationEngine,
    pageText: PageText,
    blocks: Block[],
    signal: AbortSignal,
    protectedById: Map<string, ProtectedText>,
  ): Promise<{ done: Record<string, string>; error?: unknown }> {
    if (!engine.stream) {
      throw new TranslationEngineError('该翻译来源不支持逐段翻译', 'TRANSLATION_CONFIG')
    }
    const done: Record<string, string> = {}
    let error: unknown
    for (const block of blocks) {
      if (signal.aborted) throw abortError()
      const item = protectedById.get(block.id)
      let text = ''
      try {
        for await (const delta of engine.stream({
          system: 'You translate research-paper paragraphs into Simplified Chinese. Output only the translation. Keep every ⟦n⟧ placeholder exactly once and in order.',
          user: `第 ${pageText.page} 页，请只输出这一段的中文译文：\n\n${item?.text ?? block.text}`,
          maxTokens: Math.min(4096, Math.max(800, Math.ceil(estimateTokens(block.text) * 3) + 200)),
          signal,
        })) {
          text += delta
        }
      } catch (cause) {
        if (signal.aborted || isAbort(cause)) throw abortError()
        error = cause
        if (isFatal(cause)) throw cause
        break
      }
      const restored = restoreMath(text.trim(), item?.spans ?? [])
      if (restored !== null && restored !== '') done[block.id] = restored
    }
    return { done, ...(error ? { error } : {}) }
  }

  interface MtPiece {
    id: string
    piece: number
    text: string
  }

  function mtBatches(items: MtPiece[], limits: EngineLimits): MtPiece[][] {
    const batches: MtPiece[][] = []
    let current: MtPiece[] = []
    let chars = 0
    const flush = (): void => {
      if (current.length === 0) return
      batches.push(current)
      current = []
      chars = 0
    }
    for (const item of items) {
      if (current.length >= limits.batch) flush()
      else if (current.length > 0 && chars + item.text.length > limits.charsPerRequest) flush()
      current.push(item)
      chars += item.text.length
    }
    flush()
    return batches
  }

  /**
   * One batch of blocks through a dedicated machine translator.
   *
   * The provider only sees plain strings in reading order; the reply is mapped
   * back by index, so no block id, prompt, glossary or model judgement is
   * involved. Formula placeholders are split out before the call and restored
   * (and validated) afterwards.
   */
  async function translateMtChunk(
    engine: TranslationEngine,
    pageText: PageText,
    blocks: Block[],
    signal: AbortSignal,
  ): Promise<{ done: Record<string, string>; error?: unknown }> {
    if (!engine.translateBatch) {
      throw new TranslationEngineError('该翻译来源不支持逐段翻译', 'TRANSLATION_CONFIG')
    }
    const protectedById = new Map(blocks.map((block) => [block.id, protectMath(block.text)]))
    const items: MtPiece[] = []
    for (const block of blocks) {
      const protectedText = protectedById.get(block.id)?.text ?? block.text
      splitProtected(protectedText, engine.limits.charsPerItem).forEach((text, piece) => {
        items.push({ id: block.id, piece, text })
      })
    }

    const byBlock = new Map<string, string[]>()
    let error: unknown
    for (const batch of mtBatches(items, engine.limits)) {
      if (signal.aborted) throw abortError()
      try {
        const translated = await engine.translateBatch(batch.map((item) => item.text), signal)
        if (translated.length !== batch.length) {
          throw new TranslationEngineError(
            `第 ${pageText.page} 页：翻译接口返回 ${translated.length} 条，期望 ${batch.length} 条`,
            'TRANSLATION_BAD_RESPONSE',
          )
        }
        batch.forEach((item, index) => {
          const pieces = byBlock.get(item.id) ?? []
          pieces[item.piece] = translated[index] ?? ''
          byBlock.set(item.id, pieces)
        })
      } catch (cause) {
        if (signal.aborted || isAbort(cause)) throw abortError()
        error = cause
        break
      }
    }

    const done: Record<string, string> = {}
    for (const block of blocks) {
      const pieces = byBlock.get(block.id)
      if (!pieces || pieces.some((piece) => typeof piece !== 'string')) continue
      if (pieces.every((piece) => piece.trim() === '')) continue
      const spans = protectedById.get(block.id)?.spans ?? []
      const restored = restoreMath(pieces.join(''), spans)
      if (restored === null) continue
      done[block.id] = restored
    }
    return { done, ...(error ? { error } : {}) }
  }

  async function translateUnit(
    engine: TranslationEngine,
    system: string,
    pageText: PageText,
    blocks: Block[],
    signal: AbortSignal,
    onPartial: (done: Record<string, string>) => void,
    context = '',
    depth = 0,
  ): Promise<void> {
    if (signal.aborted) throw abortError()
    let pending = blocks
    for (let attempt = 0; attempt < ATTEMPTS_PER_UNIT && pending.length > 0; attempt += 1) {
      if (signal.aborted) throw abortError()
      const result = engine.mode === 'mt'
        ? await translateMtChunk(engine, pageText, pending, signal)
        : await translateLlmChunk(engine, system, pageText, pending, signal, context)
      if (Object.keys(result.done).length > 0) onPartial(result.done)
      pending = pending.filter((block) => !result.done[block.id])
      if (pending.length === 0) return
      if (result.error && isFatal(result.error)) throw result.error
      if (attempt + 1 < ATTEMPTS_PER_UNIT) await sleep(700 * (attempt + 1))
    }
    if (pending.length === 0) return
    if (pending.length > 1 && depth < 4) {
      const middle = Math.ceil(pending.length / 2)
      await translateUnit(engine, system, pageText, pending.slice(0, middle), signal, onPartial, context, depth + 1)
      await translateUnit(engine, system, pageText, pending.slice(middle), signal, onPartial, context, depth + 1)
      return
    }
    throw new Error(`第 ${pageText.page} 页有 ${pending.length} 段未能翻译`)
  }

  function allTranslated(entry: TranslationPage, translatable: Block[]): boolean {
    return translatable.every((block) => Boolean(entry.blocks[block.id]))
  }

  function commit(
    paperId: string,
    pageText: PageText,
    entry: TranslationPage,
    translatable: Block[],
    done: Record<string, string>,
    index: Map<string, string>,
    file: TranslationFile,
    label?: string,
  ): void {
    const byId = new Map(pageText.blocks.map((block) => [block.id, block]))
    let changed = 0
    for (const [id, value] of Object.entries(done)) {
      const block = byId.get(id)
      if (!block) continue
      const hash = hashOf(block.text)
      const fresh = !entry.blocks[id]
      entry.blocks[id] = value
      entry.sources ??= {}
      entry.sources[id] = hash
      index.set(hash, value)
      if (fresh) changed += 1
    }
    if (changed === 0) return
    if (label) {
      entry.model = label
      file.model = label
    }
    entry.at = nowIso()
    entry.status = allTranslated(entry, translatable) ? 'done' : 'partial'
    if (entry.status === 'done') delete entry.error
    file.updatedAt = nowIso()
    if (file.counts) file.counts.translatedBlocks = Math.min(
      file.counts.totalBlocks,
      file.counts.translatedBlocks + changed,
    )
    scheduleWrite(paperId)
  }

  function finalizePage(entry: TranslationPage, translatable: Block[]): void {
    entry.sourceHash = entry.sourceHash || ''
    if (allTranslated(entry, translatable)) {
      entry.status = 'done'
      delete entry.error
    } else if (Object.keys(entry.blocks).length > 0) {
      entry.status = 'partial'
    } else {
      entry.status = 'failed'
    }
    entry.at = nowIso()
  }

  async function run(
    paper: PaperRecord,
    options: TranslationOptions,
    signal: AbortSignal,
    task?: TaskHandle,
  ): Promise<void> {
    const pages = await ensurePageGeometry(store, paper, log)
    if (!pages || pages.length === 0) {
      errors.set(paper.id, '这篇论文还没有解析出全文，暂时不能翻译')
      return
    }
    const settings = activeSettings()
    const source = currentSource()
    if (!translationAllowed(aiEnabled(), settings)) {
      throw Object.assign(new Error('AI 功能已在设置中关闭'), { code: 'AI_DISABLED', status: 503 })
    }
    const engine = await resolve(source)
    if (engine.external) {
      throw Object.assign(new Error('浏览器翻译在页面内执行'), { code: 'BROWSER_SOURCE', status: 409 })
    }
    if (!(await engine.available())) {
      throw Object.assign(
        new Error(engine.reason ?? '翻译来源不可用'),
        { code: 'SOURCE_UNAVAILABLE', status: 503 },
      )
    }
    const file = await loadFile(paper)
    file.version = FILE_VERSION
    file.totalPages = pages.length
    if (!file.model) file.model = engine.label
    const visuals = await ensureVisuals(paper)
    const plan = await planFor(paper, pages, visuals)
    const index = buildIndex(file, pages)
    const glossary = engine.mode === 'llm' ? await ensureGlossary(engine, paper, file, signal) : []
    if (signal.aborted) throw abortError()
    const system = engine.mode === 'llm' ? systemFor(paper, glossary) : ''
    const wanted = options.pages && options.pages.length > 0 ? new Set(options.pages) : null
    const selected = wanted ? pages.filter((page) => wanted.has(page.page)) : pages

    const work: WorkItem[] = []
    let reused = 0
    for (const text of selected) {
      const pagePlan = plan.pages.get(text.page)
      if (!pagePlan) continue
      const byId = new Map(text.blocks.map((block) => [block.id, block]))
      const translatable = pagePlan.order
        .map((id) => byId.get(id))
        .filter((block): block is Block => Boolean(block))
        .filter((block) => !pagePlan.skipped[block.id] && block.text.trim().length >= 2)
      const existing = file.pages[String(text.page)]
      const entry: TranslationPage = existing ?? {
        page: text.page,
        status: 'partial',
        sourceHash: '',
        blocks: {},
        sources: {},
        model: file.model,
        at: nowIso(),
      }
      entry.blocks = existing ? pageBlocks(file, text) : {}
      entry.sources = {}
      for (const block of text.blocks) {
        if (entry.blocks[block.id]) entry.sources[block.id] = hashOf(block.text)
      }
      entry.model = entry.model || engine.label
      entry.sourceHash = legacyPageHash(text)

      const missing: Block[] = []
      for (const block of translatable) {
        const hash = hashOf(block.text)
        if (!options.force && index.has(hash)) {
          entry.blocks[block.id] = index.get(hash) as string
          entry.sources[block.id] = hash
          reused += 1
          continue
        }
        if (!options.force && entry.blocks[block.id] && entry.sources[block.id] === hash) continue
        missing.push(block)
      }

      if (translatable.length === 0) {
        entry.status = 'done'
        entry.blocks = {}
        entry.sources = {}
      } else if (missing.length === 0) {
        entry.status = 'done'
        delete entry.error
      } else {
        entry.status = 'partial'
      }
      file.pages[String(text.page)] = entry
      if (missing.length > 0) work.push({ text, entry, translatable, missing })
    }

    const counted = countFromPlan(file, pages, plan)
    file.counts = {
      totalPages: pages.length,
      totalBlocks: counted.totalBlocks,
      translatedBlocks: counted.translatedBlocks,
      skippedBlocks: counted.skippedBlocks,
      reusedBlocks: reused,
    }
    const state = runs.get(paper.id)
    if (state) state.reused = reused
    scheduleWrite(paper.id)

    await pool(work, engine.limits.concurrency, async (item) => {
      if (signal.aborted) return
      const current = runs.get(paper.id)
      if (current) current.page = item.text.page
      task?.update({ detail: `第 ${item.text.page} 页` })
      const context = engine.mode === 'llm' ? contextBefore(pages, plan, item.text.page) : ''
      for (const chunk of chunkBlocks(item.missing)) {
        if (signal.aborted) return
        try {
          await translateUnit(
            engine,
            system,
            item.text,
            chunk,
            signal,
            (done) => commit(paper.id, item.text, item.entry, item.translatable, done, index, file, engine.label),
            context,
          )
        } catch (error) {
          if (signal.aborted || isAbort(error)) return
          const message = truncate(String((error as Error)?.message ?? error), 220)
          item.entry.error = message
          errors.set(paper.id, `第 ${item.text.page} 页翻译失败：${message}`)
          log(`translation failed on page ${item.text.page}`, error)
          break
        }
      }
      finalizePage(item.entry, item.translatable)
      file.updatedAt = nowIso()
      scheduleWrite(paper.id)
    })

    const finalCounts = countFromPlan(file, pages, plan)
    file.counts = {
      totalPages: pages.length,
      totalBlocks: finalCounts.totalBlocks,
      translatedBlocks: finalCounts.translatedBlocks,
      skippedBlocks: finalCounts.skippedBlocks,
      reusedBlocks: reused,
    }
    file.updatedAt = nowIso()
    if (finalCounts.translatedBlocks >= finalCounts.totalBlocks) errors.delete(paper.id)
  }

  async function start(paperId: string, options: TranslationOptions = {}): Promise<TranslationStatus> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    if (runs.has(paperId)) return status(paperId)
    const settings = activeSettings()
    const source = currentSource()
    if (source === 'browser') {
      throw Object.assign(new Error('浏览器翻译在页面内执行'), { code: 'BROWSER_SOURCE', status: 409 })
    }
    if (!translationAllowed(aiEnabled(), settings)) {
      throw Object.assign(new Error('AI 功能已在设置中关闭'), { code: 'AI_DISABLED', status: 503 })
    }
    const engine = await resolve(source)
    if (engine.external) {
      throw Object.assign(new Error('浏览器翻译在页面内执行'), { code: 'BROWSER_SOURCE', status: 409 })
    }
    if (!(await engine.available())) {
      throw Object.assign(
        new Error(engine.reason ?? '翻译来源不可用'),
        { code: 'SOURCE_UNAVAILABLE', status: 503 },
      )
    }
    const controller = new AbortController()
    const startedAt = nowIso()
    const handle = tasks?.begin({
      kind: 'translation',
      title: paper.title,
      paperId,
      detail: '准备中',
      startedAt,
      cancelable: true,
    })
    const runState: RunState = {
      controller,
      page: null,
      reused: 0,
      startedAt,
      ...(handle ? { taskId: handle.id } : {}),
    }
    runs.set(paperId, runState)
    errors.delete(paperId)
    const execute = () => run(paper, options, controller.signal, handle)
    const work = (handle && tasks ? tasks.run(handle.id, execute) : execute())
      .catch((error) => {
        if (!controller.signal.aborted) {
          errors.set(paperId, truncate(String((error as Error)?.message ?? error), 240))
          log('translation run failed', error)
        }
      })
      .finally(async () => {
        runs.delete(paperId)
        finishing.delete(paperId)
        const file = files.get(paperId)
        if (file) {
          file.updatedAt = nowIso()
          await flushWrite(paperId)
        }
        if (handle) {
          const counts = file?.counts
          const error = errors.get(paperId)
          handle.finish({
            state: controller.signal.aborted ? 'canceled' : error ? 'failed' : 'done',
            detail: controller.signal.aborted
              ? '已停止'
              : counts
                ? `${counts.translatedBlocks}/${counts.totalBlocks} 段`
                : '完成',
            ...(error ? { error } : {}),
          })
        }
      })
    finishing.set(paperId, work)
    return status(paperId)
  }

  async function cancel(paperId: string): Promise<TranslationStatus> {
    const runState = runs.get(paperId)
    if (runState) {
      runState.controller.abort()
      // Wait for the current page to unwind so the reported state is truthful.
      await finishing.get(paperId)?.catch(() => {})
      await flushWrite(paperId)
    }
    return status(paperId)
  }

  function active(): TranslationRun[] {
    return [...runs.entries()].map(([paperId, run]) => ({
      paperId,
      page: run.page,
      startedAt: run.startedAt,
    }))
  }

  async function describe(): Promise<TranslationRuntime> {
    const settings = activeSettings()
    const source = currentSource()
    let engine: TranslationEngine
    try {
      engine = await resolve(source)
    } catch (error) {
      log('translation engine resolution failed', error)
      engine = unavailableEngine(source, source, 'llm', 'dsh', '翻译来源不可用')
    }
    const available = engine.external
      ? true
      : await engine.available().catch(() => false)
    let keys: Partial<Record<TranslationApiKind | 'local', boolean>> = {}
    try {
      keys = await readKeys()
    } catch (error) {
      log('translation key status failed', error)
    }
    return {
      source,
      settings,
      engine: {
        id: engine.id,
        label: engine.label,
        mode: engine.mode,
        billing: engine.billing,
        available,
        ...(engine.reason ? { error: engine.reason } : {}),
      },
      keys,
      aiEnabled: aiEnabled(),
      allowed: translationAllowed(aiEnabled(), settings),
    }
  }

  /** Stream one excerpt through the active source (selection bubble). */
  async function* streamText(
    text: string,
    signal: AbortSignal = new AbortController().signal,
  ): AsyncGenerator<string> {
    const settings = activeSettings()
    const source = currentSource()
    if (source === 'browser') {
      throw Object.assign(new Error('浏览器翻译在页面内执行'), { code: 'BROWSER_SOURCE', status: 409 })
    }
    if (!translationAllowed(aiEnabled(), settings)) {
      throw Object.assign(new Error('AI 功能已在设置中关闭'), { code: 'AI_DISABLED', status: 503 })
    }
    const engine = await resolve(source)
    if (engine.external) {
      throw Object.assign(new Error('浏览器翻译在页面内执行'), { code: 'BROWSER_SOURCE', status: 409 })
    }
    if (!(await engine.available())) {
      throw Object.assign(
        new Error(engine.reason ?? '翻译来源不可用'),
        { code: 'SOURCE_UNAVAILABLE', status: 503 },
      )
    }
    if (text.trim() === '') {
      yield ''
      return
    }

    if (engine.mode === 'mt') {
      if (!engine.translateBatch) {
        throw Object.assign(new Error('该翻译来源不支持逐段翻译'), { code: 'TRANSLATION_CONFIG', status: 503 })
      }
      const protectedText = protectMath(text)
      const pieces = splitProtected(protectedText.text, engine.limits.charsPerItem)
      const out = await engine.translateBatch(pieces, signal)
      if (out.length !== pieces.length) {
        throw new TranslationEngineError('翻译接口返回条数不一致', 'TRANSLATION_BAD_RESPONSE')
      }
      const restored = restoreMath(out.join(''), protectedText.spans)
      if (restored === null) {
        throw new TranslationEngineError('翻译结果没有保留公式占位符', 'TRANSLATION_BAD_RESPONSE')
      }
      yield restored
      return
    }

    if (!engine.stream) {
      throw Object.assign(new Error('该翻译来源不支持大模型调用'), { code: 'TRANSLATION_CONFIG', status: 503 })
    }
    const system = 'You translate an excerpt from a research paper for a reader. Keep terminology precise, preserve formulas and symbols exactly, and output only the translation in Simplified Chinese.'
    for await (const delta of engine.stream({
      system,
      user: `翻译成中文：\n\n${text}`,
      maxTokens: 1400,
      signal,
    })) {
      yield delta
    }
  }

  async function translateText(
    text: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<string> {
    let output = ''
    for await (const delta of streamText(text, signal)) output += delta
    return output.trim()
  }

  /**
   * Accept translations produced in the browser page. Every block must exist on
   * this parsed page, every formula placeholder must survive, and the page must
   * still be the one the browser read; a stale or hostile local caller cannot
   * introduce block ids that the parser never produced.
   */
  async function commitExternal(
    paperId: string,
    pageNumber: number,
    blocks: TranslationBlockInput[],
    label?: string,
  ): Promise<TranslationCommitResult> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    const pages = await ensurePageGeometry(store, paper, log)
    if (!pages) throw Object.assign(new Error('还没有解析全文'), { status: 404 })
    const text = pages.find((item) => item.page === pageNumber)
    if (!text) throw Object.assign(new Error('这一页没有解析文本'), { status: 404 })
    const file = await loadFile(paper)
    const visuals = await ensureVisuals(paper)
    const plan = await planFor(paper, pages, visuals)
    const pagePlan = plan.pages.get(pageNumber)
    const byId = new Map(text.blocks.map((block) => [block.id, block]))
    const translatable = pagePlan
      ? pagePlan.order
          .map((id) => byId.get(id))
          .filter((block): block is Block => Boolean(block))
          .filter((block) => !pagePlan.skipped[block.id] && block.text.trim().length >= 2)
      : text.blocks.filter((block) => block.text.trim().length >= 2)

    const entry = file.pages[String(pageNumber)] ?? {
      page: pageNumber,
      status: 'partial',
      sourceHash: legacyPageHash(text),
      blocks: {},
      sources: {},
      model: file.model || label || '',
      at: nowIso(),
    }
    entry.blocks = pageBlocks(file, text)
    entry.sources = {}
    for (const block of text.blocks) {
      if (entry.blocks[block.id]) entry.sources[block.id] = hashOf(block.text)
    }
    entry.sourceHash = entry.sourceHash || legacyPageHash(text)

    const done: Record<string, string> = {}
    const accepted: string[] = []
    const rejected: string[] = []
    for (const input of Array.isArray(blocks) ? blocks : []) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const value = typeof input?.t === 'string' ? input.t : ''
      const block = byId.get(id)
      if (!block || value === '' || value.length > 20_000) {
        rejected.push(id)
        continue
      }
      if (pagePlan?.skipped[id] || block.text.trim().length < 2) {
        rejected.push(id)
        continue
      }
      const restored = restoreMath(value, protectMath(block.text).spans)
      if (restored === null) {
        rejected.push(id)
        continue
      }
      done[id] = restored
      accepted.push(id)
    }

    // A page that did not exist and accepted nothing is not a failure worth
    // persisting; the caller can retry after the transient error.
    if (accepted.length === 0 && !file.pages[String(pageNumber)]) {
      return { status: await status(paperId), accepted, rejected }
    }
    file.pages[String(pageNumber)] = entry

    commit(paperId, text, entry, translatable, done, new Map(), file, label || entry.model)
    finalizePage(entry, translatable)
    file.updatedAt = nowIso()
    scheduleWrite(paperId)
    return { status: await status(paperId), accepted, rejected }
  }

  async function cancelAll(): Promise<void> {
    const ids = [...runs.keys()]
    await Promise.all(ids.map((paperId) => cancel(paperId).then(() => undefined)))
  }

  function forget(paperId: string): void {
    runs.get(paperId)?.controller.abort()
    runs.delete(paperId)
    const timer = writeTimers.get(paperId)
    if (timer) {
      clearTimeout(timer)
      writeTimers.delete(paperId)
    }
    files.delete(paperId)
    errors.delete(paperId)
    plans.delete(paperId)
    visualsCache.delete(paperId)
  }

  function dispose(): void {
    for (const runState of runs.values()) runState.controller.abort()
    for (const timer of writeTimers.values()) clearTimeout(timer)
    writeTimers.clear()
    runs.clear()
  }

  return {
    status,
    page,
    document,
    start,
    cancel,
    active,
    describe,
    streamText,
    translateText,
    commitExternal,
    cancelAll,
    forget,
    dispose,
  }
}
