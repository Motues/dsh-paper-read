/**
 * Browser built-in Translator (Chrome 138+ / Edge).
 *
 * Two realities shape this module:
 *  - The desktop shell is Electron, where `Translator` may exist but never
 *    resolves. We refuse early on the Electron UA instead of hanging a run.
 *  - The model has no prompt and no block ids, so formulas are protected as
 *    `⟦n⟧` placeholders by the caller and translated pieces are joined back
 *    before the host validates and restores them.
 */

import { protectMath, restoreMath, splitProtected } from '../../shared/math.js'

export type BrowserTranslationReason =
  | 'electron'
  | 'missing'
  | 'insecure'
  | 'timeout'
  | 'unavailable'
  | 'error'
  | 'aborted'

export interface BrowserTranslatorSupport {
  supported: boolean
  reason?: BrowserTranslationReason
  detail?: string
  availability?: 'available' | 'downloadable' | 'downloading' | 'unavailable'
}

export interface BrowserTranslatorOptions {
  sourceLanguage: string
  targetLanguage?: string
  signal?: AbortSignal
  charsPerItem?: number
  onDownload?: (progress: { loaded: number; total: number; percent: number }) => void
}

interface BrowserTranslatorSession {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>
  destroy?(): void
}

interface TranslatorConstructor {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(options: {
    sourceLanguage: string
    targetLanguage: string
    signal?: AbortSignal
    monitor?: (monitor: EventTarget) => void
  }): Promise<BrowserTranslatorSession>
}

export class BrowserTranslationError extends Error {
  reason: BrowserTranslationReason
  constructor(message: string, reason: BrowserTranslationReason = 'error') {
    super(message)
    this.name = 'BrowserTranslationError'
    this.reason = reason
  }
}

function translatorConstructor(): TranslatorConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  const ctor = (window as unknown as { Translator?: TranslatorConstructor }).Translator
  return typeof ctor?.create === 'function' ? ctor : undefined
}

/** Cheap, synchronous capability check that never calls into the model. */
export function detectBrowserTranslator(): BrowserTranslatorSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reason: 'missing', detail: '当前环境没有浏览器页面' }
  }
  if (
    navigator.userAgent.includes('Electron/')
    || Boolean((globalThis as { process?: { versions?: { electron?: string } } }).process?.versions?.electron)
  ) {
    return {
      supported: false,
      reason: 'electron',
      detail: 'DSH 桌面窗口是 Electron，浏览器内置翻译模型不可用；请用 Chrome/Edge 打开同一地址。',
    }
  }
  if (!translatorConstructor()) {
    return {
      supported: false,
      reason: 'missing',
      detail: '当前浏览器没有 Translator API；需要 Chrome 138+ 或较新的 Edge。',
    }
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'insecure',
      detail: '浏览器翻译需要安全上下文（HTTPS 或 127.0.0.1）。',
    }
  }
  return { supported: true }
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BrowserTranslationError('浏览器翻译模型没有响应', 'timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Ask the browser whether the language pack is available; never hangs the UI. */
export async function checkBrowserTranslator(
  sourceLanguage: string,
  targetLanguage = 'zh',
): Promise<BrowserTranslatorSupport> {
  const support = detectBrowserTranslator()
  if (!support.supported) return support
  const ctor = translatorConstructor()
  if (!ctor) return support
  try {
    const availability = await timeout(
      ctor.availability({ sourceLanguage, targetLanguage }),
      2500,
    )
    if (availability === 'unavailable') {
      return {
        supported: false,
        reason: 'unavailable',
        detail: `浏览器没有 ${sourceLanguage} → ${targetLanguage} 的翻译模型`,
        availability,
      }
    }
    return {
      supported: true,
      availability: availability as BrowserTranslatorSupport['availability'],
    }
  } catch (error) {
    if (error instanceof BrowserTranslationError) {
      return { supported: false, reason: error.reason, detail: error.message }
    }
    return {
      supported: false,
      reason: 'error',
      detail: `浏览器翻译检测失败：${(error as Error)?.message ?? error}`,
    }
  }
}

let cached: { key: string; session: BrowserTranslatorSession } | null = null
let pending: { key: string; promise: Promise<BrowserTranslatorSession> } | null = null

function sessionKey(sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage}>${targetLanguage}`
}

async function createSession(options: BrowserTranslatorOptions): Promise<BrowserTranslatorSession> {
  const ctor = translatorConstructor()
  if (!ctor) throw new BrowserTranslationError('当前浏览器没有 Translator API', 'missing')
  const targetLanguage = options.targetLanguage ?? 'zh'
  const session = await timeout(ctor.create({
    sourceLanguage: options.sourceLanguage,
    targetLanguage,
    ...(options.signal ? { signal: options.signal } : {}),
    monitor: (monitor) => {
      monitor.addEventListener('downloadprogress', (event) => {
        const detail = event as unknown as { loaded?: number; total?: number }
        const loaded = Number(detail.loaded ?? 0)
        const total = Number(detail.total ?? 0)
        options.onDownload?.({
          loaded,
          total,
          percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
        })
      })
    },
  }), 300_000)
  return session
}

export async function getBrowserSession(options: BrowserTranslatorOptions): Promise<BrowserTranslatorSession> {
  const targetLanguage = options.targetLanguage ?? 'zh'
  const key = sessionKey(options.sourceLanguage, targetLanguage)
  if (cached?.key === key) return cached.session
  if (pending?.key === key) return pending.promise
  cached?.session.destroy?.()
  cached = null
  const promise = createSession(options)
    .then((session) => {
      cached = { key, session }
      return session
    })
    .finally(() => {
      if (pending?.key === key) pending = null
    })
  pending = { key, promise }
  return promise
}

export function destroyBrowserSession(): void {
  cached?.session.destroy?.()
  cached = null
  pending = null
}

function translateMessage(error: unknown): string {
  const name = (error as { name?: string })?.name ?? ''
  if (name === 'AbortError') return '已取消'
  if (name === 'NotAllowedError') return '浏览器要求点击按钮下载语言包，请再点一次「翻译全文」或「测试当前来源」'
  if (name === 'UnknownError') return '浏览器翻译模型不可用（可能尚未下载）'
  return `浏览器翻译失败：${(error as Error)?.message ?? error}`
}

/** Translate one block, returning `⟦n⟧` placeholders still in place. */
export async function translateBrowserBlock(
  text: string,
  options: BrowserTranslatorOptions,
): Promise<string> {
  const support = detectBrowserTranslator()
  if (!support.supported) {
    throw new BrowserTranslationError(support.detail ?? '当前浏览器不支持内置翻译', support.reason ?? 'missing')
  }
  const session = await getBrowserSession(options)
  const protectedText = protectMath(text)
  const pieces = splitProtected(protectedText.text, options.charsPerItem ?? 1800)
  const out: string[] = []
  for (const piece of pieces) {
    if (piece.trim() === '' || /^⟦\s*\d+\s*⟧$/.test(piece.trim())) {
      out.push(piece)
      continue
    }
    try {
      let translated: string
      try {
        translated = await session.translate(piece, options.signal ? { signal: options.signal } : undefined)
      } catch (error) {
        // Some Chromium builds shipped the one-argument form first.
        if (error instanceof TypeError && options.signal) translated = await session.translate(piece)
        else throw error
      }
      out.push(translated)
    } catch (error) {
      if (options.signal?.aborted) throw new BrowserTranslationError('已取消', 'aborted')
      throw new BrowserTranslationError(translateMessage(error), 'error')
    }
  }
  return out.join('')
}

/** Translate and restore formulas; used by the selection bubble. */
export async function translateBrowserText(
  text: string,
  options: BrowserTranslatorOptions,
): Promise<string> {
  const protectedText = protectMath(text)
  const joined = await translateBrowserBlock(text, options)
  return restoreMath(joined, protectedText.spans) ?? joined
}
