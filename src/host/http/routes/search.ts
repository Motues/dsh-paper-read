/** Cross-library search. */

import type { HostApp } from '../../app.js'
import { searchLibraryPapers } from '../../search/papers.js'
import { readJson, sendJson } from '../http.js'
import type { Route } from '../types.js'

export function registerSearch(routes: Route[], app: HostApp): void {
  // Paper-level library search: metadata + notes + full text, no model call.
  routes.push(['GET', /^search\/papers\/?$/, async (ctx) => {
    const query = ctx.url.searchParams.get('q') ?? ''
    const limit = Number(ctx.url.searchParams.get('limit')) || 200
    sendJson(ctx.res, 200, await searchLibraryPapers({
      store: app.store,
      indexer: app.indexer,
      query,
      limit,
    }))
  }])

  routes.push(['POST', /^search\/?$/, async (ctx) => {
    const body = await readJson(ctx.req)
    const query = String(body.query ?? '')
    if (query.trim().length === 0) return sendJson(ctx.res, 200, { query: '', hits: [], reranked: false })
    const result = await app.searchLibrary({
      query,
      limit: Number(body.limit) || 6,
      rerank: body.rerank !== false,
    })
    sendJson(ctx.res, 200, result)
  }])
}
