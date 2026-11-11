/** library and folders: list, detail, patch, delete, move, pages, PDF bytes, maintenance. */

import fs from 'node:fs/promises'
import type { HostApp } from '../../app.js'
import type { PaperRecord } from '../../../shared/domain.js'
import { PREFIX } from '../../../shared/constants.js'
import { cleanDoi } from '../../ingest/identifiers.js'
import { nowIso } from '../../util/util.js'
import { searchPaperText } from '../../search/paper.js'
import { pipeFile, readJson, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerLibrary(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^papers\/?$/, async (ctx) => {
    const { searchParams } = ctx.url
    const papers = app.listPapers({
      q: searchParams.get('q') ?? '',
      status: searchParams.get('status') ?? 'all',
      tag: searchParams.get('tag'),
      folder: searchParams.get('folder'),
      author: searchParams.get('author'),
      year: Number(searchParams.get('year')) || null,
      venue: searchParams.get('venue'),
      sort: searchParams.get('sort') ?? 'added',
    })
    const all = app.store.activePapers()
    const tagCounts = new Map()
    for (const paper of all) {
      for (const item of paper.tags ?? []) tagCounts.set(item, (tagCounts.get(item) ?? 0) + 1)
    }
    sendJson(ctx.res, 200, {
      papers: papers.map(app.cardOf),
      ...app.folderView(),
      trash: app.store.trashedPapers().map(app.cardOf),
      tags: [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
      counts: {
        all: all.length,
        todo: all.filter((paper) => paper.status === 'todo').length,
        reading: all.filter((paper) => paper.status === 'reading').length,
        done: all.filter((paper) => paper.status === 'done').length,
        recent: all.filter((paper) => Boolean(paper.lastRead?.at)).length,
        trash: app.store.trashedPapers().length,
      },
    })
  }])

  routes.push(['GET', /^papers\/([^/]+)\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (paper.deletedAt) return sendError(ctx.res, 404, '论文在回收站里', 'TRASHED')
    let missing = false
    if (paper.filePath) {
      try {
        await fs.access(paper.filePath)
      } catch {
        missing = true
        await app.store.updatePaper(id, { missing: true })
      }
    }
    const view = await app.paperView(paper)
    sendJson(ctx.res, 200, {
      ...view,
      missing: missing || Boolean(paper.missing),
      fileUrl: paper.filePath && !missing ? `${PREFIX}papers/${id}/file` : null,
    })
  }])

  routes.push(['PATCH', /^papers\/([^/]+)\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (paper.deletedAt) return sendError(ctx.res, 409, '论文在回收站里', 'TRASHED')
    const body = await readJson(ctx.req)
    const patch: Partial<PaperRecord> = {}
    if (typeof body.status === 'string' && ['todo', 'reading', 'done'].includes(body.status)) patch.status = body.status
    if (typeof body.progress === 'number') patch.progress = Math.max(0, Math.min(100, Math.round(body.progress)))
    if (Array.isArray(body.tags)) patch.tags = body.tags.map((tag: unknown) => String(tag).trim().slice(0, 24)).filter(Boolean).slice(0, 24)
    if (body.folder !== undefined) {
      if (body.folder === null || body.folder === '') patch.folder = null
      else if (app.store.getFolder(String(body.folder))) patch.folder = String(body.folder)
      else return sendError(ctx.res, 400, '文件夹不存在', 'NO_FOLDER')
    }

    let metadataChanged = false
    const text = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)
    if (body.title !== undefined) {
      const title = text(body.title, 500)
      if (!title) return sendError(ctx.res, 400, '标题不能为空', 'BAD_TITLE')
      patch.title = title
      metadataChanged = true
    }
    if (body.authors !== undefined) {
      if (!Array.isArray(body.authors)) return sendError(ctx.res, 400, '作者格式不正确', 'BAD_AUTHORS')
      patch.authors = [...new Set<string>(
        (body.authors as unknown[])
          .map((name) => text(name, 120))
          .filter((name) => name.length > 0),
      )].slice(0, 30)
      metadataChanged = true
    }
    if (body.year !== undefined) {
      if (body.year === null || body.year === '') patch.year = undefined
      else {
        const year = Number(body.year)
        if (!Number.isInteger(year) || year < 1000 || year > 2100) {
          return sendError(ctx.res, 400, '年份需要在 1000–2100 之间', 'BAD_YEAR')
        }
        patch.year = year
      }
      metadataChanged = true
    }
    if (body.venue !== undefined) {
      patch.venue = text(body.venue, 200) || undefined
      metadataChanged = true
    }
    if (body.abstract !== undefined) {
      patch.abstract = text(body.abstract, 20_000) || undefined
      metadataChanged = true
    }
    if (body.doi !== undefined) {
      const raw = text(body.doi, 200)
      if (raw) {
        const doi = cleanDoi(raw)
        if (!doi) return sendError(ctx.res, 400, 'DOI 格式不正确', 'BAD_DOI')
        patch.doi = doi
      } else {
        patch.doi = undefined
      }
      metadataChanged = true
    }
    if (body.arxivId !== undefined) {
      patch.arxivId = text(body.arxivId, 80) || undefined
      metadataChanged = true
    }
    if (body.pmid !== undefined) {
      const pmid = text(body.pmid, 20)
      if (pmid && !/^\d{1,9}$/.test(pmid)) {
        return sendError(ctx.res, 400, 'PMID 需要是数字', 'BAD_PMID')
      }
      patch.pmid = pmid || undefined
      metadataChanged = true
    }
    if (body.lastRead && typeof body.lastRead === 'object') {
      patch.lastRead = {
        page: Number(body.lastRead.page) || 1,
        scrollTop: Number(body.lastRead.scrollTop) || 0,
        at: nowIso(),
      }
    }
    const updated = await app.store.updatePaper(id, patch)
    if (!updated) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (metadataChanged) app.relations.invalidate(id)
    sendJson(ctx.res, 200, app.cardOf(updated))
  }])

  // ── folders ──────────────────────────────────────────────────────────────
  routes.push(['GET', /^folders\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, app.folderView())
  }])

  routes.push(['POST', /^folders\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    try {
      const folder = await app.store.addFolder(body.name, body.parentId ?? null)
      sendJson(ctx.res, 201, { ...folder, count: 0 })
    } catch (error) {
      sendError(ctx.res, 400, error.message, 'BAD_FOLDER')
    }
  }])

  routes.push(['PATCH', /^folders\/([^/]+)\/?$/, async (ctx, [id]) => {
    const body = await readJson(ctx.req)
    try {
      const folder = await app.store.renameFolder(id, body.name)
      if (!folder) return sendError(ctx.res, 404, '文件夹不存在', 'NOT_FOUND')
      sendJson(ctx.res, 200, folder)
    } catch (error) {
      sendError(ctx.res, 400, error.message, 'BAD_FOLDER')
    }
  }])

  routes.push(['POST', /^folders\/([^/]+)\/move\/?$/, async (ctx, [id]) => {
    const body = await readJson(ctx.req)
    if (body.parentId === undefined) return sendError(ctx.res, 400, '缺少目标上级文件夹', 'BAD_FOLDER')
    const parentId = body.parentId === null || body.parentId === '' ? null : String(body.parentId)
    const beforeId = body.beforeId === undefined || body.beforeId === null || body.beforeId === ''
      ? null
      : String(body.beforeId)
    try {
      const folder = await app.store.moveFolder(id, parentId, beforeId)
      if (!folder) return sendError(ctx.res, 404, '文件夹不存在', 'NOT_FOUND')
      sendJson(ctx.res, 200, app.folderView())
    } catch (error) {
      sendError(ctx.res, 400, error.message, 'BAD_FOLDER')
    }
  }])

  routes.push(['DELETE', /^folders\/([^/]+)\/?$/, async (ctx, [id]) => {
    const removed = await app.store.removeFolder(id)
    sendJson(ctx.res, removed.length > 0 ? 200 : 404, { ok: removed.length > 0, removed })
  }])

  // ── maintenance ──────────────────────────────────────────────────────────
  routes.push(['POST', /^maintenance\/reindex\/?$/, async (ctx) => {
    const result = await app.reindexAll()
    sendJson(ctx.res, 200, result)
  }])

  routes.push(['GET', /^maintenance\/missing\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, { papers: await app.findMissing() })
  }])

  routes.push(['POST', /^maintenance\/clean-missing\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, await app.cleanMissing())
  }])

  // Soft delete by default; `?permanent=1` is the recycle bin's "彻底删除".
  routes.push(['DELETE', /^papers\/([^/]+)\/?$/, async (ctx, [id]) => {
    const permanent = ctx.url.searchParams.get('permanent') === '1'
      || ctx.url.searchParams.get('permanent') === 'true'
    if (permanent) {
      const removed = await app.removePaper(id)
      return sendJson(ctx.res, removed ? 200 : 404, { ok: removed, permanent: true })
    }
    const trashed = await app.trashPaper(id)
    if (!trashed) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, { ok: true, permanent: false, deletedAt: trashed.deletedAt })
  }])

  routes.push(['POST', /^papers\/([^/]+)\/restore\/?$/, async (ctx, [id]) => {
    const paper = await app.restorePaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, app.cardOf(paper))
  }])

  routes.push(['DELETE', /^trash\/?$/, async (ctx) => {
    const removed = await app.emptyTrash()
    sendJson(ctx.res, 200, { ok: true, removed, count: removed.length })
  }])

  routes.push(['GET', /^papers\/([^/]+)\/pages\/(\d+)\/?$/, async (ctx, [id, page]) => {
    const pages = await app.store.readPages(id)
    const found = pages?.find((item) => item.page === Number(page))
    if (!found) return sendError(ctx.res, 404, '页面不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, found)
  }])

  // The reader's find box: exact matches in this paper's parsed text, in page
  // order. Separate from `/search`, which ranks the whole library's chunks.
  routes.push(['GET', /^papers\/([^/]+)\/search\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper || paper.deletedAt) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    const query = (ctx.url.searchParams.get('q') ?? '').trim()
    if (!query) return sendJson(ctx.res, 200, { query: '', total: 0, hits: [] })
    const limit = Math.max(1, Math.min(200, Number(ctx.url.searchParams.get('limit')) || 50))
    const pages = await app.store.readPages(id)
    if (!pages || !pages.some((page) => (page.blocks ?? []).some((block) => block.text.trim()))) {
      return sendJson(ctx.res, 200, { query, total: 0, hits: [], noText: true })
    }
    const found = searchPaperText(pages, query, limit)
    sendJson(ctx.res, 200, { query, total: found.total, hits: found.hits })
  }])

  routes.push(['GET', /^papers\/([^/]+)\/file\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper?.filePath) return sendError(ctx.res, 404, '没有 PDF', 'NO_FILE')
    let stat
    try {
      stat = await fs.stat(paper.filePath)
    } catch {
      await app.store.updatePaper(id, { missing: true })
      return sendError(ctx.res, 404, '原文件已不在原路径', 'MISSING_FILE')
    }
    const range = ctx.req.headers.range
    const headers = {
      'content-type': 'application/pdf',
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
      'last-modified': stat.mtime.toUTCString(),
    }
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (match) {
        const start = match[1] === '' ? Math.max(0, stat.size - Number(match[2])) : Number(match[1])
        const end = match[1] !== '' && match[2] !== '' ? Number(match[2]) : stat.size - 1
        if (Number.isNaN(start) || Number.isNaN(end) || start >= stat.size || end < start) {
          ctx.res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
          ctx.res.end()
          return
        }
        const safeEnd = Math.min(end, stat.size - 1)
        ctx.res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${safeEnd}/${stat.size}`,
          'content-length': safeEnd - start + 1,
        })
        pipeFile(paper.filePath, ctx.res, { start, end: safeEnd })
        return
      }
    }
    ctx.res.writeHead(200, { ...headers, 'content-length': stat.size })
    pipeFile(paper.filePath, ctx.res, undefined)
  }])
}
