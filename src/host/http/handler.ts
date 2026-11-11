/**
 * HTTP surface: one prefix route, internal routing table.
 *
 * Everything is JSON except the PDF byte stream (with Range support) and the
 * two SSE endpoints (job progress, model answers).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { PREFIX, ROUTE_PATH } from '../../shared/constants.js'
import type { HostApp } from '../app.js'
import { sendError } from './http.js'
import { registerAi } from './routes/ai.js'
import { registerAnnotations } from './routes/annotations.js'
import { registerAssets } from './routes/assets.js'
import { registerIngest } from './routes/ingest.js'
import { registerJobs } from './routes/jobs.js'
import { registerLibrary } from './routes/library.js'
import { registerRelations } from './routes/relations.js'
import { registerSearch } from './routes/search.js'
import { registerSettings } from './routes/settings.js'
import { registerTasks } from './routes/tasks.js'
import { registerTranslation } from './routes/translation.js'
import { registerUsage } from './routes/usage.js'
import type { Route } from './types.js'

export { ROUTE_PATH }

export interface HandlerOptions {
  workerPath?: string
  /** `dist/vendor`: static KaTeX CSS and fonts live here. */
  vendorPath?: string
}

export function createHandler(app: HostApp, { workerPath, vendorPath }: HandlerOptions = {}) {
  const routes: Route[] = []

  registerLibrary(routes, app)
  registerAnnotations(routes, app)
  registerIngest(routes, app)
  registerJobs(routes, app)
  registerSearch(routes, app)
  registerRelations(routes, app)
  registerSettings(routes, app)
  registerUsage(routes, app)
  registerTasks(routes, app)
  registerAi(routes, app)
  registerTranslation(routes, app)
  registerAssets(routes, app, { workerPath, vendorPath })

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const relative = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname.replace(/^\//, '')
    const method = (req.method ?? 'GET').toUpperCase()

    for (const [routeMethod, pattern, handler] of routes) {
      if (routeMethod !== method && !(routeMethod === 'GET' && method === 'HEAD')) continue
      const match = pattern.exec(relative)
      if (!match) continue
      try {
        await handler({ req, res, url }, match.slice(1).map((value) => decodeURIComponent(value ?? '')))
      } catch (error) {
        app.log(`route ${method} ${url.pathname} failed`, error)
        if (!res.headersSent) {
          sendError(res, error.status ?? 500, error.message ?? '内部错误', error.code ?? 'INTERNAL')
        } else {
          try {
            res.end()
          } catch {
            /* already closed */
          }
        }
      }
      return
    }
    sendError(res, 404, `没有这个接口：${method} ${url.pathname}`, 'NOT_FOUND')
  }
}
