/** Resolve the configured source into a concrete engine, plus key/model helpers. */

import type { AppConfig, TranslationApiKind, TranslationModelList, TranslationSource } from '../../../shared/domain.js'
import {
  normalizeTranslationSettings,
  translationEngineLabel,
  TRANSLATION_KEY_REFS,
  type TranslationKeyProvider,
} from '../../../shared/translation.js'
import type { Summoner } from '../summoner.js'
import { createDshEngine } from './dsh.js'
import { createLibreEngine, createNativeEngine, createDeepLEngine, createGoogleEngine, createAzureEngine, type NativeTranslatorService } from './mt.js'
import { createOpenAiEngine, listOpenAiModels } from './openai.js'
import { TranslationEngineError, unavailableEngine, type TranslationEngine } from './types.js'

/** The slice of `ctx.credentials` this plugin uses. Refs are plain strings. */
export interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

export interface EngineRegistry {
  resolve(source: TranslationSource): Promise<TranslationEngine>
  keys(): Promise<Partial<Record<TranslationApiKind | 'local', boolean>>>
  setKey(provider: TranslationKeyProvider, value: string): Promise<void>
  models(target: 'api' | 'local'): Promise<TranslationModelList>
}

export interface EngineRegistryOptions {
  summoner: Summoner
  config: () => AppConfig
  getCredentials: () => CredentialsLike | undefined
  getTranslator: () => NativeTranslatorService | undefined
  log: (message: string, error?: unknown) => void
}

const KEY_PROVIDERS: TranslationKeyProvider[] = ['openai', 'deepl', 'google', 'azure', 'libretranslate', 'local']

async function readKey(getCredentials: () => CredentialsLike | undefined, provider: TranslationKeyProvider): Promise<string> {
  const service = getCredentials()
  if (!service) return ''
  try {
    const resolved = await service.resolve(TRANSLATION_KEY_REFS[provider])
    return resolved?.value?.trim() ?? ''
  } catch {
    return ''
  }
}

export function createEngineRegistry({
  summoner,
  config,
  getCredentials,
  getTranslator,
  log,
}: EngineRegistryOptions): EngineRegistry {
  async function keys(): Promise<Partial<Record<TranslationApiKind | 'local', boolean>>> {
    const service = getCredentials()
    const out: Partial<Record<TranslationApiKind | 'local', boolean>> = {}
    for (const provider of KEY_PROVIDERS) {
      if (!service) {
        out[provider] = false
        continue
      }
      try {
        out[provider] = (await service.describe(TRANSLATION_KEY_REFS[provider])).configured
      } catch {
        out[provider] = false
      }
    }
    return out
  }

  async function setKey(provider: TranslationKeyProvider, value: string): Promise<void> {
    if (!KEY_PROVIDERS.includes(provider)) {
      throw new TranslationEngineError('未知的密钥类型', 'BAD_REQUEST', 400)
    }
    const service = getCredentials()
    if (!service) {
      throw new TranslationEngineError('当前运行时没有凭据服务，无法保存 API key', 'CREDENTIALS_UNAVAILABLE', 503)
    }
    const ref = TRANSLATION_KEY_REFS[provider]
    if (value.trim() === '') {
      await service.unset(ref)
      return
    }
    await service.set(ref, value.trim())
  }

  async function resolve(source: TranslationSource): Promise<TranslationEngine> {
    const settings = normalizeTranslationSettings(config().translation)
    const active = source

    if (active === 'dsh') {
      const engine = createDshEngine(summoner)
      try {
        const target = await summoner.target()
        if (target) engine.label = `${target.provider}/${target.model}`
      } catch (error) {
        log('translation route resolution failed', error)
      }
      return engine
    }

    if (active === 'browser') {
      return {
        id: 'browser',
        label: translationEngineLabel({ ...settings, source: 'browser' }),
        mode: 'mt',
        billing: 'free',
        external: true,
        limits: { concurrency: 1, batch: 1, charsPerItem: 1800, charsPerRequest: 1800 },
        async available() {
          return true
        },
      }
    }

    if (active === 'native') {
      return createNativeEngine(getTranslator(), settings.native.provider)
    }

    if (active === 'local') {
      if (settings.local.kind === 'libretranslate') {
        return createLibreEngine({
          baseUrl: settings.local.baseUrl,
          apiKey: await readKey(getCredentials, 'libretranslate'),
          id: 'local-libretranslate',
          label: 'local/libretranslate',
          billing: 'local',
        })
      }
      const apiKey = await readKey(getCredentials, 'local')
      return createOpenAiEngine({
        id: 'local-llm',
        label: translationEngineLabel(settings),
        baseUrl: settings.local.baseUrl,
        model: settings.local.model,
        ...(apiKey ? { apiKey } : {}),
        concurrency: settings.local.concurrency,
        maxTokens: settings.local.maxTokens,
        billing: 'local',
        timeoutMs: 300_000,
      })
    }

    // active === 'api'
    switch (settings.api.kind) {
      case 'deepl':
        return createDeepLEngine({
          apiKey: await readKey(getCredentials, 'deepl'),
          ...(settings.api.baseUrl ? { baseUrl: settings.api.baseUrl } : {}),
        })
      case 'google':
        return createGoogleEngine({
          apiKey: await readKey(getCredentials, 'google'),
          ...(settings.api.baseUrl ? { baseUrl: settings.api.baseUrl } : {}),
        })
      case 'azure':
        return createAzureEngine({
          apiKey: await readKey(getCredentials, 'azure'),
          ...(settings.api.region ? { region: settings.api.region } : {}),
          ...(settings.api.baseUrl ? { baseUrl: settings.api.baseUrl } : {}),
        })
      case 'libretranslate':
        return createLibreEngine({
          baseUrl: settings.api.baseUrl || 'http://127.0.0.1:5000',
          apiKey: await readKey(getCredentials, 'libretranslate'),
        })
      case 'openai':
      default: {
        const apiKey = await readKey(getCredentials, 'openai')
        return createOpenAiEngine({
          id: 'api-openai',
          label: translationEngineLabel({ ...settings, source: 'api', api: { ...settings.api, kind: 'openai' } }),
          baseUrl: settings.api.baseUrl,
          model: settings.api.model,
          ...(apiKey ? { apiKey } : {}),
          concurrency: 2,
          maxTokens: 2048,
          billing: 'tokens',
          requireKey: true,
        })
      }
    }
  }

  async function models(target: 'api' | 'local'): Promise<TranslationModelList> {
    const settings = normalizeTranslationSettings(config().translation)
    if (target === 'local') {
      if (settings.local.kind !== 'llm') {
        throw new TranslationEngineError('当前本地来源不是 OpenAI 兼容模型', 'BAD_REQUEST', 400)
      }
      if (!settings.local.baseUrl) {
        throw new TranslationEngineError('请先填写本地 Base URL', 'TRANSLATION_CONFIG', 400)
      }
      const apiKey = await readKey(getCredentials, 'local')
      return { models: await listOpenAiModels(settings.local.baseUrl, apiKey || undefined, AbortSignal.timeout(20_000)) }
    }
    if (settings.api.kind !== 'openai') {
      throw new TranslationEngineError('只有 OpenAI 兼容来源支持模型列表', 'BAD_REQUEST', 400)
    }
    if (!settings.api.baseUrl) {
      throw new TranslationEngineError('请先填写 API Base URL', 'TRANSLATION_CONFIG', 400)
    }
    const apiKey = await readKey(getCredentials, 'openai')
    return { models: await listOpenAiModels(settings.api.baseUrl, apiKey || undefined, AbortSignal.timeout(20_000)) }
  }

  return { resolve, keys, setKey, models }
}

/** A registry that only knows the harness model, used by unit tests. */
export function createDshOnlyRegistry(summoner: Summoner): EngineRegistry {
  return {
    async resolve(source) {
      if (source !== 'dsh') {
        return unavailableEngine(source, source, 'mt', 'free', '测试环境只提供 DSH 模型')
      }
      return createDshEngine(summoner)
    },
    async keys() {
      return {}
    },
    async setKey() {
      throw new TranslationEngineError('测试环境没有凭据服务', 'CREDENTIALS_UNAVAILABLE', 503)
    },
    async models() {
      return { models: [] }
    },
  }
}
