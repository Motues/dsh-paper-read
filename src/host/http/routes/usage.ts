/** Daily token ledger projection for the settings page. */

import type { HostApp } from '../../app.js'
import { sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerUsage(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^usage\/?$/, async (ctx) => {
    const from = ctx.url.searchParams.get('from')
    const to = ctx.url.searchParams.get('to')
    sendJson(ctx.res, 200, app.usage.snapshot(from, to))
  }])
}
