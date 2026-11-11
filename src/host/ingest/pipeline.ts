/**
 * The import pipeline: identify → store → parse → chunk → summary → relations → index.
 *
 * A step that depends on the model (summary, relations) degrades to a warning:
 * the paper is still readable with the original PDF, and the summary can be
 * retried later from the library.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Job,
  PageText,
  PaperRecord,
  RelationEdge,
  Summary,
} from '../../shared/domain.js'
import type { HostApp } from '../app.js'
import { buildSummary } from '../ai/summarize.js'
import { chunkPages, type Chunk } from '../pdf/chunk.js'
import { extractPages, PAGE_VERSION } from '../pdf/extract.js'
import { deriveMetadata, mergeMetadata } from '../pdf/metadata.js'
import { nowIso, shortHash, truncate } from '../util/util.js'
import { STEP_KEYS } from '../jobs/job.js'
import { resolveLink, type LinkMetadata } from './link.js'
import { enrichMetadata, type MetadataResult } from './metadata.js'

interface LoadedFile {
  kind: 'file'
  filePath: string
  fileName: string
  bytes: Buffer
  size: number
  fileHash: string
  id: string
  meta: LinkMetadata
  sourceUrl?: string
  pdfUrl?: string
  sources: string[]
}

interface LoadedLink {
  kind: 'link'
  filePath?: string
  fileName: string
  bytes?: Uint8Array
  size: number
  fileHash?: string
  id: string
  meta: LinkMetadata
  sourceUrl?: string
  pdfUrl?: string
  sources: string[]
  pdfUnavailable?: 'auth' | 'missing'
}

type LoadedSource = LoadedFile | LoadedLink

function titleFromFile(name: string): string {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240)
}

async function fingerprint(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath)
  const handle = await fs.open(filePath, 'r')
  try {
    const head = Buffer.alloc(Math.min(131_072, stat.size))
    await handle.read(head, 0, head.length, 0)
    const tailLength = Math.min(65_536, Math.max(0, stat.size - head.length))
    const tail = Buffer.alloc(tailLength)
    if (tailLength > 0) await handle.read(tail, 0, tailLength, Math.max(0, stat.size - tailLength))
    return shortHash(`${stat.size}:${head.toString('base64')}:${tail.toString('base64')}`, 16)
  } finally {
    await handle.close()
  }
}

async function loadSource(app: HostApp, job: Job): Promise<LoadedSource> {
  const source = job.source
  if (source.kind === 'file') {
    if (!source.filePath) throw new Error('缺少文件路径')
    const filePath = path.resolve(source.filePath)
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) throw new Error('不是文件')
    if (stat.size > app.store.config.maxImportBytes) {
      throw new Error(`文件超过 ${Math.round(app.store.config.maxImportBytes / 1024 / 1024)} MB`)
    }
    const bytes = await fs.readFile(filePath)
    return {
      kind: 'file',
      filePath,
      fileName: path.basename(filePath),
      bytes,
      size: stat.size,
      fileHash: await fingerprint(filePath),
      id: shortHash(filePath.toLowerCase()),
      meta: { authors: [], references: [] },
      sourceUrl: undefined,
      sources: [],
    }
  }

  if (!source.url) throw new Error('缺少链接')
  const resolved = await resolveLink(source.url, { maxBytes: app.store.config.maxImportBytes })
  return {
    kind: 'link',
    filePath: undefined,
    fileName: resolved.meta.title ? `${resolved.meta.title.slice(0, 80)}.pdf` : fileNameFromUrl(resolved.finalUrl),
    bytes: resolved.bytes,
    size: resolved.bytes?.length ?? 0,
    fileHash: undefined,
    id: shortHash(resolved.finalUrl),
    meta: resolved.meta,
    sourceUrl: resolved.finalUrl,
    pdfUrl: resolved.pdfUrl,
    sources: resolved.sources,
    pdfUnavailable: resolved.pdfUnavailable,
  }
}

function fileNameFromUrl(value: string): string {
  try {
    const name = decodeURIComponent(new URL(value).pathname.split('/').filter(Boolean).pop() ?? '')
    if (name && /\.pdf$/i.test(name)) return name.slice(0, 120)
  } catch {
    /* fall through */
  }
  return 'link.pdf'
}

async function findExisting(app: HostApp, loaded: LoadedSource): Promise<PaperRecord | undefined> {
  const papers = app.store.papers()
  if (loaded.kind === 'file') {
    const key = loaded.filePath.toLowerCase()
    const byPath = papers.find((paper) => paper.filePath && path.resolve(paper.filePath).toLowerCase() === key)
    if (byPath) return byPath
  }
  if (loaded.fileHash) {
    const byHash = papers.find((paper) => paper.fileHash === loaded.fileHash)
    if (byHash) return byHash
  }
  if (loaded.meta?.arxivId) {
    const byArxiv = papers.find((paper) => paper.arxivId === loaded.meta.arxivId)
    if (byArxiv) return byArxiv
  }
  if (loaded.meta?.doi) {
    const doi = String(loaded.meta.doi).toLowerCase()
    const byDoi = papers.find((paper) => paper.doi && paper.doi.toLowerCase() === doi)
    if (byDoi) return byDoi
  }
  if (loaded.meta?.pmid) {
    const byPmid = papers.find((paper) => paper.pmid === loaded.meta.pmid)
    if (byPmid) return byPmid
  }
  return undefined
}

async function runJob(app: HostApp, job: Job): Promise<void> {
  job.state = 'running'
  job.startedAt = nowIso()
  await app.saveJob(job)
  job.warnings = []

  const skipRest = (fromStep: string, reason: string): void => {
    const start = STEP_KEYS.indexOf(fromStep as (typeof STEP_KEYS)[number])
    for (let index = Math.max(0, start); index < STEP_KEYS.length; index += 1) {
      const step = job.steps.find((item) => item.key === STEP_KEYS[index])
      if (step && step.state === 'pending') {
        step.state = 'skipped'
        step.detail = reason
      }
    }
  }

  try {
    await app.setStep(job, 'identify', 'running')
    const loaded = await loadSource(app, job)
    job.sourceLabel = loaded.fileName

    const attachId = job.source.paperId
    let existing: PaperRecord | undefined
    if (attachId) {
      existing = app.store.getPaper(attachId)
      if (!existing) throw new Error('要补充 PDF 的论文不存在')
      if (existing.hasFullText) throw new Error('这篇论文已经有 PDF')
    } else {
      existing = await findExisting(app, loaded)
    }

    if (existing && !attachId) {
      job.paperId = existing.id
      // Re-importing something that sits in the recycle bin is a restore, not a
      // duplicate: put it back instead of leaving the user with a dead entry.
      if (existing.deletedAt) {
        await app.restorePaper(existing.id)
        if (job.source.folder && app.store.getFolder(job.source.folder)) {
          await app.store.updatePaper(existing.id, { folder: job.source.folder })
        }
        job.warnings.push('这篇论文原来在回收站里，已自动还原。')
      }
      await app.setStep(job, 'identify', 'done', `已在库中：${truncate(existing.title, 40)}`)
      skipRest('store', '已存在')
      job.state = 'done'
      job.duplicate = true
      await app.saveJob(job)
      return
    }
    await app.setStep(job, 'identify', 'done', loaded.size ? `${Math.round(loaded.size / 1024)} KB` : '无 PDF')

    if (loaded.kind === 'link' && loaded.pdfUnavailable === 'auth') {
      job.warnings.push('该 PDF 需要登录或订阅，已仅导入基本信息；请下载 PDF 后上传。')
    } else if (loaded.kind === 'link' && !loaded.bytes) {
      job.warnings.push('没有抓取到 PDF，已仅导入基本信息；可稍后上传 PDF。')
    }

    await app.setStep(job, 'store', 'running')
    const id = existing?.id ?? loaded.id
    const filePath = loaded.kind === 'file' ? loaded.filePath : undefined
    let paper = existing
    if (!paper) {
      paper = {
        id,
        title: loaded.meta.title || titleFromFile(loaded.fileName),
        authors: loaded.meta.authors ?? [],
        year: loaded.meta.year,
        venue: loaded.meta.venue,
        abstract: loaded.meta.abstract,
        doi: loaded.meta.doi,
        arxivId: loaded.meta.arxivId,
        pmid: loaded.meta.pmid,
        tags: [],
        folder: job.source.folder && app.store.getFolder(job.source.folder) ? job.source.folder : null,
        status: 'todo',
        progress: 0,
        addedAt: nowIso(),
        updatedAt: nowIso(),
        source: loaded.kind === 'file' ? 'pdf' : 'link',
        filePath,
        sourceUrl: loaded.sourceUrl,
        pageCount: 0,
        hasFullText: false,
        hasSummary: false,
        fileHash: loaded.fileHash,
        pdfUnavailable: loaded.kind === 'link' ? loaded.pdfUnavailable : undefined,
      }
      await app.store.addPaper(paper)
    } else if (attachId) {
      await app.store.updatePaper(id, {
        filePath,
        fileHash: loaded.fileHash,
        missing: false,
        pdfUnavailable: undefined,
        updatedAt: nowIso(),
      })
      paper = app.store.getPaper(id) ?? paper
    }
    job.paperId = id

    if (loaded.kind === 'link' && loaded.bytes) {
      await fs.mkdir(app.store.filesDir, { recursive: true })
      const target = path.join(app.store.filesDir, `${id}.pdf`)
      await fs.writeFile(target, loaded.bytes)
      paper.filePath = target
      paper.filePathIsCopy = true
      await app.store.updatePaper(id, {
        filePath: target,
        filePathIsCopy: true,
        pdfUnavailable: undefined,
      })
    }
    if (loaded.kind === 'link' && loaded.meta.references.length > 0) {
      await app.store.writeReferences(id, loaded.meta.references)
    }
    await app.setStep(
      job,
      'store',
      'done',
      attachId ? '补充 PDF' : loaded.kind === 'file' ? '引用原文件' : '已保存 PDF 副本',
    )

    if (loaded.kind === 'link') {
      await app.setStep(
        job,
        'metadata',
        'done',
        loaded.sources.length > 0 ? loaded.sources.join(' / ') : '页面元数据',
      )
    }

    // ── parse ────────────────────────────────────────────────────────────
    await app.setStep(job, 'parse', 'running')
    let pages: PageText[] = []
    if (loaded.bytes) {
      const result = await extractPages(loaded.bytes, {
        onPage: (page, total) => {
          const step = job.steps.find((item) => item.key === 'parse')
          if (step) step.detail = `${page}/${total} 页`
        },
      })
      pages = result.pages
      const derived = deriveMetadata(pages, { name: loaded.fileName, fallbackTitle: paper.title })

      let enriched: MetadataResult | null = null
      if (loaded.kind === 'file' && (derived.doi || derived.arxivId)) {
        await app.setStep(job, 'metadata', 'running')
        try {
          enriched = await enrichMetadata({ doi: derived.doi, arxivId: derived.arxivId })
          await app.setStep(
            job,
            'metadata',
            'done',
            enriched.sources.length > 0 ? enriched.sources.join(' / ') : '元数据已补全',
          )
        } catch (error) {
          job.warnings.push(`元数据补全失败：${(error as Error).message}`)
          await app.setStep(job, 'metadata', 'skipped', '元数据补全失败')
        }
      }

      const merged = mergeMetadata(
        {
          title: paper.title,
          authors: paper.authors ?? [],
          year: paper.year,
          venue: paper.venue,
          abstract: paper.abstract,
          doi: paper.doi,
          arxivId: paper.arxivId,
        },
        derived,
      )
      // The PDF wins over the file name, but never over explicit link metadata.
      if (!attachId && (loaded.kind === 'file' || !loaded.meta.title) && derived.title && derived.title !== '未命名论文') {
        merged.title = derived.title
      }
      if (enriched) {
        if (attachId) {
          // A metadata-only record already trusts its provider metadata; only fill gaps.
          merged.title = merged.title || enriched.meta.title || paper.title
          merged.authors = merged.authors.length > 0 ? merged.authors : enriched.meta.authors
          merged.year = merged.year ?? enriched.meta.year
          merged.venue = merged.venue || enriched.meta.venue
          merged.abstract = merged.abstract || enriched.meta.abstract
          merged.doi = merged.doi || enriched.meta.doi
          merged.arxivId = merged.arxivId || enriched.meta.arxivId
        } else {
          merged.title = enriched.meta.title || merged.title
          merged.authors = enriched.meta.authors.length > 0 ? enriched.meta.authors : merged.authors
          merged.year = enriched.meta.year ?? merged.year
          merged.venue = enriched.meta.venue || merged.venue
          merged.abstract = enriched.meta.abstract || merged.abstract
          merged.doi = enriched.meta.doi || merged.doi
          merged.arxivId = enriched.meta.arxivId || merged.arxivId
        }
      }

      const useMerged = loaded.kind === 'file' ? !attachId : !loaded.meta.title
      const storedReferences = await app.store.readReferences(id)
      const references = storedReferences.length > 0 ? storedReferences : enriched?.meta.references ?? []
      paper = {
        ...paper,
        title: (useMerged ? merged.title : paper.title || merged.title) || paper.title,
        authors: (useMerged
          ? merged.authors
          : paper.authors?.length
            ? paper.authors
            : merged.authors) ?? [],
        year: useMerged ? merged.year : paper.year ?? merged.year,
        venue: useMerged ? merged.venue : paper.venue ?? merged.venue,
        abstract: useMerged ? merged.abstract : paper.abstract ?? merged.abstract,
        doi: paper.doi ?? merged.doi,
        arxivId: paper.arxivId ?? merged.arxivId,
        pmid: paper.pmid ?? enriched?.meta.pmid,
        pageCount: result.pageCount,
        hasFullText: true,
        pdfUnavailable: undefined,
        missing: false,
        parseVersion: PAGE_VERSION,
        updatedAt: nowIso(),
      }
      await app.store.updatePaper(id, paper)
      await app.store.writePages(id, pages)
      if (loaded.kind === 'file' && references.length > 0) {
        await app.store.writeReferences(id, references)
      }
      await app.setStep(job, 'parse', 'done', `${result.pageCount} 页`)
    } else {
      if (paper.abstract) {
        pages = [{
          page: 1,
          width: 595,
          height: 842,
          blocks: [{ id: 'p1b0', bbox: [0, 0, 595, 60], text: paper.abstract, kind: 'para', size: 10 }],
        }]
        await app.store.writePages(id, pages)
        await app.setStep(job, 'parse', 'skipped', '没有 PDF，只有元数据')
      } else {
        await app.setStep(job, 'parse', 'skipped', '没有可解析的 PDF')
      }
    }

    const metadataStep = job.steps.find((item) => item.key === 'metadata')
    if (metadataStep?.state === 'pending') {
      await app.setStep(job, 'metadata', 'skipped', '没有可补全的标识符')
    }

    // ── chunk + index ────────────────────────────────────────────────────
    await app.setStep(job, 'chunk', 'running')
    const chunks: Chunk[] = pages.length > 0 ? chunkPages(id, pages) : []
    if (chunks.length > 0) {
      await app.store.writeChunks(id, chunks)
      await app.setStep(job, 'chunk', 'done', `${chunks.length} 块`)
    } else {
      await app.setStep(job, 'chunk', 'skipped', '没有正文')
    }

    await app.setStep(job, 'index', 'running')
    await app.reindexPaper(id)
    await app.setStep(job, 'index', 'done', `${chunks.length} 块已入索引`)

    // ── summary ──────────────────────────────────────────────────────────
    if (app.store.config.autoSummarize && chunks.length > 0) {
      if (!app.summoner.enabled()) {
        await app.setStep(job, 'summary', 'skipped', 'AI 功能已关闭')
      } else if (!(await app.summoner.available())) {
        await app.setStep(job, 'summary', 'skipped', '未配置模型，导读稍后可重试')
      } else {
        await app.setStep(job, 'summary', 'running')
        try {
          const summary = await buildSummary({
            summoner: app.summoner,
            paper,
            pages,
            budgetChars: app.store.config.summarizeBudgetChars,
            onProgress: (detail) => {
              const step = job.steps.find((item) => item.key === 'summary')
              if (step) step.detail = detail
            },
          })
          await app.store.writeSummary(id, summary)
          const refined = mergeMetadata(paper, {
            ...summary.refined,
            abstract: summary.refined?.title ? paper.abstract : paper.abstract,
          })
          const patch: Partial<PaperRecord> = {
            tldr: summary.tldr,
            hasSummary: true,
            title: refined.title || paper.title,
            authors: (paper.authors?.length ? paper.authors : refined.authors) ?? [],
            year: paper.year ?? refined.year,
            venue: paper.venue ?? refined.venue,
            updatedAt: nowIso(),
          }
          await app.store.updatePaper(id, patch)
          paper = { ...paper, ...patch }
          await app.setStep(job, 'summary', 'done', summary.tldr ? truncate(summary.tldr, 40) : '已生成')
        } catch (error) {
          job.warnings.push(`导读未完成：${(error as Error).message}`)
          await app.setStep(job, 'summary', 'failed', truncate((error as Error).message, 120))
        }
      }
    } else {
      await app.setStep(job, 'summary', 'skipped', '自动导读已关闭')
    }

    // ── relations ────────────────────────────────────────────────────────
    // Deterministic layers always run; the model layers degrade to a warning,
    // because a missing profile should never make an imported PDF unreadable.
    await app.setStep(job, 'relations', 'running')
    try {
      const result = await app.relations.analyzePaper(paper, {
        reporter: (_step, state, detail) => {
          if (state === 'running' && detail) void app.setStep(job, 'relations', 'running', detail)
        },
      })
      if (result.edges.length > 0) {
        const stored = await app.store.readSummary(id)
        if (stored) {
          stored.related = result.edges.slice(0, 8).map((edge) => ({
            paperId: edge.from === id ? edge.to : edge.from,
            reason: edge.reason,
            weight: edge.confidence,
          }))
          await app.store.writeSummary(id, stored)
        }
      }
      const detail = result.profile
        ? `${result.edges.length} 条关联`
        : `${result.edges.length} 条关联 · 未生成画像`
      await app.setStep(job, 'relations', 'done', detail)
    } catch (error) {
      job.warnings.push(`关联推断未完成：${(error as Error).message}`)
      await app.setStep(job, 'relations', 'failed', truncate((error as Error).message, 120))
    }

    job.paperId = id
    job.state = 'done'
    job.finishedAt = nowIso()
    await app.saveJob(job)
  } catch (error) {
    app.log(`import failed: ${job.id}`, error)
    const running = job.steps.find((step) => step.state === 'running') ?? job.steps.find((step) => step.state === 'pending')
    if (running) {
      running.state = 'failed'
      running.detail = truncate((error as Error).message, 140)
    }
    job.state = 'failed'
    job.error = truncate((error as Error).message, 300)
    job.finishedAt = nowIso()
    await app.saveJob(job)
  }
}

/**
 * Re-run only the summary + relations steps for an already parsed paper.
 *
 * The summary is committed before relation analysis. Relations are an
 * enhancement: if they fail, the endpoint still returns the guide that was
 * just generated (with a warning) instead of telling the reader the guide
 * failed after it had already been saved.
 */
export async function refreshSummary(
  app: HostApp,
  paperId: string,
  { maxBudget, onProgress }: { maxBudget?: number; onProgress?: (step: string) => void } = {},
): Promise<{ summary: Summary; edges: RelationEdge[]; warning?: string }> {
  const paper = app.store.getPaper(paperId)
  if (!paper) throw new Error('论文不存在')
  if (!app.summoner.enabled()) {
    throw Object.assign(new Error('AI 功能已在设置中关闭'), { code: 'AI_DISABLED' })
  }
  const pages = await app.store.readPages(paperId)
  if (!pages || pages.length === 0) throw new Error('还没有解析正文')
  const available = await app.summoner.available()
  if (!available) throw new Error('未配置模型')

  const summary = await buildSummary({
    summoner: app.summoner,
    paper,
    pages,
    budgetChars: maxBudget ?? app.store.config.summarizeBudgetChars,
    onProgress,
  })
  await app.store.writeSummary(paperId, summary)
  const patch: Partial<PaperRecord> = {
    tldr: summary.tldr,
    hasSummary: true,
    title: paper.title || summary.refined?.title,
    authors: (paper.authors?.length ? paper.authors : summary.refined?.authors) ?? [],
    year: paper.year ?? summary.refined?.year,
    venue: paper.venue ?? summary.refined?.venue,
    updatedAt: nowIso(),
  }
  await app.store.updatePaper(paperId, patch)

  const next = { ...paper, ...patch }
  app.relations.invalidate(paperId)
  onProgress?.('更新关联')
  try {
    const result = await app.relations.analyzePaper(next)
    return { summary, edges: result.edges }
  } catch (error) {
    app.log(`relation refresh after summary failed: ${paperId}`, error)
    return {
      summary,
      edges: [],
      warning: `导读已生成，但关联更新失败：${truncate((error as Error).message, 160)}`,
    }
  }
}

/** Rebuild the whole relation graph as a normal queued job. */
async function runRelationJob(app: HostApp, job: Job): Promise<void> {
  job.state = 'running'
  job.startedAt = nowIso()
  await app.saveJob(job)
  let chain = Promise.resolve()
  const reporter = (
    step: 'profiles' | 'citations' | 'pairs' | 'judge' | 'clusters',
    state: 'running' | 'done' | 'failed' | 'skipped',
    detail?: string,
  ): void => {
    chain = chain.then(() => app.setStep(job, step, state, detail)).catch(() => {})
  }
  const scope = job.source.scope && job.source.scope !== 'all' ? job.source.scope : undefined
  try {
    const result = await app.relations.rebuild({ scope, reporter })
    await chain
    job.state = 'done'
    job.finishedAt = nowIso()
    job.warnings = [
      ...(job.warnings ?? []),
      ...(result.profiles === 0 && !app.summoner.enabled()
        ? ['AI 功能已关闭：只使用了引用与文本相似度']
        : result.profiles === 0 && !(await app.summoner.available())
          ? ['未配置模型：只使用了引用与文本相似度']
          : []),
    ]
    await app.saveJob(job)
  } catch (error) {
    await chain.catch(() => {})
    const running = job.steps.find((step) => step.state === 'running') ?? job.steps.find((step) => step.state === 'pending')
    if (running) {
      running.state = 'failed'
      running.detail = truncate((error as Error).message, 140)
    }
    job.state = 'failed'
    job.error = truncate((error as Error).message, 300)
    job.finishedAt = nowIso()
    await app.saveJob(job)
  }
}

export function installImportRunner(app: HostApp): void {
  app.onJobRunner((job) => app.tasks.run(
    job.id,
    () => (job.kind === 'relations' ? runRelationJob(app, job) : runJob(app, job)),
  ))
}
