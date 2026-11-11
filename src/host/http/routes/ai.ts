/**
 * Streaming answers bound to the current paper, plus the two endpoints the new
 * conversation UI needs (transcript and manual compaction).
 *
 * The SSE protocol is unchanged from the days when every question was an
 * independent `llm.stream` call: `delta` / `done` / `error`. Only the transport
 * behind it changed — one DSH session per paper.
 */

import type { HostApp } from '../../app.js'
import type { ChatSink, PaperChatMode } from '../../ai/chat.js'
import { truncate } from '../../util/util.js'
import { openSse, readJson, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

const KINDS: PaperChatMode[] = ['ask', 'explain', 'translate']

export function registerAi(routes: Route[], app: HostApp): void {
  routes.push(['POST', /^ask\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const paperId = String(body.paperId ?? '')
    const kind: PaperChatMode = KINDS.includes(body.kind) ? body.kind : 'ask'
    const question = String(body.question ?? '').trim()
    const quote = String(body.quote ?? '').trim()
    const page = Number(body.page) || undefined
    if (!paperId) return sendError(ctx.res, 400, '缺少 paperId', 'BAD_REQUEST')
    if (kind === 'ask' && question.length === 0) return sendError(ctx.res, 400, '问题为空', 'EMPTY_QUESTION')
    if (kind !== 'ask' && quote.length === 0) return sendError(ctx.res, 400, '没有选中的段落', 'EMPTY_QUOTE')

    const paper = app.store.getPaper(paperId)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')

    // Selection translation follows the configured source; only the "ask" and
    // "explain" modes are session-bound and always use the harness model.
    if (kind === 'translate') {
      const runtime = await app.translation.describe()
      if (runtime.source === 'browser') {
        return sendError(ctx.res, 409, '浏览器内置翻译在页面内执行', 'BROWSER_TRANSLATION')
      }
      if (!runtime.allowed) {
        return sendError(
          ctx.res,
          503,
          runtime.aiEnabled ? '当前翻译来源不可用' : 'AI 功能已在设置中关闭',
          'AI_DISABLED',
        )
      }
      if (!runtime.engine.available) {
        return sendError(
          ctx.res,
          503,
          runtime.engine.error ?? '翻译来源不可用',
          'SOURCE_UNAVAILABLE',
        )
      }

      const controller = new AbortController()
      const stream = openSse(ctx.req, ctx.res)
      ctx.res.on('close', () => {
        if (!ctx.res.writableEnded) controller.abort()
      })
      try {
        for await (const delta of app.translation.streamText(truncate(quote, 1500), controller.signal)) {
          if (stream.closed) break
          stream.send({ type: 'delta', text: delta })
        }
        stream.send({ type: 'done', citations: [] })
      } catch (error) {
        if (!controller.signal.aborted) {
          stream.send({ type: 'error', message: truncate(String((error as Error)?.message ?? error), 240) })
        }
      } finally {
        stream.end()
      }
      return
    }

    if (!app.summoner.enabled()) {
      return sendError(ctx.res, 503, 'AI 功能已在设置中关闭', 'AI_DISABLED')
    }

    const available = await app.summoner.available()
    if (!available) return sendError(ctx.res, 503, '还没有可用的模型，请先在设置里选择模型', 'LLM_UNAVAILABLE')

    const controller = new AbortController()
    const stream = openSse(ctx.req, ctx.res)
    // `req` closes as soon as the POST body is read; the response closing early
    // is the real "user went away" signal.
    ctx.res.on('close', () => {
      if (!ctx.res.writableEnded) controller.abort()
    })

    const sink: ChatSink = {
      delta: (text) => stream.send({ type: 'delta', text }),
      done: (payload) => stream.send({
        type: 'done',
        citations: [...new Set(payload.citations)].filter((value) => Number.isFinite(value) && value > 0),
      }),
      error: (message) => stream.send({ type: 'error', message: truncate(message, 240) }),
      get closed() {
        return stream.closed
      },
    }

    try {
      await app.chat.stream({ paperId, kind, question, quote, page }, sink, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) sink.error(String(error?.message ?? error))
    } finally {
      stream.end()
    }
  }])

  routes.push(['GET', /^papers\/([^/]+)\/chat\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, await app.chat.history(id))
  }])

  routes.push(['GET', /^papers\/([^/]+)\/models\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, await app.chat.models(id))
  }])

  routes.push(['POST', /^papers\/([^/]+)\/model\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    const body = await readJson(ctx.req)
    try {
      const route = await app.chat.setModel(id, {
        provider: String(body.provider ?? ''),
        model: String(body.model ?? ''),
        ...(typeof body.reasoningEffort === 'string' && body.reasoningEffort !== ''
          ? { reasoningEffort: body.reasoningEffort }
          : {}),
      })
      sendJson(ctx.res, 200, route)
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'MODEL_UNAVAILABLE')
    }
  }])

  routes.push(['POST', /^papers\/([^/]+)\/compact\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    if (!app.summoner.enabled()) {
      return sendError(ctx.res, 503, 'AI 功能已在设置中关闭', 'AI_DISABLED')
    }
    try {
      const result = await app.chat.compact(id)
      sendJson(ctx.res, 200, result)
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'COMPACT_FAILED')
    }
  }])

  // Clearing the context = a brand-new session for the same paper; the old one
  // stays on disk as this paper's conversation history.
  routes.push(['POST', /^papers\/([^/]+)\/reset\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    try {
      sendJson(ctx.res, 200, await app.chat.reset(id))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'RESET_FAILED')
    }
  }])

  // The paper's conversation list: active first, then every older transcript.
  routes.push(['GET', /^papers\/([^/]+)\/conversations\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, await app.chat.conversations(id))
  }])

  routes.push(['POST', /^papers\/([^/]+)\/conversations\/?$/, async (ctx, [id]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    try {
      sendJson(ctx.res, 200, await app.chat.createConversation(id))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'NEW_CONVERSATION_FAILED')
    }
  }])

  routes.push(['POST', /^papers\/([^/]+)\/conversations\/([^/]+)\/select\/?$/, async (ctx, [id, sessionId]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    try {
      sendJson(ctx.res, 200, await app.chat.selectConversation(id, sessionId))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'SELECT_CONVERSATION_FAILED')
    }
  }])

  routes.push(['PATCH', /^papers\/([^/]+)\/conversations\/([^/]+)\/?$/, async (ctx, [id, sessionId]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    const body = await readJson(ctx.req)
    try {
      sendJson(ctx.res, 200, await app.chat.renameConversation(id, sessionId, String(body.title ?? '')))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'RENAME_CONVERSATION_FAILED')
    }
  }])

  routes.push(['POST', /^papers\/([^/]+)\/conversations\/([^/]+)\/archive\/?$/, async (ctx, [id, sessionId]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    try {
      sendJson(ctx.res, 200, await app.chat.archiveConversation(id, sessionId))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'ARCHIVE_CONVERSATION_FAILED')
    }
  }])

  routes.push(['POST', /^papers\/([^/]+)\/conversations\/([^/]+)\/unarchive\/?$/, async (ctx, [id, sessionId]) => {
    const paper = app.store.getPaper(id)
    if (!paper) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    try {
      sendJson(ctx.res, 200, await app.chat.unarchiveConversation(id, sessionId))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'UNARCHIVE_CONVERSATION_FAILED')
    }
  }])
}
