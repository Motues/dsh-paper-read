/**
 * Translation source contract shared by the host and the browser half.
 *
 * The host owns the actual engines; this module only holds the durable shape,
 * the defaults, and the two decisions both halves must agree on: which source
 * is effective (the experimental switch can force the default) and whether the
 * AI master switch is allowed to stop it.
 */

import type {
  AppConfig,
  TranslationApiKind,
  TranslationBilling,
  TranslationLocalKind,
  TranslationMode,
  TranslationNativeProvider,
  TranslationSettings,
  TranslationSource,
} from './domain.js'

export const TRANSLATION_TARGET_LANG = 'zh'

export const TRANSLATION_SOURCES: TranslationSource[] = ['dsh', 'local', 'api', 'browser', 'native']

export const TRANSLATION_API_KINDS: TranslationApiKind[] = ['openai', 'deepl', 'google', 'azure', 'libretranslate']

export const TRANSLATION_LOCAL_KINDS: TranslationLocalKind[] = ['llm', 'libretranslate']

export const TRANSLATION_NATIVE_PROVIDERS: TranslationNativeProvider[] = ['bing', 'google']

export const TRANSLATION_SOURCE_LABELS: Record<TranslationSource, string> = {
  dsh: 'DSH 模型',
  local: '本地',
  api: 'API',
  browser: '浏览器内置',
  native: '在线机器翻译',
}

export const TRANSLATION_API_LABELS: Record<TranslationApiKind, string> = {
  openai: 'OpenAI 兼容',
  deepl: 'DeepL',
  google: 'Google Cloud Translation',
  azure: 'Microsoft Azure Translator',
  libretranslate: 'LibreTranslate',
}

export const TRANSLATION_LOCAL_LABELS: Record<TranslationLocalKind, string> = {
  llm: '本地大模型（Ollama / LM Studio / llama.cpp）',
  libretranslate: '本地翻译服务（LibreTranslate / Argos）',
}

export const TRANSLATION_NATIVE_LABELS: Record<TranslationNativeProvider, string> = {
  bing: 'Bing',
  google: 'Google',
}

/**
 * Default API base URLs. OpenAI-compatible and Azure endpoints are intentionally
 * blank: guessing a paid provider would silently send paper text somewhere the
 * user did not choose.
 */
export const TRANSLATION_API_BASE_URLS: Record<TranslationApiKind, string> = {
  openai: '',
  deepl: '',
  google: '',
  azure: '',
  libretranslate: 'http://127.0.0.1:5000',
}

export const TRANSLATION_LOCAL_BASE_URLS: Record<TranslationLocalKind, string> = {
  llm: 'http://127.0.0.1:11434/v1',
  libretranslate: 'http://127.0.0.1:5000',
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  source: 'dsh',
  local: {
    kind: 'llm',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: '',
    concurrency: 1,
    maxTokens: 2048,
  },
  api: {
    kind: 'openai',
    baseUrl: '',
    model: '',
    region: '',
  },
  browser: { sourceLanguage: 'en' },
  native: { provider: 'bing' },
}

const MAX_BASE_URL = 500
const MAX_MODEL = 200
const MAX_REGION = 80
const MAX_LANGUAGE = 24

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

/** Repair config written by an older version or edited by hand. */
export function normalizeTranslationSettings(value: unknown): TranslationSettings {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const local = (source.local && typeof source.local === 'object' ? source.local : {}) as Record<string, unknown>
  const api = (source.api && typeof source.api === 'object' ? source.api : {}) as Record<string, unknown>
  const browser = (source.browser && typeof source.browser === 'object' ? source.browser : {}) as Record<string, unknown>
  const native = (source.native && typeof source.native === 'object' ? source.native : {}) as Record<string, unknown>
  const localKind = pick(local.kind, TRANSLATION_LOCAL_KINDS, 'llm')
  const apiKind = pick(api.kind, TRANSLATION_API_KINDS, 'openai')

  return {
    source: pick(source.source, TRANSLATION_SOURCES, 'dsh'),
    local: {
      kind: localKind,
      // An absent/blank local URL means the standard local endpoint; this is
      // what makes a fresh config usable without the user hunting for a port.
      baseUrl: text(local.baseUrl, MAX_BASE_URL) || TRANSLATION_LOCAL_BASE_URLS[localKind],
      model: text(local.model, MAX_MODEL),
      concurrency: clampInt(local.concurrency, 1, 4, 1),
      maxTokens: clampInt(local.maxTokens, 256, 8192, 2048),
    },
    api: {
      kind: apiKind,
      baseUrl: text(api.baseUrl, MAX_BASE_URL)
        || (apiKind === 'libretranslate' ? TRANSLATION_API_BASE_URLS.libretranslate : ''),
      model: text(api.model, MAX_MODEL),
      region: text(api.region, MAX_REGION),
    },
    browser: {
      // BCP-47-ish tags only; a free-form value would make availability() throw.
      sourceLanguage: text(browser.sourceLanguage, MAX_LANGUAGE).toLowerCase() || 'en',
    },
    native: {
      provider: pick(native.provider, TRANSLATION_NATIVE_PROVIDERS, 'bing'),
    },
  }
}

/** Which source a run would use right now. */
export function effectiveTranslationSource(
  config: Pick<AppConfig, 'experimentalTranslationSources' | 'translation'>,
): TranslationSource {
  if (config.experimentalTranslationSources !== true) return 'dsh'
  return config.translation?.source ?? 'dsh'
}

/** The engine family, independent of the concrete provider. */
export function translationMode(settings: TranslationSettings): TranslationMode {
  if (settings.source === 'browser' || settings.source === 'native') return 'mt'
  if (settings.source === 'local') return settings.local.kind === 'llm' ? 'llm' : 'mt'
  if (settings.source === 'api') return settings.api.kind === 'openai' ? 'llm' : 'mt'
  return 'llm'
}

export function translationBilling(settings: TranslationSettings): TranslationBilling {
  if (settings.source === 'dsh') return 'dsh'
  if (settings.source === 'local') return 'local'
  if (settings.source === 'browser' || settings.source === 'native') return 'free'
  return settings.api.kind === 'openai' ? 'tokens' : 'characters'
}

/**
 * Whether the AI master switch allows this source.
 *
 * The switch exists to stop harness-model token spend. A local model, the
 * browser translator, the harness' free machine-translation endpoints and
 * character-billed translation APIs do not spend tokens, so they keep working.
 */
export function translationAllowed(
  aiEnabled: boolean,
  settings: TranslationSettings,
): boolean {
  if (aiEnabled) return true
  const billing = translationBilling(settings)
  return billing !== 'dsh' && billing !== 'tokens'
}

/** Stable engine label stored on cached pages, e.g. `api/deepl` or `local/llm/qwen`. */
export function translationEngineLabel(
  settings: TranslationSettings,
  dshLabel = 'dsh',
): string {
  switch (settings.source) {
    case 'dsh':
      return dshLabel || 'dsh'
    case 'local':
      return settings.local.kind === 'llm'
        ? `local/llm/${settings.local.model || '未选择'}`
        : 'local/libretranslate'
    case 'api':
      return settings.api.kind === 'openai'
        ? `api/openai/${settings.api.model || '未选择'}`
        : `api/${settings.api.kind}`
    case 'browser':
      return `browser/${settings.browser.sourceLanguage}-${TRANSLATION_TARGET_LANG}`
    case 'native':
      return `native/${settings.native.provider}`
    default:
      return 'dsh'
  }
}

/** Human label for the current selection, used by the settings and the reader. */
export function translationSourceLabel(settings: TranslationSettings): string {
  switch (settings.source) {
    case 'dsh':
      return TRANSLATION_SOURCE_LABELS.dsh
    case 'local':
      return TRANSLATION_LOCAL_LABELS[settings.local.kind]
    case 'api':
      return TRANSLATION_API_LABELS[settings.api.kind]
    case 'browser':
      return `${TRANSLATION_SOURCE_LABELS.browser} · ${settings.browser.sourceLanguage} → ${TRANSLATION_TARGET_LANG}`
    case 'native':
      return `${TRANSLATION_SOURCE_LABELS.native} · ${TRANSLATION_NATIVE_LABELS[settings.native.provider]}`
    default:
      return TRANSLATION_SOURCE_LABELS.dsh
  }
}

/** API key refs live in the harness credential store, never in config.json. */
export const TRANSLATION_KEY_REFS = {
  openai: 'PAPERREADER_TRANSLATION_OPENAI_KEY',
  deepl: 'PAPERREADER_TRANSLATION_DEEPL_KEY',
  google: 'PAPERREADER_TRANSLATION_GOOGLE_KEY',
  azure: 'PAPERREADER_TRANSLATION_AZURE_KEY',
  libretranslate: 'PAPERREADER_TRANSLATION_LIBRETRANSLATE_KEY',
  local: 'PAPERREADER_TRANSLATION_LOCAL_KEY',
} as const

export type TranslationKeyProvider = keyof typeof TRANSLATION_KEY_REFS
