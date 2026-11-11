/**
 * Dedicated machine-translation engines.
 *
 * These providers never see a prompt or a block id: the service sends plain
 * strings in reading order and maps the reply back by index. That is what makes
 * the "no model judgement" path possible for both full text and selections.
 */

import type { TranslationEngine } from './types.js'
import { TranslationEngineError, unavailableEngine } from './types.js'
import { decodeEntities, fetchJson } from './fetch.js'

interface DeepLOptions {
  apiKey: string
  baseUrl?: string
}

/** DeepL: up to 50 texts, 128 KiB request body. */
export function createDeepLEngine({ apiKey, baseUrl }: DeepLOptions): TranslationEngine {
  const key = apiKey.trim()
  const defaults = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const root = (baseUrl?.trim() || defaults).replace(/\/+$/, '')
  const url = `${root}/v2/translate`

  async function translateBatch(texts: string[], signal: AbortSignal): Promise<string[]> {
    const data = await fetchJson<{ translations?: Array<{ text?: unknown }> }>(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `DeepL-Auth-Key ${key}`,
        },
        body: JSON.stringify({ text: texts, target_lang: 'ZH', source_lang: 'EN' }),
      },
      { signal, timeoutMs: 90_000 },
      'DeepL',
    )
    const rows = data.translations ?? []
    if (rows.length !== texts.length) {
      throw new TranslationEngineError(
        `DeepL 返回 ${rows.length} 条，期望 ${texts.length} 条`,
        'TRANSLATION_BAD_RESPONSE',
      )
    }
    return rows.map((row) => String(row.text ?? ''))
  }

  return {
    id: 'deepl',
    label: 'api/deepl',
    mode: 'mt',
    billing: 'characters',
    limits: { concurrency: 2, batch: 50, charsPerItem: 8000, charsPerRequest: 100_000 },
    async available() {
      return key !== ''
    },
    reason: key === '' ? '还没有配置 DeepL API key' : undefined,
    translateBatch,
    async translate(text, signal) {
      return (await translateBatch([text], signal))[0] ?? ''
    },
  }
}

interface GoogleOptions {
  apiKey: string
  baseUrl?: string
}

/** Google Cloud Translation v2: up to 128 segments, 30k code points. */
export function createGoogleEngine({ apiKey, baseUrl }: GoogleOptions): TranslationEngine {
  const key = apiKey.trim()
  const root = (baseUrl?.trim() || 'https://translation.googleapis.com').replace(/\/+$/, '')
  const url = `${root}/language/translate/v2?key=${encodeURIComponent(key)}`

  async function translateBatch(texts: string[], signal: AbortSignal): Promise<string[]> {
    const data = await fetchJson<{
      data?: { translations?: Array<{ translatedText?: unknown }> }
      error?: { message?: string }
    }>(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, target: 'zh-CN', source: 'en', format: 'text' }),
      },
      { signal, timeoutMs: 60_000 },
      'Google Cloud Translation',
    )
    if (data.error?.message) {
      throw new TranslationEngineError(`Google 翻译失败：${data.error.message}`, 'TRANSLATION_PROVIDER')
    }
    const rows = data.data?.translations ?? []
    if (rows.length !== texts.length) {
      throw new TranslationEngineError(
        `Google 返回 ${rows.length} 条，期望 ${texts.length} 条`,
        'TRANSLATION_BAD_RESPONSE',
      )
    }
    return rows.map((row) => decodeEntities(String(row.translatedText ?? '')))
  }

  return {
    id: 'google',
    label: 'api/google',
    mode: 'mt',
    billing: 'characters',
    limits: { concurrency: 2, batch: 100, charsPerItem: 5000, charsPerRequest: 30_000 },
    async available() {
      return key !== ''
    },
    reason: key === '' ? '还没有配置 Google Cloud Translation API key' : undefined,
    translateBatch,
    async translate(text, signal) {
      return (await translateBatch([text], signal))[0] ?? ''
    },
  }
}

interface AzureOptions {
  apiKey: string
  region?: string
  baseUrl?: string
}

/** Azure Translator v3: up to 100 elements / 50k characters per request. */
export function createAzureEngine({ apiKey, region, baseUrl }: AzureOptions): TranslationEngine {
  const key = apiKey.trim()
  const area = (region ?? '').trim()
  const root = (baseUrl?.trim() || 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/, '')
  const url = `${root}/translate?api-version=3.0&from=en&to=zh-Hans`

  async function translateBatch(texts: string[], signal: AbortSignal): Promise<string[]> {
    const data = await fetchJson<Array<{ translations?: Array<{ text?: unknown }> }>>(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Ocp-Apim-Subscription-Key': key,
          ...(area ? { 'Ocp-Apim-Subscription-Region': area } : {}),
        },
        body: JSON.stringify(texts.map((text) => ({ Text: text }))),
      },
      { signal, timeoutMs: 60_000 },
      'Azure Translator',
    )
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new TranslationEngineError('Azure 返回条数与请求不一致', 'TRANSLATION_BAD_RESPONSE')
    }
    return data.map((row) => String(row.translations?.[0]?.text ?? ''))
  }

  return {
    id: 'azure',
    label: 'api/azure',
    mode: 'mt',
    billing: 'characters',
    limits: { concurrency: 2, batch: 100, charsPerItem: 5000, charsPerRequest: 50_000 },
    async available() {
      return key !== ''
    },
    reason: key === '' ? '还没有配置 Azure Translator key' : undefined,
    translateBatch,
    async translate(text, signal) {
      return (await translateBatch([text], signal))[0] ?? ''
    },
  }
}

interface LibreOptions {
  baseUrl: string
  apiKey?: string
  id?: string
  label?: string
  billing?: 'characters' | 'local'
}

/** LibreTranslate / Argos HTTP: `POST /translate` with a string array. */
export function createLibreEngine({
  baseUrl,
  apiKey,
  id = 'libretranslate',
  label = 'api/libretranslate',
  billing = 'characters',
}: LibreOptions): TranslationEngine {
  const root = baseUrl.trim().replace(/\/+$/, '')
  const key = (apiKey ?? '').trim()
  const url = `${root}/translate`

  async function translateBatch(texts: string[], signal: AbortSignal): Promise<string[]> {
    const data = await fetchJson<{ translatedText?: unknown; error?: unknown }>(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          q: texts,
          source: 'en',
          target: 'zh',
          format: 'text',
          ...(key ? { api_key: key } : {}),
        }),
      },
      { signal, timeoutMs: 90_000 },
      'LibreTranslate',
    )
    if (data.error) {
      throw new TranslationEngineError(
        `LibreTranslate 失败：${String(data.error)}`,
        'TRANSLATION_PROVIDER',
      )
    }
    const raw = data.translatedText
    const rows = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
    if (rows.length !== texts.length) {
      throw new TranslationEngineError(
        `LibreTranslate 返回 ${rows.length} 条，期望 ${texts.length} 条`,
        'TRANSLATION_BAD_RESPONSE',
      )
    }
    return rows.map((row) => String(row ?? ''))
  }

  return {
    id,
    label,
    mode: 'mt',
    billing,
    limits: { concurrency: 1, batch: 20, charsPerItem: 4000, charsPerRequest: 12_000 },
    async available() {
      return root !== ''
    },
    reason: root === '' ? '还没有填写 LibreTranslate 地址' : undefined,
    translateBatch,
    async translate(text, signal) {
      return (await translateBatch([text], signal))[0] ?? ''
    },
  }
}

/** The slice of the harness `translator` service this plugin relies on. */
export interface NativeTranslatorService {
  resolve(request: {
    text: string
    targetLanguage: string
    sourceLanguage?: string
    provider?: string
  }): unknown
  translate(spec: unknown, signal?: AbortSignal): Promise<string>
}

/**
 * The harness' own machine translation routes (Bing/Google), host-side and
 * free. One request per fragment, capped at 4000 characters by the service.
 */
export function createNativeEngine(
  service: NativeTranslatorService | undefined,
  provider: 'bing' | 'google',
): TranslationEngine {
  if (!service) {
    return unavailableEngine(
      `native-${provider}`,
      `native/${provider}`,
      'mt',
      'free',
      '当前运行时没有挂载 translator 服务',
    )
  }
  const label = `native/${provider}`
  const native = service

  async function translateOne(text: string, signal: AbortSignal): Promise<string> {
    const spec = native.resolve({
      text,
      targetLanguage: 'zh',
      sourceLanguage: 'en',
      provider,
    })
    return native.translate(spec, signal)
  }

  return {
    id: `native-${provider}`,
    label,
    mode: 'mt',
    billing: 'free',
    limits: { concurrency: 2, batch: 1, charsPerItem: 4000, charsPerRequest: 4000 },
    async available() {
      return true
    },
    async translateBatch(texts, signal) {
      const out: string[] = []
      for (const text of texts) out.push(await translateOne(text, signal))
      return out
    },
    async translate(text, signal) {
      return translateOne(text, signal)
    },
  }
}
