/** model catalog, config, watch-folder scan. */

import type { HostApp } from '../../app.js'
import { normalizeTranslationSettings } from '../../../shared/translation.js'
import { readJson, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerSettings(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^models\/?$/, async (ctx) => {
    const catalog = await app.summoner.catalog()
    sendJson(ctx.res, 200, {
      ...catalog,
      current: app.store.config.provider && app.store.config.model
        ? { provider: app.store.config.provider, model: app.store.config.model }
        : null,
    })
  }])

  routes.push(['GET', /^config\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, {
      ...app.store.config,
      inbox: app.store.inbox,
      home: app.store.root,
      available: await app.summoner.available(),
      route: await app.summoner.target(),
      translationKeys: await app.translationEngines.keys(),
      /** Whether this profile can host per-paper DSH sessions at all. */
      sessionsAvailable: app.chat.available(),
    })
  }])

  routes.push(['POST', /^config\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const previous = app.store.config
    const next = { ...previous }
    if (Array.isArray(body.watchFolders)) {
      next.watchFolders = [...new Set<string>(body.watchFolders.map((folder: unknown) => String(folder).trim()).filter(Boolean))]
    }
    if (typeof body.provider === 'string') next.provider = body.provider.trim()
    if (typeof body.model === 'string') next.model = body.model.trim()
    if (typeof body.autoSummarize === 'boolean') next.autoSummarize = body.autoSummarize
    if (typeof body.aiEnabled === 'boolean') next.aiEnabled = body.aiEnabled
    if (typeof body.paperSessionInSidebar === 'boolean') next.paperSessionInSidebar = body.paperSessionInSidebar
    if (typeof body.relationsUseModel === 'boolean') next.relationsUseModel = body.relationsUseModel
    if (typeof body.experimentalFullTextTranslation === 'boolean') {
      next.experimentalFullTextTranslation = body.experimentalFullTextTranslation
    }
    if (typeof body.experimentalTranslationSources === 'boolean') {
      next.experimentalTranslationSources = body.experimentalTranslationSources
    }
    if (body.translation && typeof body.translation === 'object') {
      const incoming = body.translation as Record<string, unknown>
      const previousTranslation = previous.translation
      const nested = (key: 'local' | 'api' | 'browser' | 'native'): Record<string, unknown> => ({
        ...((previousTranslation?.[key] ?? {}) as Record<string, unknown>),
        ...(incoming[key] && typeof incoming[key] === 'object'
          ? (incoming[key] as Record<string, unknown>)
          : {}),
      })
      next.translation = normalizeTranslationSettings({
        ...previousTranslation,
        ...incoming,
        local: nested('local'),
        api: nested('api'),
        browser: nested('browser'),
        native: nested('native'),
      })
    }
    if (typeof body.experimentalTaskCenter === 'boolean') {
      next.experimentalTaskCenter = body.experimentalTaskCenter
    }
    if (body.libraryDefaultView === 'list' || body.libraryDefaultView === 'grid') {
      next.libraryDefaultView = body.libraryDefaultView
    }
    if (typeof body.recentLimit === 'number' && Number.isFinite(body.recentLimit)) {
      next.recentLimit = Math.max(1, Math.min(100, Math.round(body.recentLimit)))
    }
    if (typeof body.maxImportBytes === 'number' && body.maxImportBytes > 1024 * 1024) {
      next.maxImportBytes = Math.round(body.maxImportBytes)
    }
    app.store.config = next
    await app.store.saveConfig()
    app.summoner.cached = null
    // Turning the experiment off must also stop whatever custom-source run is
    // in flight; the stored choice is kept for when it is turned back on.
    if (previous.experimentalTranslationSources === true && next.experimentalTranslationSources !== true) {
      await app.translation.cancelAll().catch((error) => app.log('translation cancel failed', error))
    }
    // The toggle must also apply to sessions that already exist, so it walks
    // every paper session instead of only affecting the next one.
    if (next.paperSessionInSidebar !== previous.paperSessionInSidebar) {
      await app.chat.syncSidebar(next.paperSessionInSidebar)
    }
    sendJson(ctx.res, 200, {
      ...next,
      inbox: app.store.inbox,
      home: app.store.root,
      translationKeys: await app.translationEngines.keys(),
      sessionsAvailable: app.chat.available(),
    })
  }])

  routes.push(['POST', /^scan\/?$/, async (ctx) => {
    const result = await app.scanWatchFolders()
    sendJson(ctx.res, 202, result)
  }])
}
