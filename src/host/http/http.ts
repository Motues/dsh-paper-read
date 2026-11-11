/** HTTP primitives: JSON replies, body parsing, SSE, byte streams. */

import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type ResponseHeaders = Record<string, string | number>

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: ResponseHeaders = {},
): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(text)
}

export function sendError(
  res: ServerResponse,
  status: number,
  message: string,
  code = 'ERROR',
): void {
  sendJson(res, status, { error: { code, message } })
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413 })
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** JSON bodies are untyped on purpose: every route validates its own fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(req: IncomingMessage, limit = 2 * 1024 * 1024): Promise<any> {
  const body = await readBody(req, limit)
  if (body.length === 0) return {}
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 })
  }
}

export interface SseStream {
  send(payload: unknown): void
  comment(text: string): void
  end(): void
  readonly closed: boolean
}

export function openSse(_req: IncomingMessage, res: ServerResponse): SseStream {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(': ok\n\n')
  let closed = false
  return {
    send(payload) {
      if (closed) return
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    },
    comment(text) {
      if (closed) return
      res.write(`: ${text}\n\n`)
    },
    end() {
      if (closed) return
      closed = true
      res.end()
    },
    get closed() {
      return closed
    },
  }
}

export function safeName(name: unknown): string {
  const base = path.basename(String(name ?? 'paper.pdf')).replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  const stem = base.replace(/\.pdf$/i, '')
  // Truncate the stem, never the extension: slicing the whole name once turned
  // "...sensor arrays.pdf" into a file literally ending in ".pd".
  const cleaned = `${stem.slice(0, 100).trim() || `paper-${Date.now()}`}.pdf`
  return cleaned
}

/** Stream a file, closing the response instead of throwing if the read fails. */
export function pipeFile(
  filePath: string,
  res: ServerResponse,
  range?: { start: number; end: number },
): void {
  const stream = createReadStream(filePath, range)
  stream.on('error', () => {
    try {
      res.end()
    } catch {
      /* already gone */
    }
  })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}
