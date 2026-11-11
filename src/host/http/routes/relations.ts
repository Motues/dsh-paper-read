/**
 * Relation graph, rebuild job, feedback and the cached insight.
 *
 * Route order matters: `/relations/graph`, `/relations/insights/:id` and the
 * action endpoints must be matched before the generic `/relations/:id`.
 */

import type { HostApp } from '../../app.js'
import { readJson, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerRelations(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^relations\/graph\/?$/, async (ctx) => {
    const focus = ctx.url.searchParams.get('focus')
    const depth = Number(ctx.url.searchParams.get('depth')) || 2
    const limit = Number(ctx.url.searchParams.get('limit')) || 400
    sendJson(ctx.res, 200, await app.relations.graph({ focus, depth, limit }))
  }])

  routes.push(['POST', /^relations\/rebuild\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const scope = body.scope ? String(body.scope) : undefined
    if (scope && scope !== 'all' && !app.store.getPaper(scope)) {
      return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    }
    const job = app.enqueueRelationRebuild(scope)
    sendJson(ctx.res, 200, { jobId: job.id })
  }])

  routes.push(['POST', /^relations\/feedback\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const action = String(body.action ?? '')
    if (!['accept', 'reject', 'pin', 'delete'].includes(action)) {
      return sendError(ctx.res, 400, '未知操作', 'BAD_REQUEST')
    }
    const edge = await app.relations.feedback({
      from: String(body.from ?? ''),
      to: String(body.to ?? ''),
      kind: String(body.kind ?? ''),
      action: action as 'accept' | 'reject' | 'pin' | 'delete',
    })
    sendJson(ctx.res, 200, { ok: true, edge })
  }])

  routes.push(['GET', /^relations\/insights\/([^/]+)\/?$/, async (ctx, [paperId]) => {
    const refresh = ctx.url.searchParams.get('refresh') === '1'
    const insight = await app.relations.insight(paperId, { refresh })
    sendJson(ctx.res, 200, { insight })
  }])

  routes.push(['POST', /^relations\/remove\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const removed = await app.store.removeRelation(String(body.from), String(body.to), body.kind)
    sendJson(ctx.res, 200, { ok: removed })
  }])

  // Compatibility surface for the reader's relation tab and older clients.
  routes.push(['GET', /^relations\/?$/, async (ctx) => {
    await app.ensureIndex()
    const byId = new Map(app.store.activePapers().map((paper) => [paper.id, paper]))
    const edges = app.store.readRelations()
      .filter((edge) => edge.status !== 'rejected')
      .filter((edge) => byId.has(edge.from) && byId.has(edge.to))
      .map((edge) => ({
        id: `${edge.from}->${edge.to}:${edge.kind}`,
        from: { id: edge.from, title: byId.get(edge.from)?.title ?? edge.from },
        to: { id: edge.to, title: byId.get(edge.to)?.title ?? edge.to },
        kind: edge.kind,
        reason: edge.reason,
        origin: edge.origin,
        confidence: edge.confidence,
        status: edge.status ?? 'confirmed',
        signals: edge.signals,
        evidence: edge.evidence,
      }))
    sendJson(ctx.res, 200, { edges })
  }])

  routes.push(['GET', /^relations\/([^/]+)\/?$/, async (ctx, [id]) => {
    sendJson(ctx.res, 200, await app.relations.relationView(id))
  }])
}
