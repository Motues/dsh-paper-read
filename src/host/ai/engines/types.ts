/** The contract every translation backend implements. */

import type { TranslationBilling, TranslationMode } from '../../../shared/domain.js'

export interface EngineLimits {
  /** Pages translated at once. */
  concurrency: number
  /** Maximum texts in one provider request. */
  batch: number
  /** Maximum characters in one text item. */
  charsPerItem: number
  /** Maximum characters across one provider request. */
  charsPerRequest: number
}

export interface EngineStreamRequest {
  system?: string
  user: string
  maxTokens?: number
  signal: AbortSignal
}

export interface TranslationEngine {
  id: string
  /** Stable label written onto cached pages, e.g. `api/deepl`. */
  label: string
  mode: TranslationMode
  billing: TranslationBilling
  limits: EngineLimits
  /** True when the work can only run inside the browser page. */
  external?: boolean
  /**
   * LLM engines that may be a translation-specific model: when the JSONL
   * protocol produces no parsable blocks, fall back to one plain-text request
   * per block instead of failing the page.
   */
  plainFallback?: boolean
  available(): Promise<boolean>
  /** Why the engine cannot run, when available() is false. */
  reason?: string
  /** LLM engines only. */
  stream?(request: EngineStreamRequest): AsyncIterable<string>
  /** MT engines only. Same order and length as `texts`. */
  translateBatch?(texts: string[], signal: AbortSignal): Promise<string[]>
  /** MT engines only: one text, used by the selection bubble. */
  translate?(text: string, signal: AbortSignal): Promise<string>
}

export class TranslationEngineError extends Error {
  code: string
  status?: number

  constructor(message: string, code = 'TRANSLATION_ENGINE_ERROR', status?: number) {
    super(message)
    this.name = 'TranslationEngineError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

/** A fixed engine that reports why it cannot run; keeps status/UI code uniform. */
export function unavailableEngine(
  id: string,
  label: string,
  mode: TranslationMode,
  billing: TranslationBilling,
  error: string,
  limits: EngineLimits = { concurrency: 1, batch: 1, charsPerItem: 4000, charsPerRequest: 4000 },
): TranslationEngine {
  return {
    id,
    label,
    mode,
    billing,
    limits,
    reason: error,
    async available() {
      return false
    },
  }
}
