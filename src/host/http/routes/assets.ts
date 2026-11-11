/** static worker / KaTeX assets and health check. */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { HostApp } from '../../app.js'
import { sendError, sendJson } from '../http.js'
import type { Route } from '../types.js'

const FONT_TYPE: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

export function registerAssets(
  routes: Route[],
  app: HostApp,
  { workerPath, vendorPath }: { workerPath?: string; vendorPath?: string } = {},
): void {
  routes.push(['GET', /^static\/pdf\.worker\.min\.mjs\/?$/, async (ctx) => {
    if (!workerPath) return sendError(ctx.res, 404, 'worker 缺失', 'NO_WORKER')
    try {
      const body = await fs.readFile(workerPath)
      ctx.res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400',
        'content-length': body.length,
      })
      ctx.res.end(body)
    } catch {
      sendError(ctx.res, 404, 'worker 缺失', 'NO_WORKER')
    }
  }])

  // KaTeX stylesheet: copied to `dist/vendor/katex/` by build/build.mjs.
  routes.push(['GET', /^static\/katex\/katex\.min\.css\/?$/, async (ctx) => {
    if (!vendorPath) return sendError(ctx.res, 404, 'KaTeX 样式缺失', 'NO_KATEX')
    try {
      const body = await fs.readFile(path.join(vendorPath, 'katex', 'katex.min.css'))
      ctx.res.writeHead(200, {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'public, max-age=86400',
        'content-length': body.length,
      })
      ctx.res.end(body)
    } catch {
      sendError(ctx.res, 404, 'KaTeX 样式缺失', 'NO_KATEX')
    }
  }])

  // KaTeX fonts, referenced by the stylesheet above.
  routes.push(['GET', /^static\/katex\/fonts\/([^/]+)\/?$/, async (ctx, [name]) => {
    if (!vendorPath || !/^[A-Za-z0-9_.-]+\.(?:woff2?|ttf)$/.test(name)) {
      return sendError(ctx.res, 404, 'KaTeX 字体缺失', 'NO_KATEX')
    }
    const type = FONT_TYPE[path.extname(name).toLowerCase()]
    if (!type) return sendError(ctx.res, 404, 'KaTeX 字体缺失', 'NO_KATEX')
    try {
      const body = await fs.readFile(path.join(vendorPath, 'katex', 'fonts', name))
      ctx.res.writeHead(200, {
        'content-type': type,
        'cache-control': 'public, max-age=86400',
        'content-length': body.length,
      })
      ctx.res.end(body)
    } catch {
      sendError(ctx.res, 404, 'KaTeX 字体缺失', 'NO_KATEX')
    }
  }])

  routes.push(['GET', /^health\/?$/, async (ctx) => {
    sendJson(ctx.res, 200, {
      ok: true,
      papers: app.store.activePapers().length,
      indexed: app.index.size,
      model: await app.summoner.target(),
      home: app.store.root,
    })
  }])
}
