/** job listing, progress stream, summary retry. */

import type { HostApp } from '../../app.js'
import { refreshSummary } from '../../ingest/pipeline.js'
import { nowIso, normalizeSpace } from '../../util/util.js'
import { openSse, readJson, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerJobs(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^jobs\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, { jobs: await app.store.listJobs(12) })
  }])

  routes.push(['GET', /^jobs\/([^/]+)\/?$/, async (ctx, [id]) => {
    const job = await app.store.readJob(id)
    if (!job) return sendError(ctx.res, 404, '任务不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, job)
  }])

  routes.push(['GET', /^jobs\/([^/]+)\/stream\/?$/, async (ctx, [id]) => {
    const job = await app.store.readJob(id)
    if (!job) return sendError(ctx.res, 404, '任务不存在', 'NOT_FOUND')
    const stream = openSse(ctx.req, ctx.res)
    stream.send(job)
    if (job.state === 'done' || job.state === 'failed') {
      stream.end()
      return
    }
    const unsubscribe = app.subscribeJob(id, (next) => {
      stream.send(next)
      if (next.state === 'done' || next.state === 'failed') {
        unsubscribe()
        setTimeout(() => stream.end(), 30)
      }
    })
    const heartbeat = setInterval(() => stream.comment('ping'), 15_000)
    ctx.res.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      stream.end()
    })
    // The job may have finished between the snapshot read and the subscription.
    const latest = await app.store.readJob(id)
    if (latest && (latest.state === 'done' || latest.state === 'failed')) {
      stream.send(latest)
      unsubscribe()
      clearInterval(heartbeat)
      stream.end()
    }
  }])

  // ── summary retry + manual edit ──────────────────────────────────────────
  routes.push(['POST', /^papers\/([^/]+)\/summarize\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (paper.deletedAt) return sendError(ctx.res, 409, '论文在回收站里', 'TRASHED')
    if (!app.summoner.enabled()) {
      return sendError(ctx.res, 503, 'AI 功能已在设置中关闭', 'AI_DISABLED')
    }
    const task = app.tasks.begin({
      kind: 'summary',
      title: paper.title,
      paperId: id,
      detail: '准备正文',
    })
    try {
      const result = await app.tasks.run(task.id, () => refreshSummary(app, id, {
        onProgress: (step) => task.update({ detail: step }),
      }))
      task.finish({
        state: 'done',
        detail: result.warning ? '完成（关联更新失败）' : '完成',
      })
      sendJson(ctx.res, 200, {
        summary: result.summary,
        edges: result.edges,
        ...(result.warning ? { warning: result.warning } : {}),
      })
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      task.finish({ state: 'failed', detail: '失败', error: message })
      sendError(ctx.res, error.code === 'AI_DISABLED' ? 503 : 500, message, error.code ?? 'SUMMARY_FAILED')
    }
  }])

  routes.push(['PATCH', /^papers\/([^/]+)\/summary\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (paper.deletedAt) return sendError(ctx.res, 409, '论文在回收站里', 'TRASHED')
    const summary = await app.store.readSummary(id)
    if (!summary) return sendError(ctx.res, 404, '这篇论文还没有导读', 'NO_SUMMARY')
    const body = await readJson(ctx.req)
    const text = (value: unknown, max: number): string => normalizeSpace(value).slice(0, max)
    const list = (value: unknown, max: number): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      return value
        .map((item) => normalizeSpace(item).slice(0, 240))
        .filter((item) => item.length > 0)
        .slice(0, max)
    }

    if (body.tldr !== undefined) summary.tldr = text(body.tldr, 160)
    if (body.problem !== undefined) summary.problem = text(body.problem, 600)
    if (body.method !== undefined) summary.method = text(body.method, 1200)
    const findings = list(body.findings, 10)
    if (findings) summary.findings = findings
    const limitations = list(body.limitations, 8)
    if (limitations) summary.limitations = limitations
    const reusable = list(body.reusable, 8)
    if (reusable) summary.reusable = reusable
    summary.editedAt = nowIso()

    await app.store.writeSummary(id, summary)
    await app.store.updatePaper(id, {
      tldr: summary.tldr || paper.tldr,
      hasSummary: true,
    })
    sendJson(ctx.res, 200, { summary })
  }])
}
