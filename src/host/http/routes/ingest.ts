/** import entry points: PDF upload, link, existing file. */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { HostApp } from '../../app.js'
import { normalizeLink } from '../../ingest/link.js'
import { readBody, readJson, safeName, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerIngest(routes: Route[], app: HostApp): void {
  /** `?folder=` / body.folder targets a folder; unknown ids are ignored. */
  const folderOf = (value: unknown): string | undefined => {
    const id = typeof value === 'string' ? value.trim() : ''
    return id && app.store.getFolder(id) ? id : undefined
  }

  routes.push(['POST', /^papers\/([^/]+)\/attach\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (paper.hasFullText) return sendError(ctx.res, 400, '这篇论文已经有 PDF', 'HAS_PDF')

    const name = safeName(ctx.url.searchParams.get('name') ?? `${paper.title.slice(0, 60)}.pdf`)
    const body = await readBody(ctx.req, app.store.config.maxImportBytes)
    if (body.length < 5 || body.subarray(0, 4).toString('latin1') !== '%PDF') {
      return sendError(ctx.res, 400, '不是有效的 PDF 文件', 'NOT_PDF')
    }
    await fs.mkdir(app.store.inbox, { recursive: true })
    const stamp = Date.now().toString(36)
    const target = path.join(app.store.inbox, `${stamp}-${name}`)
    await fs.writeFile(target, body)
    const job = app.enqueueJob({ kind: 'file', filePath: target, paperId: id })
    sendJson(ctx.res, 202, { jobId: job.id, fileName: name, filePath: target })
  }])

  routes.push(['POST', /^import\/pdf\/?$/, async (ctx) => {
    const { searchParams } = ctx.url
    const name = safeName(searchParams.get('name') ?? 'paper.pdf')
    const body = await readBody(ctx.req, app.store.config.maxImportBytes)
    if (body.length < 5 || body.subarray(0, 4).toString('latin1') !== '%PDF') {
      return sendError(ctx.res, 400, '不是有效的 PDF 文件', 'NOT_PDF')
    }
    await fs.mkdir(app.store.inbox, { recursive: true })
    const stamp = Date.now().toString(36)
    const target = path.join(app.store.inbox, `${stamp}-${name}`)
    await fs.writeFile(target, body)
    const job = app.enqueueJob({ kind: 'file', filePath: target, folder: folderOf(searchParams.get('folder')) })
    sendJson(ctx.res, 202, { jobId: job.id, fileName: name, filePath: target })
  }])

  routes.push(['POST', /^import\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    let url
    try {
      url = normalizeLink(body.url).url
    } catch (error) {
      return sendError(ctx.res, 400, error.message, error.code ?? 'BAD_LINK')
    }
    const job = app.enqueueJob({ kind: 'url', url, folder: folderOf(body.folder) })
    sendJson(ctx.res, 202, { jobId: job.id, url })
  }])

  routes.push(['POST', /^import\/file\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const filePath = String(body.path ?? '').trim()
    if (!filePath) return sendError(ctx.res, 400, '缺少路径', 'BAD_PATH')
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return sendError(ctx.res, 400, '不是文件', 'BAD_PATH')
    } catch {
      return sendError(ctx.res, 404, '找不到这个文件', 'BAD_PATH')
    }
    const job = app.enqueueJob({ kind: 'file', filePath, folder: folderOf(body.folder) })
    sendJson(ctx.res, 202, { jobId: job.id, filePath })
  }])
}
