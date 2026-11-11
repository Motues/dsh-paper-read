/**
 * One place that talks to the harness model service.
 *
 * Route resolution order: plugin config → the harness default selection → the
 * first provider/model the registry advertises. Everything above this file only
 * sees `streamText()` / `complete()` / `json()`, so swapping the route or adding
 * retries never leaks into the pipeline.
 */

import type { UsagePurpose } from '../../shared/domain.js'
import type { UsageSample } from '../usage/ledger.js'
import { extractJson } from '../util/util.js'

export class LlmUnavailable extends Error {
  code = 'LLM_UNAVAILABLE'

  constructor(message: string) {
    super(message)
    this.name = 'LlmUnavailable'
  }
}

export interface LlmProvider {
  id: string
  name?: string
}

export interface LlmModel {
  id: string
  name?: string
  provider?: string
}

/** Reasoning metadata one adapter advertises for an exact model. */
export interface LlmReasoningInfo {
  efforts: Array<{ id: string; name: string; description?: string }>
  defaultEffort?: string
}

export interface LlmResolvedModel {
  reasoning?: LlmReasoningInfo
}

export interface LlmFailure {
  message?: string
  code?: string
}

export interface LlmFinishReason {
  kind?: string
  failure?: LlmFailure
}

export interface LlmChunk {
  type: string
  text?: string
  reason?: LlmFinishReason
  /** DSH reports exact token counts on the terminal `usage` chunk. */
  usage?: LlmUsage
}

/** The usage payload DSH adapters attach to one stream attempt. */
export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

export interface ChatContentPart {
  type: 'text'
  text: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: ChatContentPart[]
}

export interface LlmStreamOptions {
  provider: string
  model: string
  reasoningEffort?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  system?: string
}

/** The slice of the harness `llm` service this plugin relies on. */
export interface LlmService {
  listProviders?(): LlmProvider[]
  listModels(providerId: string): Promise<LlmModel[]>
  resolveModelInfo?(provider: string, model: string): Promise<LlmResolvedModel>
  stream(options: LlmStreamOptions): AsyncIterable<LlmChunk>
}

export interface ModelRoute {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelCatalogPayload {
  available: boolean
  providers: Array<{
    id: string
    name: string
    models: Array<{ id: string; name: string }>
    error?: string
  }>
  default: ModelRoute | null
}

export interface SummonerRequest {
  system?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /** Explicit route (the paper's own choice); otherwise the configured one. */
  route?: ModelRoute
  /** Which product feature spent the tokens; only used by the usage ledger. */
  purpose?: UsagePurpose
  /** Ask for a cheaper reasoning effort when the model advertises one. */
  reasoningEffort?: string
}

export interface SummonerDeps {
  getLlm: () => LlmService | undefined
  getSelection: () => ModelRoute | undefined
  getConfig: () => { provider: string; model: string; aiEnabled?: boolean }
  log?: (message: string, error?: unknown) => void
  /** Receives one exact usage sample per completed stream attempt. */
  recordUsage?: (sample: UsageSample) => void
}

const userMessage = (text: string): ChatMessage => ({ role: 'user', content: [{ type: 'text', text }] })

export class Summoner {
  private getLlm: () => LlmService | undefined
  private getSelection: () => ModelRoute | undefined
  private getConfig: () => { provider: string; model: string; aiEnabled?: boolean }
  private log: (message: string, error?: unknown) => void
  private recordUsage?: (sample: UsageSample) => void
  cached: ModelRoute | null = null
  cachedAt = 0
  private efforts = new Map<string, { at: number; ids: Set<string> }>()

  constructor({ getLlm, getSelection, getConfig, log, recordUsage }: SummonerDeps) {
    this.getLlm = getLlm
    this.getSelection = getSelection
    this.getConfig = getConfig
    this.log = log ?? (() => {})
    this.recordUsage = recordUsage
  }

  get llm(): LlmService {
    const service = this.getLlm()
    if (!service) throw new LlmUnavailable('模型服务不可用')
    return service
  }

  /** The settings master switch; absent on old configs means enabled. */
  enabled(): boolean {
    return this.getConfig().aiEnabled !== false
  }

  async target(): Promise<ModelRoute | null> {
    if (!this.enabled()) return null
    if (this.cached && Date.now() - this.cachedAt < 30_000) return this.cached
    const config = this.getConfig()
    if (config.provider && config.model) {
      this.cached = { provider: config.provider, model: config.model }
      this.cachedAt = Date.now()
      return this.cached
    }
    const selection = this.getSelection()
    if (selection?.provider && selection?.model) {
      this.cached = { provider: selection.provider, model: selection.model }
      this.cachedAt = Date.now()
      return this.cached
    }
    try {
      const providers = this.llm.listProviders?.() ?? []
      for (const provider of providers) {
        const models = await this.llm.listModels(provider.id)
        if (models.length > 0) {
          this.cached = { provider: provider.id, model: models[0].id }
          this.cachedAt = Date.now()
          return this.cached
        }
      }
    } catch (error) {
      this.log('route resolution failed', error)
    }
    return null
  }

  async available(): Promise<boolean> {
    try {
      return (await this.target()) !== null
    } catch {
      return false
    }
  }

  /**
   * What the harness can actually route to, plus the default pair. Used by the
   * settings page so the user picks from configured models instead of typing.
   */
  async catalog(): Promise<ModelCatalogPayload> {
    const selection = this.getSelection()
    const defaultRoute = selection?.provider && selection?.model
      ? { provider: selection.provider, model: selection.model }
      : null
    let llm: LlmService
    try {
      llm = this.llm
    } catch {
      return { available: false, providers: [], default: defaultRoute }
    }
    const providers: ModelCatalogPayload['providers'] = []
    for (const provider of llm.listProviders?.() ?? []) {
      let models: Array<{ id: string; name: string }> = []
      let failure: string | undefined
      try {
        models = (await llm.listModels(provider.id)).map((model) => ({
          id: model.id,
          name: model.name || model.id,
        }))
      } catch (error) {
        failure = String((error as Error)?.message ?? error).slice(0, 200)
        models = []
      }
      providers.push({ id: provider.id, name: provider.name || provider.id, models, error: failure })
    }
    return { available: true, providers, default: defaultRoute }
  }

  /** Reasoning efforts one exact route advertises; empty when the adapter has none. */
  async reasoning(provider: string, model: string): Promise<LlmReasoningInfo | null> {
    try {
      const resolved = await this.llm.resolveModelInfo?.(provider, model)
      const reasoning = resolved?.reasoning
      if (!reasoning || !Array.isArray(reasoning.efforts)) return null
      return {
        efforts: reasoning.efforts.map((effort) => ({
          id: String(effort.id),
          name: String(effort.name ?? effort.id),
          ...(effort.description ? { description: String(effort.description) } : {}),
        })),
        ...(reasoning.defaultEffort ? { defaultEffort: String(reasoning.defaultEffort) } : {}),
      }
    } catch (error) {
      this.log(`model info unavailable: ${provider}/${model}`, error)
      return null
    }
  }

  /**
   * A cheap effort the model actually advertises, or `undefined` to use the
   * adapter default. Digest calls are extraction work; letting a reasoning
   * model spend the whole output budget on hidden tokens is how an empty map
   * window happens.
   */
  private async effortFor(target: ModelRoute, requested: string): Promise<string | undefined> {
    const key = `${target.provider}/${target.model}`
    const cached = this.efforts.get(key)
    if (cached && Date.now() - cached.at < 300_000) {
      if (cached.ids.has(requested)) return requested
      if (requested === 'low') {
        for (const fallback of ['off', 'minimal']) if (cached.ids.has(fallback)) return fallback
      }
      return undefined
    }
    let ids = new Set<string>()
    try {
      const info = await this.llm.resolveModelInfo?.(target.provider, target.model)
      ids = new Set((info?.reasoning?.efforts ?? []).map((effort) => String(effort.id)))
    } catch (error) {
      this.log(`reasoning info unavailable: ${key}`, error)
      return undefined
    }
    this.efforts.set(key, { at: Date.now(), ids })
    if (ids.has(requested)) return requested
    if (requested === 'low') {
      for (const fallback of ['off', 'minimal']) if (ids.has(fallback)) return fallback
    }
    return undefined
  }

  /** Raw streaming text deltas. */
  async *streamText(request: SummonerRequest): AsyncGenerator<string> {
    const target = request.route ?? await this.target()
    if (!target) throw new LlmUnavailable('没有可用的模型')
    const options: LlmStreamOptions = {
      provider: target.provider,
      model: target.model,
      messages: request.messages.map((message) => ({ ...message })),
      temperature: request.temperature ?? 0.3,
      maxTokens: request.maxTokens,
      signal: request.signal,
    }
    const effort = request.reasoningEffort
      ? await this.effortFor(target, request.reasoningEffort)
      : target.reasoningEffort
    if (effort) options.reasoningEffort = effort
    if (request.system) options.system = request.system
    let failure: LlmFailure | null = null
    let usage: LlmUsage | undefined
    try {
      for await (const chunk of this.llm.stream(options)) {
        if (chunk.type === 'usage' && chunk.usage) usage = chunk.usage
        else if (chunk.type === 'text-delta') yield chunk.text ?? ''
        else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
          failure = chunk.reason.failure ?? null
        } else if (chunk.type === 'finish' && chunk.reason?.kind === 'aborted') {
          throw request.signal?.reason ?? new Error('已取消')
        }
      }
    } finally {
      // Record even when the turn failed: the provider still billed the tokens.
      if (usage) {
        this.record({
          ...usage,
          at: new Date().toISOString(),
          provider: target.provider,
          model: target.model,
          source: request.purpose ?? 'other',
        })
      }
    }
    if (failure) {
      throw Object.assign(
        new Error(`模型调用失败：${failure.message ?? failure.code ?? '未知错误'}`),
        { code: failure.code },
      )
    }
  }

  private record(sample: UsageSample): void {
    try {
      this.recordUsage?.(sample)
    } catch (error) {
      this.log('usage record failed', error)
    }
  }

  async complete({
    system,
    user,
    temperature = 0.2,
    maxTokens = 1200,
    signal,
    purpose,
    reasoningEffort,
  }: {
    system?: string
    user: string
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
    purpose?: UsagePurpose
    reasoningEffort?: string
  }): Promise<string> {
    let text = ''
    for await (const delta of this.streamText({
      system,
      messages: [userMessage(user)],
      temperature,
      maxTokens,
      signal,
      ...(purpose ? { purpose } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    })) {
      text += delta
    }
    return text.trim()
  }

  /** Ask for JSON and tolerate fences, chatter, or a truncated object. */
  async json({
    system,
    user,
    temperature = 0.2,
    maxTokens = 1200,
    signal,
    purpose,
    reasoningEffort,
  }: {
    system?: string
    user: string
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
    purpose?: UsagePurpose
    reasoningEffort?: string
  }): Promise<unknown> {
    const text = await this.complete({
      system,
      user,
      temperature,
      maxTokens,
      signal,
      ...(purpose ? { purpose } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    })
    const parsed = extractJson(text)
    if (parsed) return parsed
    throw new Error(`模型没有返回可解析的 JSON：${text.slice(0, 140)}`)
  }
}
