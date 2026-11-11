/** annotations and free-form notes. */

import type { HostApp } from '../../app.js'
import { readJson, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerAnnotations(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^papers\/([^/]+)\/annotations\/?$/, async (ctx, [id]) => {
    sendJson(ctx.res, 200, { annotations: await app.store.readAnnotations(id) })
  }])

  routes.push(['POST', /^papers\/([^/]+)\/annotations\/?$/, async (ctx, [id]) => {
    const body = await readJson(ctx.req)
    if (!Array.isArray(body.rects) || body.rects.length === 0) {
      return sendError(ctx.res, 400, '缺少位置信息', 'BAD_RECTS')
    }
    const annotation = await app.store.addAnnotation(id, body)
    sendJson(ctx.res, 201, annotation)
  }])

  routes.push(['PATCH', /^papers\/([^/]+)\/annotations\/([^/]+)\/?$/, async (ctx, [id, annotationId]) => {
    const body = await readJson(ctx.req)
    const updated = await app.store.updateAnnotation(id, annotationId, body)
    if (!updated) return sendError(ctx.res, 404, '批注不存在', 'NOT_FOUND')
    if (body.note !== undefined) await app.reindexPaper(id)
    sendJson(ctx.res, 200, updated)
  }])

  routes.push(['DELETE', /^papers\/([^/]+)\/annotations\/([^/]+)\/?$/, async (ctx, [id, annotationId]) => {
    const removed = await app.store.removeAnnotation(id, annotationId)
    sendJson(ctx.res, removed ? 200 : 404, { ok: removed })
  }])

  routes.push(['GET', /^papers\/([^/]+)\/notes\/?$/, async (ctx, [id]) => {
    sendJson(ctx.res, 200, { notes: await app.store.readNotes(id) })
  }])

  routes.push(['POST', /^papers\/([^/]+)\/notes\/?$/, async (ctx, [id]) => {
    const body = await readJson(ctx.req)
    const text = String(body.body ?? '').trim()
    if (text.length === 0) return sendError(ctx.res, 400, '笔记为空', 'EMPTY_NOTE')
    const note = await app.store.addNote(id, { ...body, body: text })
    await app.reindexPaper(id)
    sendJson(ctx.res, 201, note)
  }])

  routes.push(['DELETE', /^papers\/([^/]+)\/notes\/([^/]+)\/?$/, async (ctx, [id, noteId]) => {
    const removed = await app.store.removeNote(id, noteId)
    if (removed) await app.reindexPaper(id)
    sendJson(ctx.res, removed ? 200 : 404, { ok: removed })
  }])
}
