/** Full-text translation status, page payloads and the background run. */

import type { HostApp } from '../../app.js'
import type { TranslationKeyProvider } from '../../../shared/translation.js'
import { readJson, sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerTranslation(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^translation\/sources\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, await app.translation.describe())
  }])

  routes.push(['GET', /^translation\/models\/?$/, async (ctx) => {
    const target = ctx.url.searchParams.get('target') === 'local' ? 'local' : 'api'
    try {
      sendJson(ctx.res, 200, await app.translationEngines.models(target))
    } catch (error) {
      // Discovery failures are configuration feedback, not a broken endpoint.
      sendJson(ctx.res, 200, {
        models: [],
        error: String((error as Error)?.message ?? error).slice(0, 300),
      })
    }
  }])

  routes.push(['POST', /^translation\/key\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const provider = String(body.provider ?? '')
    try {
      await app.translationEngines.setKey(
        provider as TranslationKeyProvider,
        String(body.value ?? '').slice(0, 4096),
      )
      sendJson(ctx.res, 200, { keys: await app.translationEngines.keys() })
    } catch (error) {
      sendError(
        ctx.res,
        (error as { status?: number })?.status ?? 500,
        String((error as Error)?.message ?? error),
        (error as { code?: string })?.code ?? 'KEY_FAILED',
      )
    }
  }])

  routes.push(['POST', /^translation\/test\/?$/, async (ctx) => {
    const started = Date.now()
    let runtime: Awaited<ReturnType<HostApp['translation']['describe']>>
    try {
      runtime = await app.translation.describe()
    } catch (error) {
      return sendJson(ctx.res, 200, {
        ok: false,
        ms: Date.now() - started,
        engine: 'unknown',
        error: String((error as Error)?.message ?? error).slice(0, 300),
      })
    }
    if (runtime.source === 'browser') {
      return sendError(ctx.res, 400, '浏览器内置翻译需要在页面内检测', 'BROWSER_SOURCE')
    }
    try {
      const output = await app.translation.translateText(
        'The proposed method improves accuracy by 3.2% on the benchmark.',
        AbortSignal.timeout(180_000),
      )
      sendJson(ctx.res, 200, {
        ok: true,
        ms: Date.now() - started,
        engine: runtime.engine.label,
        output: output.slice(0, 400),
      })
    } catch (error) {
      sendJson(ctx.res, 200, {
        ok: false,
        ms: Date.now() - started,
        engine: runtime.engine.label,
        error: String((error as Error)?.message ?? error).slice(0, 300),
      })
    }
  }])

  routes.push(['GET', /^papers\/([^/]+)\/translation\/?$/, async (ctx, [id]) => {
    if (!app.store.getPaper(id)) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    sendJson(ctx.res, 200, await app.translation.status(id))
  }])

  routes.push(['GET', /^papers\/([^/]+)\/translation\/pages\/(\d+)\/?$/, async (ctx, [id, page]) => {
    if (!app.store.getPaper(id)) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    const payload = await app.translation.page(id, Number(page))
    if (!payload) return sendError(ctx.res, 404, '这一页没有解析文本', 'NO_PAGE')
    sendJson(ctx.res, 200, payload)
  }])

  // The continuous reflowed view needs the whole paper's structure in one
  // round-trip: per-page order, skip reasons, visuals and translations.
  routes.push(['GET', /^papers\/([^/]+)\/translation\/document\/?$/, async (ctx, [id]) => {
    if (!app.store.getPaper(id)) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    try {
      sendJson(ctx.res, 200, await app.translation.document(id))
    } catch (error) {
      sendError(ctx.res, (error as { status?: number })?.status ?? 500, String((error as Error)?.message ?? error), 'TRANSLATION_DOCUMENT_FAILED')
    }
  }])

  routes.push(['POST', /^papers\/([^/]+)\/translation\/blocks\/?$/, async (ctx, [id]) => {
    if (!app.store.getPaper(id)) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    const body = await readJson(ctx.req)
    const page = Number(body.page)
    if (!Number.isInteger(page) || page < 1) {
      return sendError(ctx.res, 400, '缺少页码', 'BAD_REQUEST')
    }
    const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 2000) : []
    try {
      const runtime = await app.translation.describe()
      if (runtime.source !== 'browser') {
        return sendError(ctx.res, 409, '当前翻译来源不是浏览器内置翻译', 'NOT_BROWSER_SOURCE')
      }
      const result = await app.translation.commitExternal(id, page, blocks, runtime.engine.label)
      sendJson(ctx.res, 200, result)
    } catch (error) {
      sendError(
        ctx.res,
        (error as { status?: number })?.status ?? 500,
        String((error as Error)?.message ?? error),
        (error as { code?: string })?.code ?? 'TRANSLATION_COMMIT_FAILED',
      )
    }
  }])

  routes.push(['POST', /^papers\/([^/]+)\/translation\/?$/, async (ctx, [id]) => {
    if (!app.store.getPaper(id)) return sendError(ctx.res, 404, '论文不存在', 'NOT_FOUND')
    const body = await readJson(ctx.req)
    const action = String(body.action ?? 'start')
    if (action === 'cancel') {
      sendJson(ctx.res, 200, await app.translation.cancel(id))
      return
    }
    const runtime = await app.translation.describe()
    if (runtime.source === 'browser') {
      return sendError(ctx.res, 409, '浏览器内置翻译在页面内执行，无需启动宿主任务', 'BROWSER_SOURCE')
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
    const parsedPages = await app.store.readPages(id)
    if (!parsedPages || parsedPages.length === 0) {
      return sendError(ctx.res, 409, '这篇论文还没有解析出全文，暂时不能翻译', 'NO_FULL_TEXT')
    }
    const pages = Array.isArray(body.pages)
      ? body.pages.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
      : undefined
    try {
      sendJson(ctx.res, 200, await app.translation.start(id, {
        ...(pages && pages.length > 0 ? { pages } : {}),
        ...(body.force === true ? { force: true } : {}),
      }))
    } catch (error) {
      sendError(ctx.res, error.status ?? 500, String(error?.message ?? error), 'TRANSLATION_FAILED')
    }
  }])
}
