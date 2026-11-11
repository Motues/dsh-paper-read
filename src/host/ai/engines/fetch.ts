/** HTTP helpers for the translation engines. */

import { TranslationEngineError } from './types.js'

export interface JsonRequestOptions {
  signal: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
}

export function failureMessage(status: number, body: string, label: string): string {
  const detail = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
  const suffix = detail ? `：${detail}` : ''
  if (status === 401 || status === 403) return `${label} 鉴权失败（${status}），请检查 API key${suffix}`
  if (status === 404) return `${label} 接口不存在（404），请检查 Base URL${suffix}`
  if (status === 429) return `${label} 请求过于频繁（429），请稍后重试${suffix}`
  if (status >= 500) return `${label} 服务端错误（${status}）${suffix}`
  return `${label} 请求失败（${status}）${suffix}`
}

export function failureCode(status: number): string {
  if (status === 401 || status === 403) return 'TRANSLATION_AUTH'
  if (status === 404) return 'TRANSLATION_ENDPOINT'
  if (status === 429) return 'TRANSLATION_RATE_LIMIT'
  if (status >= 500) return 'TRANSLATION_SERVER'
  return 'TRANSLATION_HTTP'
}

/** A timeout that still preserves the caller's abort reason. */
export function withTimeout(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { signal, dispose: () => {} }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(signal.reason)
  if (signal.aborted) controller.abort(signal.reason)
  else signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new TranslationEngineError('翻译请求超时', 'TRANSLATION_TIMEOUT'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    },
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: JsonRequestOptions,
  label: string,
): Promise<T> {
  const timeout = withTimeout(options.signal, options.timeoutMs ?? 60_000)
  try {
    const response = await fetch(url, {
      ...init,
      signal: timeout.signal,
      cache: 'no-store',
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(options.headers ?? {}),
      },
    })
    const body = await response.text()
    if (!response.ok) {
      throw new TranslationEngineError(
        failureMessage(response.status, body, label),
        failureCode(response.status),
        response.status,
      )
    }
    try {
      return JSON.parse(body) as T
    } catch {
      throw new TranslationEngineError(`${label} 返回了非 JSON 内容`, 'TRANSLATION_BAD_RESPONSE')
    }
  } catch (error) {
    if (error instanceof TranslationEngineError) throw error
    if (timeout.signal.aborted) {
      const reason = timeout.signal.reason
      if (reason instanceof TranslationEngineError) throw reason
      throw new TranslationEngineError('翻译请求已取消', 'TRANSLATION_ABORTED')
    }
    throw new TranslationEngineError(
      `${label} 网络请求失败：${(error as Error)?.message ?? error}`,
      'TRANSLATION_TRANSPORT',
    )
  } finally {
    timeout.dispose()
  }
}

/** Decode the entities Google's `format=text` reply still carries. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}
