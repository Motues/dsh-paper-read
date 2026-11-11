/**
 * OpenAI-compatible chat engines: online API and local runtimes (Ollama,
 * LM Studio, llama.cpp, vLLM) all speak the same `/chat/completions` protocol.
 *
 * The pipeline above only needs streamed text; the JSONL protocol stays in
 * `translate.ts` so this module is also usable by the selection bubble.
 */

import type { TranslationBilling } from '../../../shared/domain.js'
import type { TranslationEngine } from './types.js'
import { TranslationEngineError } from './types.js'
import { failureCode, failureMessage, withTimeout } from './fetch.js'

export interface OpenAiEngineOptions {
  id: string
  label: string
  baseUrl: string
  model: string
  apiKey?: string
  concurrency: number
  maxTokens: number
  billing?: TranslationBilling
  /** Online APIs normally need a key; local OpenAI-compatible servers may not. */
  requireKey?: boolean
  /** Overall deadline for one request. Local models can be slow. */
  timeoutMs?: number
}

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** The base URL that already names an API version, or one with `/v1` added. */
function apiRoot(baseUrl: string): string {
  let base = trimBase(baseUrl).replace(/\/chat\/completions$/i, '')
  if (/\/v\d/i.test(base)) return base
  base = `${base}/v1`
  return base
}

export function openAiChatUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/chat/completions`
}

export function openAiModelsUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/models`
}

function headersFor(apiKey: string | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    let out = ''
    for (const part of value) {
      if (part && typeof part === 'object') {
        const record = part as { text?: unknown; content?: unknown }
        if (typeof record.text === 'string') out += record.text
        else if (typeof record.content === 'string') out += record.content
      }
    }
    return out
  }
  return ''
}

/** Parse either an SSE reply or a provider that ignored `stream: true`. */
async function* readChatReply(response: Response): AsyncGenerator<string> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('text/event-stream')) {
    const body = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new TranslationEngineError('模型返回了非 JSON 内容', 'TRANSLATION_BAD_RESPONSE')
    }
    const record = parsed as {
      error?: { message?: string }
      choices?: Array<{ message?: { content?: unknown } }>
    }
    if (record?.error) {
      throw new TranslationEngineError(`模型调用失败：${record.error.message ?? '未知错误'}`, 'TRANSLATION_PROVIDER')
    }
    const text = contentText(record?.choices?.[0]?.message?.content)
    if (text) yield text
    return
  }

  if (!response.body) throw new TranslationEngineError('模型响应为空', 'TRANSLATION_BAD_RESPONSE')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '' || data === '[DONE]') {
          if (data === '[DONE]') return
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        const record = parsed as {
          error?: { message?: string }
          choices?: Array<{
            delta?: { content?: unknown }
            message?: { content?: unknown }
          }>
        }
        if (record?.error) {
          throw new TranslationEngineError(
            `模型调用失败：${record.error.message ?? '未知错误'}`,
            'TRANSLATION_PROVIDER',
          )
        }
        const choice = record?.choices?.[0]
        const text = contentText(choice?.delta?.content ?? choice?.message?.content)
        if (text) yield text
      }
    }
    // Some providers finish without a trailing newline; try the last line too.
    const tail = buffer.trim()
    if (tail.startsWith('data:')) {
      const data = tail.slice(5).trim()
      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> }
          const text = contentText(parsed?.choices?.[0]?.delta?.content)
          if (text) yield text
        } catch {
          /* ignore a malformed tail */
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function streamOpenAiChat(options: {
  baseUrl: string
  apiKey?: string
  model: string
  system?: string
  user: string
  temperature?: number
  maxTokens?: number
  signal: AbortSignal
  timeoutMs?: number
}): AsyncGenerator<string> {
  return (async function* generate(): AsyncGenerator<string> {
    const timeout = withTimeout(options.signal, options.timeoutMs ?? 180_000)
    try {
      const response = await fetch(openAiChatUrl(options.baseUrl), {
        method: 'POST',
        signal: timeout.signal,
        headers: headersFor(options.apiKey),
        body: JSON.stringify({
          model: options.model,
          messages: [
            ...(options.system ? [{ role: 'system', content: options.system }] : []),
            { role: 'user', content: options.user },
          ],
          temperature: options.temperature ?? 0,
          max_tokens: options.maxTokens ?? 2048,
          stream: true,
        }),
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new TranslationEngineError(
          failureMessage(response.status, body, '模型接口'),
          failureCode(response.status),
          response.status,
        )
      }
      yield* readChatReply(response)
    } catch (error) {
      if (error instanceof TranslationEngineError) throw error
      if (timeout.signal.aborted) {
        const reason = timeout.signal.reason
        if (reason instanceof TranslationEngineError) throw reason
        throw new TranslationEngineError('翻译请求已取消', 'TRANSLATION_ABORTED')
      }
      throw new TranslationEngineError(
        `模型网络请求失败：${(error as Error)?.message ?? error}`,
        'TRANSLATION_TRANSPORT',
      )
    } finally {
      timeout.dispose()
    }
  })()
}

export function createOpenAiEngine(options: OpenAiEngineOptions): TranslationEngine {
  const baseUrl = options.baseUrl.trim()
  const model = options.model.trim()
  return {
    id: options.id,
    label: options.label,
    mode: 'llm',
    billing: options.billing ?? 'tokens',
    plainFallback: true,
    limits: {
      concurrency: Math.max(1, Math.min(4, options.concurrency)),
      batch: 40,
      charsPerItem: 6000,
      charsPerRequest: 12_000,
    },
    async available() {
      return Boolean(baseUrl && model && (!options.requireKey || options.apiKey))
    },
    reason: !baseUrl
      ? '还没有填写 Base URL'
      : !model
        ? '还没有选择模型'
        : options.requireKey && !options.apiKey
          ? '还没有配置 API key'
          : undefined,
    async *stream({ system, user, maxTokens, signal }) {
      if (!baseUrl || !model) {
        throw new TranslationEngineError('请先填写 Base URL 与模型', 'TRANSLATION_CONFIG')
      }
      yield* streamOpenAiChat({
        baseUrl,
        model,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(system ? { system } : {}),
        user,
        maxTokens: maxTokens ?? options.maxTokens,
        signal,
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      })
    },
  }
}

/** Model discovery for the settings page. */
export async function listOpenAiModels(
  baseUrl: string,
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<Array<{ id: string; name: string }>> {
  const timeout = withTimeout(signal, 15_000)
  try {
    const response = await fetch(openAiModelsUrl(baseUrl), {
      method: 'GET',
      signal: timeout.signal,
      headers: headersFor(apiKey),
    })
    const body = await response.text()
    if (!response.ok) {
      throw new TranslationEngineError(
        failureMessage(response.status, body, '模型列表'),
        failureCode(response.status),
        response.status,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new TranslationEngineError('模型列表不是 JSON', 'TRANSLATION_BAD_RESPONSE')
    }
    const rows = (parsed as { data?: unknown })?.data
    if (!Array.isArray(rows)) return []
    const models: Array<{ id: string; name: string }> = []
    for (const row of rows) {
      if (typeof row === 'string') {
        models.push({ id: row, name: row })
        continue
      }
      if (!row || typeof row !== 'object') continue
      const record = row as { id?: unknown; name?: unknown }
      if (typeof record.id !== 'string' || record.id === '') continue
      models.push({ id: record.id, name: typeof record.name === 'string' ? record.name : record.id })
    }
    return models
  } catch (error) {
    if (error instanceof TranslationEngineError) throw error
    if (timeout.signal.aborted) throw new TranslationEngineError('模型列表请求超时', 'TRANSLATION_TIMEOUT')
    throw new TranslationEngineError(
      `模型列表请求失败：${(error as Error)?.message ?? error}`,
      'TRANSLATION_TRANSPORT',
    )
  } finally {
    timeout.dispose()
  }
}
