/** The internal routing table: one prefix route, many feature modules. */

import type { IncomingMessage, ServerResponse } from 'node:http'

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
}

export type RouteHandler = (ctx: RouteContext, params: string[]) => Promise<void> | void

/** `[method, pathPattern, handler]` — kept as a tuple so route tables stay compact. */
export type Route = [method: string, pattern: RegExp, handler: RouteHandler]
