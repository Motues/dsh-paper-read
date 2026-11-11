/**
 * One DSH session per paper.
 *
 * The reader's conversation is a real harness session: `ctx.agents` drives it,
 * the loop appends `assistant/message` events, compaction runs under pressure
 * and the transcript survives a restart. Nothing in here talks to the model
 * service directly — that only happens on the fallback path, in `ask.ts`.
 *
 * Shape of the context window (the part that decides cache hits):
 *
 *   [system]    the preset persona, static bytes, never rewritten
 *   [user]      digest — written once, before the first question
 *   [user]      retrieval for turn 1        ┐ append-only from here on: every
 *   [user]      question 1                  │ later turn only ever extends the
 *   [assistant] answer 1                    │ prefix, so it stays cached
 *   [user]      retrieval for turn 2        │
 *   [user]      question 2                  ┘
 *
 * A DSH service missing from the profile (no `agents`, no preset registry)
 * degrades to the one-shot `llm.stream` path instead of failing the request.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type {
  ChatContextUsage,
  ChatConversation,
  ChatConversationList,
  ChatHistoryPayload,
  ChatMessage,
  ChatModelCatalog,
  ChatModelOption,
  ChatResetResult,
  ChatRoute,
  CompactResult,
  PaperRecord,
} from '../../shared/domain.js'
import type { LlmUsage } from './summoner.js'
import { buildDigest, buildRetrieval, readPaperSnapshot, retrieve } from './context.js'
import { nowIso, truncate } from '../util/util.js'

import {
  PAPER_PRESET,
  type AgentLike,
  type AgentPresetsServiceLike,
  type AgentsServiceLike,
  type AskStreamInput,
  type ChatActivity,
  type ChatSink,
  type CompactionServiceLike,
  type LlmLike,
  type MessageSourceLike,
  type PaperChat,
  type PaperChatDeps,
  type SessionLike,
  type SessionPersistenceLike,
  type SessionQueryLike,
  type SessionTitleLike,
  type TokenMeterLike,
  type UserMessageLike,
  type WorkspaceRegistryLike,
} from './chat-contract.js'
import { createPaperWorkspaces, paperWorkspaceDir } from './chat-workspace.js'

export { PAPER_PRESET, PAPER_WORKSPACE_TITLE } from './chat-contract.js'
export type { ChatBridge, ChatSink, PaperChat, PaperChatMode } from './chat-contract.js'

/** Live agents kept hot; each one holds a session write handle. */
const MAX_LIVE_AGENTS = 3

interface LiveEntry {
  agent: AgentLike
  /** Disposes the handle we created; a no-op for an agent we merely observed. */
  dispose: () => Promise<void>
  touchedAt: number
}

export function createPaperChat({ store, indexer, summoner, bridge, buildAsk, log, recordUsage, tasks }: PaperChatDeps): PaperChat {
  const live = new Map<string, LiveEntry>()
  const queues = new Map<string, Promise<unknown>>()
  /** Running turns, keyed by paper; the task page reads this. */
  const activeTurns = new Map<string, ChatActivity>()
  /** Set when the preset is missing, so the fallback message can say why. */
  let presetMissing = false
  /** Last route the harness offered; papers with no choice of their own follow it. */
  let lastTarget: { provider: string; model: string } | undefined
  /** Routing catalog; reasoning metadata costs one resolve per model. */
  let catalogCache: { at: number; options: ChatModelOption[] } | null = null
  const CATALOG_TTL_MS = 60_000

  const agents = (): AgentsServiceLike | undefined => (bridge.service('agents') as AgentsServiceLike) ?? undefined
  const presets = (): AgentPresetsServiceLike | undefined =>
    (bridge.service('agentPresets') as AgentPresetsServiceLike) ?? undefined
  const persistence = (): SessionPersistenceLike | undefined =>
    (bridge.service('sessionPersistence') as SessionPersistenceLike) ?? undefined
  const workspace = (): WorkspaceRegistryLike | undefined =>
    (bridge.service('workspaceRegistry') as WorkspaceRegistryLike) ?? undefined
  const llm = (): LlmLike | undefined => (bridge.service('llm') as LlmLike) ?? undefined

  /** Serialize per paper: one question at a time, like the old `busy` lock. */
  function enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.then(run, run)
    queues.set(key, next.catch(() => undefined))
    return next
  }

  // ── live agent bookkeeping ───────────────────────────────────────────────
  /** Record an agent we are allowed to dispose; keep an older disposer otherwise. */
  function remember(sessionId: string, agent: AgentLike, dispose?: () => Promise<void>): AgentLike {
    const previous = live.get(sessionId)
    live.set(sessionId, {
      agent,
      dispose: dispose ?? previous?.dispose ?? (async () => {}),
      touchedAt: Date.now(),
    })
    return agent
  }

  function forget(sessionId: string): Promise<void> {
    const entry = live.get(sessionId)
    if (!entry) return Promise.resolve()
    live.delete(sessionId)
    return entry.dispose().catch((error) => log('agent dispose failed', error))
  }

  /** Keep at most MAX_LIVE_AGENTS, oldest-idle first; a running turn is never evicted. */
  async function evictOverflow(keepSessionId: string): Promise<void> {
    if (live.size <= MAX_LIVE_AGENTS) return
    const candidates = [...live.entries()]
      .filter(([id]) => id !== keepSessionId)
      .filter(([, entry]) => entry.agent.status === 'idle')
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    for (const [id] of candidates) {
      if (live.size <= MAX_LIVE_AGENTS) break
      await forget(id)
    }
  }

  // ── session lifecycle ────────────────────────────────────────────────────
  /**
   * Give the agent its preset and nothing else.
   *
   * `paper-reader` declares no plugins, so it adds no tools — but this profile's
   * third-party plugins register *global* tools that every agent would see. The
   * restriction is scoped to this agent and lifted with it.
   */
  function stripTools(agentCtx: unknown): void {
    const scope = agentCtx as { get?: (name: string) => unknown } | undefined
    const tools = scope?.get?.('tools') as
      | { definitions?(): Array<{ name?: string }>; restrict?(filter: { deny: string[] }): unknown }
      | undefined
    if (typeof tools?.definitions !== 'function' || typeof tools.restrict !== 'function') return
    let names: string[]
    try {
      names = tools.definitions().map((tool) => String(tool?.name ?? '')).filter(Boolean)
    } catch (error) {
      log('tool listing failed', error)
      return
    }
    // `restrict` rejects an empty filter, so there is nothing to do without tools.
    if (names.length === 0) return
    try {
      tools.restrict({ deny: names })
    } catch (error) {
      log('tool restriction failed', error)
    }
  }

  function mountPreset(): (agentCtx: unknown) => Promise<void> {
    const registry = presets()
    return async (agentCtx: unknown) => {
      if (!registry) throw new Error('agentPresets service is not mounted')
      await registry.mount(agentCtx, PAPER_PRESET)
      stripTools(agentCtx)
    }
  }

  function routeOptions(paper: PaperRecord): { provider?: string; model?: string } {
    // The paper's own choice wins, so a newly created session starts on the
    // model the panel claims it runs on.
    if (paper.chatModel?.provider && paper.chatModel.model) {
      return { provider: paper.chatModel.provider, model: paper.chatModel.model }
    }
    return lastTarget ?? {}
  }

  /** Warm the fallback route once per agent creation, without failing it. */
  async function primeTarget(): Promise<void> {
    if (lastTarget) return
    try {
      const target = await summoner.target()
      if (target) lastTarget = { provider: target.provider, model: target.model }
    } catch (error) {
      log('route resolution failed', error)
    }
  }

  /** A paper with no stored choice follows whatever the harness routes to. */
  async function currentRoute(paper: PaperRecord): Promise<ChatRoute | null> {
    if (paper.chatModel?.provider && paper.chatModel.model) return { ...paper.chatModel }
    const live = agents()?.get(store.sessionIdFor(paper))?.model?.current?.()
    if (live?.provider && live?.model) {
      return {
        provider: live.provider,
        model: live.model,
        ...(live.reasoningEffort ? { reasoningEffort: live.reasoningEffort } : {}),
      }
    }
    try {
      const target = lastTarget ?? (await summoner.target())
      if (!target) return null
      lastTarget = { provider: target.provider, model: target.model }
      return { provider: target.provider, model: target.model }
    } catch (error) {
      log('route read failed', error)
      return null
    }
  }

  /** Trim a client-supplied route and reject the shapes routing cannot use. */
  function normalizeRoute(input: ChatRoute): ChatRoute {
    const provider = String(input?.provider ?? '').trim()
    const model = String(input?.model ?? '').trim()
    if (!provider || !model) {
      throw Object.assign(new Error('缺少模型路由'), { status: 400 })
    }
    const effort = typeof input.reasoningEffort === 'string' ? input.reasoningEffort.trim() : ''
    return effort ? { provider, model, reasoningEffort: effort } : { provider, model }
  }

  /** Model list plus the efforts each route advertises; cached for a minute. */
  async function catalogOptions(): Promise<ChatModelOption[]> {
    if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.options
    const service = llm()
    if (!service) return []
    const options: ChatModelOption[] = []
    for (const provider of service.listProviders?.() ?? []) {
      let models: Array<{ id: string; name?: string }> = []
      try {
        models = await service.listModels(provider.id)
      } catch (error) {
        log(`model listing failed: ${provider.id}`, error)
        continue
      }
      for (const model of models) {
        // `resolveModelInfo` is adapter work and may fail per model; the model
        // still routes, it just advertises no effort ladder.
        const reasoning = await summoner.reasoning?.(provider.id, model.id).catch(() => null)
        options.push({
          provider: provider.id,
          providerName: provider.name || provider.id,
          model: model.id,
          name: model.name || model.id,
          efforts: reasoning?.efforts ?? [],
          ...(reasoning?.defaultEffort ? { defaultEffort: reasoning.defaultEffort } : {}),
        })
      }
    }
    catalogCache = { at: Date.now(), options }
    return options
  }

  async function setModel(paperId: string, input: ChatRoute): Promise<ChatRoute> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    const route = normalizeRoute(input)
    const service = llm()
    if (service?.resolveCallConfig) {
      try {
        await service.resolveCallConfig(route)
      } catch (error) {
        const message = truncate(String((error as Error)?.message ?? error), 160)
        throw Object.assign(new Error(`这个模型不可用：${message}`), { status: 409 })
      }
    }
    await store.updatePaper(paperId, { chatModel: route })
    // A live session switches on its next step; `select` is a no-op when the
    // recorded selection already matches.
    const agent = agents()?.get(store.sessionIdFor(paper))
    try {
      agent?.model?.select?.(route)
    } catch (error) {
      log('model selection failed', error)
    }
    return route
  }
  function nameSessionWith(sessionId: string, title: string): void {
    const service = bridge.service('sessionTitle') as SessionTitleLike | undefined
    const agent = agents()?.get(sessionId)
    if (!service || !agent || !title.trim()) return
    try {
      service.rename(agent.session, title)
    } catch (error) {
      log('session title failed', error)
    }
  }

  /**
   * A fresh conversation starts unnamed; the workspace already names the paper,
   * so the session title should describe this conversation instead.
   */
  function nameSession(sessionId: string, paper: PaperRecord): void {
    const custom = paper.conversationTitles?.[sessionId]?.trim()
    nameSessionWith(sessionId, custom || `新对话 · ${truncate(paper.title || paper.id, 40)}`)
  }

  /** Seed the agent's model seat from the paper's stored choice. */
  function applyChosenRoute(agent: AgentLike, paper: PaperRecord): void {
    const chosen = paper.chatModel
    if (!chosen?.provider || !chosen.model) return
    try {
      agent.model?.select?.({ ...chosen })
    } catch (error) {
      log('model selection failed', error)
    }
  }

  /**
   * `live` → `cold with log` → `no log`, per the plan.
   *
   * Returns `null` when this profile cannot host sessions at all, which sends
   * the caller down the one-shot fallback path.
   */
  async function ensureAgent(paper: PaperRecord): Promise<AgentLike | null> {
    const service = agents()
    if (!service || !presets()) return null
    const sessionId = store.sessionIdFor(paper)
    if (!paper.sessionId) {
      await store.updatePaper(paper.id, { sessionId }).catch((error) => log('sessionId write failed', error))
    }

    const existing = service.get(sessionId)
    if (existing) {
      remember(sessionId, existing)
      const custom = paper.conversationTitles?.[sessionId]?.trim()
      if (custom) nameSessionWith(sessionId, custom)
      return existing
    }

    await primeTarget()
    const agentOptions = routeOptions(paper)
    const setup = mountPreset()

    // Cold session with a log on disk: resume instead of creating a second log.
    let hasLog = false
    try {
      hasLog = Boolean(await persistence()?.stat?.(sessionId))
    } catch {
      hasLog = false
    }

    if (hasLog) {
      try {
        const handle = await service.resume({ resumeSessionId: sessionId, agentOptions, setup })
        remember(sessionId, handle.agent, () => handle.dispose())
        applyChosenRoute(handle.agent, paper)
        const custom = paper.conversationTitles?.[sessionId]?.trim()
        if (custom) nameSessionWith(sessionId, custom)
        await evictOverflow(sessionId)
        return handle.agent
      } catch (error) {
        log('session resume failed; rebuilding', error)
      }
    }

    try {
      // The paper's own directory is the session cwd: workspace membership in
      // DSH is validated against the stored header cwd, so a shared root would
      // make the per-paper sidebar groups impossible to attach.
      await fs.mkdir(paperWorkspaceDir(store.workspaceDir, paper.id), { recursive: true })
      const handle = await service.create({
        sessionId,
        meta: { cwd: paperWorkspaceDir(store.workspaceDir, paper.id), agentPreset: PAPER_PRESET },
        agentOptions,
        setup,
      })
      remember(sessionId, handle.agent, () => handle.dispose())
      applyChosenRoute(handle.agent, paper)
      nameSession(sessionId, paper)
      await joinGroup(sessionId, paper)
      await evictOverflow(sessionId)
      presetMissing = false
      return handle.agent
    } catch (error) {
      // A dead log with the same id cannot be recreated; a fresh id can.
      if (hasLog) {
        const fresh = `${sessionId}-${randomUUID().slice(0, 6)}`
        try {
          const handle = await service.create({
            sessionId: fresh,
            meta: { cwd: paperWorkspaceDir(store.workspaceDir, paper.id), agentPreset: PAPER_PRESET },
            agentOptions,
            setup,
          })
          await store.updatePaper(paper.id, { sessionId: fresh })
          remember(fresh, handle.agent, () => handle.dispose())
          applyChosenRoute(handle.agent, paper)
          nameSession(fresh, paper)
          await joinGroup(fresh, paper)
          await evictOverflow(fresh)
          log('session rebuilt under a new id', error)
          return handle.agent
        } catch (retryError) {
          presetMissing = /preset/i.test(String((error as Error)?.message ?? error))
          log('session rebuild failed', retryError)
          return null
        }
      }
      presetMissing = /preset/i.test(String((error as Error)?.message ?? error))
      log('session create failed', error)
      return null
    }
  }

  // ── message construction ─────────────────────────────────────────────────
  const userMessage = (text: string, source: MessageSourceLike): UserMessageLike => ({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  })

  /**
   * A message source must be losslessly JSON: `undefined` fields are rejected
   * by the session-log snapshot, so absent metadata is simply omitted.
   */
  function sourceOf(
    mode: string,
    extra: { page?: number; quote?: string; pages?: number[] } = {},
  ): MessageSourceLike {
    const source: MessageSourceLike = { kind: 'paperreader', mode }
    if (typeof extra.page === 'number' && Number.isFinite(extra.page)) source.page = extra.page
    if (typeof extra.quote === 'string' && extra.quote !== '') source.quote = extra.quote
    if (Array.isArray(extra.pages) && extra.pages.length > 0) source.pages = extra.pages
    return source
  }

  const isPaperreader = (message: UserMessageLike | undefined, mode?: string): boolean =>
    message?.source?.kind === 'paperreader' && (mode === undefined || message.source.mode === mode)

  /** Queued-but-unclaimed input: a turn that failed before admitting left it here. */
  function pendingOf(agent: AgentLike): UserMessageLike[] {
    const inbox = agent.inbox
    if (!inbox) return []
    return [...(inbox.nextStep ?? []), ...(inbox.nextTurn ?? [])]
  }

  /**
   * Whether the first (digest) message still has to be written.
   *
   * "No user-role message yet" is the durable signal: the loop appends the
   * system node together with the first admitted turn, and compaction keeps the
   * head system node plus a checkpoint, so a compacted conversation must not
   * get a second digest.
   */
  function needsDigest(agent: AgentLike): boolean {
    if (pendingOf(agent).some((message) => isPaperreader(message, 'digest'))) return false
    try {
      return !agent.session.deriveMessages().some((message) => message.role === 'user')
    } catch (error) {
      log('deriveMessages failed', error)
      return true
    }
  }

  /**
   * Drop retrieval blocks a previous attempt queued but never admitted, so one
   * turn never carries the same excerpts twice.
   */
  function dropStaleContext(agent: AgentLike): void {
    for (const message of pendingOf(agent).filter((item) => isPaperreader(item, 'context'))) {
      try {
        agent.inbox?.remove?.(message.id)
      } catch (error) {
        log('inbox remove failed', error)
      }
    }
  }

  /** The text the model reads for this turn; the quote is repeated for clarity. */
  function questionText(input: AskStreamInput): string {
    const where = input.page ? `第 ${input.page} 页` : '当前页'
    const quote = input.quote?.trim() ?? ''
    if (input.kind === 'explain') {
      return `解释${where}这一段：\n"${truncate(quote, 1600)}"\n\n用 3–5 句。若涉及公式，说明每个符号在做什么；作者省略的关键推导，指出省略点。`
    }
    if (quote) return `我正读到${where}这一段：\n"${truncate(quote, 1600)}"\n\n问题：${input.question}`
    return input.question
  }

  /** First question becomes the conversation's sidebar title. */
  function conversationTitleFromInput(input: AskStreamInput): string {
    const base = (input.question || input.quote || '').replace(/\s+/g, ' ').trim()
    return truncate(base || '新对话', 30)
  }

  // ── the turn ─────────────────────────────────────────────────────────────
  async function runTurn(input: AskStreamInput, sink: ChatSink, signal?: AbortSignal): Promise<void> {
    const paper = store.getPaper(input.paperId)
    if (!paper) {
      sink.error('论文不存在')
      return
    }
    const agent = await ensureAgent(paper)
    if (!agent) {
      await runOneShot(input, sink, signal)
      return
    }

    const sessionId = agent.id
    const turnRoute = await currentRoute(paper).catch(() => null)
    /** Latest `usage` chunk per model attempt, flushed when that attempt ends. */
    const usageByAttempt = new Map<string, LlmUsage>()
    const flushUsage = (attemptId: string): void => {
      const usage = usageByAttempt.get(attemptId)
      if (!usage) return
      usageByAttempt.delete(attemptId)
      try {
        recordUsage?.({
          ...usage,
          at: new Date().toISOString(),
          provider: turnRoute?.provider ?? '',
          model: turnRoute?.model ?? '',
          source: 'chat',
        })
      } catch (error) {
        log('usage record failed', error)
      }
    }

    // Ordering matters. The loop only appends its `system/message` node while
    // opening the turn, so a message appended straight to the session surfaces
    // *before* the prompt. `inject()` queues next-step input instead, which the
    // loop claims ahead of the prompt and appends after the system node — so
    // the surface ends up [system][digest][retrieval][question].
    const pending: UserMessageLike[] = []
    // Retrieval reads the BM25 index, which is lazily built on first use — on a
    // fresh process this call is what fills it, so it has to come first.
    await indexer.ensureIndex().catch((error) => log('index unavailable', error))
    const hits = retrieve(indexer, input.paperId, input.question || input.quote || '', 4)
    const retrieval = buildRetrieval(input.question || input.quote || '', hits)
    const citations = retrieval.citations

    dropStaleContext(agent)
    const firstTurn = needsDigest(agent)
    try {
      if (firstTurn) {
        const snapshot = await readPaperSnapshot(store, indexer, input.paperId)
        if (snapshot) {
          pending.push(userMessage(buildDigest(snapshot), sourceOf('digest')))
        }
      }
    } catch (error) {
      log('digest build failed; falling back', error)
      await runOneShot(input, sink, signal)
      return
    }
    if (retrieval.text) {
      pending.push(userMessage(retrieval.text, sourceOf('context', { pages: citations })))
    }

    let aborted = false
    let failure: string | null = null
    let committed = false

    const offStream = bridge.on('agent/assistant-stream', (payload) => {
      if (payload?.agent?.id !== sessionId) return
      const frame = payload.frame
      if (frame?.type === 'start') {
        failure = null
        return
      }
      if (frame?.type === 'chunk') {
        const chunk = frame.chunk
        if (chunk?.type === 'usage' && chunk.usage) {
          usageByAttempt.set(String(frame.attemptId), chunk.usage)
        }
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
          sink.delta(chunk.text)
        }
        return
      }
      if (frame?.type === 'end') {
        flushUsage(String(frame.attemptId))
        committed = frame.outcome?.kind === 'committed'
      }
    })
    const offError = bridge.on('agent/error', (payload) => {
      if (payload?.agent?.id !== sessionId) return
      const error = payload.error
      failure = String(error?.message ?? error?.code ?? error ?? '模型调用失败')
    })
    const onAbort = (): void => {
      aborted = true
      try {
        agent.cancel({ kind: 'user' })
      } catch (error) {
        log('cancel failed', error)
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    // Hidden paper sessions are archived, and an archived session cannot open a
    // step. Lift the gate for the turn and restore the preference afterwards.
    const hidden = store.config.paperSessionInSidebar !== true

    try {
      if (hidden) await setArchived(sessionId, false)
      for (const message of pending) agent.inject(message)
      agent.followup(userMessage(questionText(input), sourceOf(
        input.kind === 'explain' ? 'explain' : 'ask',
        { page: input.page, quote: input.quote },
      )))
      await agent.whenIdle()
    } catch (error) {
      failure = String((error as Error)?.message ?? error)
    } finally {
      signal?.removeEventListener('abort', onAbort)
      offStream()
      offError()
      // An attempt can die before its `end` frame; still account for what the
      // provider billed before the failure.
      for (const attemptId of [...usageByAttempt.keys()]) flushUsage(attemptId)
      if (hidden) await setArchived(sessionId, true)
    }

    if (aborted || sink.closed) {
      sink.error('已取消')
      return
    }
    if (failure) {
      sink.error(truncate(failure, 240))
      return
    }
    if (!committed) {
      // No `assistant/message` was committed: the turn died before finishing.
      sink.error('回答没有完成，请重试')
      return
    }
    // Keep the sidebar entry meaningful: the first question names the session,
    // unless the reader already renamed this conversation.
    if (firstTurn && !paper.conversationTitles?.[sessionId]) {
      nameSessionWith(sessionId, conversationTitleFromInput(input))
    }
    sink.done({ citations })
  }

  // ── fallback: one stateless `llm.stream` call ────────────────────────────
  async function runOneShot(input: AskStreamInput, sink: ChatSink, signal?: AbortSignal): Promise<void> {
    const paper = store.getPaper(input.paperId)
    if (!paper) {
      sink.error('论文不存在')
      return
    }
    const route = await currentRoute(paper)
    const plan = await buildAsk({
      paperId: input.paperId,
      question: input.question,
      quote: input.quote,
      page: input.page,
      kind: input.kind,
    }).catch((error) => {
      log('fallback plan failed', error)
      return null
    })
    if (!plan) {
      sink.error('论文不存在')
      return
    }
    let answer = ''
    try {
      for await (const delta of summoner.streamText({
        system: plan.system,
        messages: plan.messages,
        temperature: plan.temperature,
        maxTokens: plan.maxTokens,
        signal,
        purpose: input.kind === 'translate' ? 'translate' : 'chat',
        ...(route ? { route } : {}),
      })) {
        answer += delta
        sink.delta(delta)
      }
    } catch (error) {
      if (!signal?.aborted) sink.error(truncate(String((error as Error)?.message ?? error), 240))
      else sink.error('已取消')
      return
    }
    if (sink.closed) {
      sink.error('已取消')
      return
    }
    if (answer.trim() === '') {
      sink.error('模型没有返回内容')
      return
    }
    if (presetMissing) {
      // The answer is fine; the reason it is stateless belongs in the log.
      log('paper-reader preset missing — answered without a session')
    }
    sink.done({ citations: [...new Set(plan.citations.map((item) => item.page))].filter(Boolean) })
  }

  // ── transcript projection ────────────────────────────────────────────────
  function textOf(content: Array<{ type: string; text?: string }> | undefined): string {
    if (!Array.isArray(content)) return ''
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
  }

  function toChatMessage(event: { type: string; data: any }): ChatMessage | null {
    if (event.type === 'user/message') {
      const message = event.data
      const source = message?.source
      if (source?.kind === 'compact-checkpoint') {
        const body = textOf(message.content)
        return body.trim() === ''
          ? null
          : { id: String(message.id ?? randomUUID()), role: 'user', text: body, summary: true }
      }
      if (source?.kind !== 'paperreader') return null
      const mode = source.mode
      const body = textOf(message.content)
      if (body.trim() === '') return null
      // Injected context is part of the transcript: the panel shows it as a
      // collapsed row in place, so the reader can see what the model was given.
      if (mode === 'digest' || mode === 'context') {
        return {
          id: String(message.id ?? randomUUID()),
          role: 'user',
          text: body,
          injected: mode === 'digest' ? 'digest' : 'retrieval',
          ...(Array.isArray(source.pages) && source.pages.length > 0
            ? { pages: source.pages.filter((page: unknown) => typeof page === 'number') }
            : {}),
        }
      }
      return {
        id: String(message.id ?? randomUUID()),
        role: 'user',
        text: body,
        mode: mode === 'explain' ? 'explain' : 'ask',
        page: typeof source.page === 'number' ? source.page : undefined,
        quote: typeof source.quote === 'string' && source.quote !== '' ? source.quote : undefined,
      }
    }
    if (event.type === 'assistant/message') {
      const message = event.data?.message
      const body = textOf(message?.content)
      if (body.trim() === '') return null
      return { id: String(message.id ?? randomUUID()), role: 'assistant', text: body }
    }
    return null
  }

  async function eventsOf(sessionId: string): Promise<Array<{ type: string; data: any }>> {
    const query = bridge.service('sessionQuery') as SessionQueryLike | undefined
    if (query) {
      try {
        const surface = await query.readSurface(sessionId)
        return surface.events ?? []
      } catch (error) {
        log('readSurface failed', error)
      }
    }
    const agent = agents()?.get(sessionId)
    if (!agent) return []
    // Live-only fallback: the derived messages carry source and content already.
    return agent.session.deriveMessages().map((message) => ({
      type: message.role === 'assistant' ? 'assistant/message' : 'user/message',
      data: message.role === 'assistant' ? { message } : message,
    }))
  }

  function compactedOf(session: SessionLike): boolean {
    try {
      return session.deriveMessages().some((message) => message.source?.kind === 'compact-checkpoint')
    } catch {
      return false
    }
  }

  async function contextUsage(paperId: string): Promise<ChatContextUsage | null> {
    const paper = store.getPaper(paperId)
    if (!paper) return null
    const sessionId = store.sessionIdFor(paper)
    const agent = agents()?.get(sessionId)
    if (!agent) return null
    const meter = bridge.service('tokenMeter') as TokenMeterLike | undefined
    if (!meter) return null
    try {
      const pressure = meter.contextPressure(agent.session)
      const tokens = Number(pressure?.pressureTokens ?? 0)
      const contextWindow = Number(pressure?.contextWindow ?? 0)
      return {
        tokens,
        window: contextWindow,
        percent: contextWindow > 0 ? Math.min(100, Math.round((tokens / contextWindow) * 100)) : 0,
        compacted: compactedOf(agent.session),
      }
    } catch (error) {
      log('contextPressure failed', error)
      return null
    }
  }

  async function history(paperId: string): Promise<ChatHistoryPayload> {
    const paper = store.getPaper(paperId)
    if (!paper) return { sessionId: '', messages: [], context: null, route: null }
    const sessionId = store.sessionIdFor(paper)
    const events = await eventsOf(sessionId)
    const messages: ChatMessage[] = []
    for (const event of events) {
      const message = toChatMessage(event)
      if (message) messages.push(message)
    }
    return {
      sessionId,
      messages,
      context: await contextUsage(paperId),
      route: await currentRoute(paper),
    }
  }

  async function models(paperId: string): Promise<ChatModelCatalog> {
    const paper = store.getPaper(paperId)
    return {
      available: Boolean(llm()),
      options: await catalogOptions(),
      current: paper ? await currentRoute(paper) : null,
    }
  }

  // ── compaction ───────────────────────────────────────────────────────────
  async function compact(paperId: string): Promise<CompactResult> {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    const sessionId = store.sessionIdFor(paper)
    const agent = agents()?.get(sessionId)
    if (!agent) throw Object.assign(new Error('对话还没有开始，先问一句再压缩'), { status: 409 })

    // `compaction` lives inside the agent's preset realm in the Web profile, so
    // the plugin's own `ctx.get('compaction')` is not the right instance.
    const fromPreset = presets()?.serviceFor(agent, 'compaction') as CompactionServiceLike | undefined
    const service = fromPreset ?? (bridge.service('compaction') as CompactionServiceLike | undefined)
    if (!service) throw Object.assign(new Error('这个 profile 没有压缩服务'), { status: 503 })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('压缩超时')), 120_000)
    try {
      const result = await service.compactNow(agent, controller.signal)
      if (!result) return { removed: 0, freedTokens: 0 }
      return {
        removed: Array.isArray(result.shadowedSeqs) ? result.shadowedSeqs.length : 0,
        freedTokens: Number(result.shadowedTokenCount ?? 0),
      }
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      throw Object.assign(new Error(`压缩失败：${truncate(message, 200)}`), { status: 409 })
    } finally {
      clearTimeout(timer)
    }
  }

  // ── conversation history ─────────────────────────────────────────────────
  /** Every session this paper owns: active first, then history newest first. */
  function sessionIdsOf(paper: PaperRecord): string[] {
    const ids: string[] = []
    const seen = new Set<string>()
    const push = (id: string | undefined): void => {
      if (!id || seen.has(id)) return
      seen.add(id)
      ids.push(id)
    }
    push(store.sessionIdFor(paper))
    for (const id of [...(paper.retiredSessions ?? [])].reverse()) push(id)
    return ids
  }

  function archivedSet(paper: PaperRecord): Set<string> {
    return new Set(paper.archivedConversations ?? [])
  }

  function validSession(paper: PaperRecord, sessionId: string): boolean {
    return sessionIdsOf(paper).includes(sessionId)
  }

  function requirePaper(paperId: string): PaperRecord {
    const paper = store.getPaper(paperId)
    if (!paper) throw Object.assign(new Error('论文不存在'), { status: 404 })
    return paper
  }

  async function messagesOf(sessionId: string): Promise<ChatMessage[]> {
    const events = await eventsOf(sessionId)
    const messages: ChatMessage[] = []
    for (const event of events) {
      const message = toChatMessage(event)
      if (message) messages.push(message)
    }
    return messages
  }

  async function sessionMeta(sessionId: string): Promise<{
    createdAt?: string
    title?: string
    messageCount?: number
  }> {
    let createdAt: string | undefined
    try {
      const stat = await persistence()?.stat?.(sessionId)
      const stamp = stat?.header?.createdAt ?? stat?.header?.updatedAt
      if (typeof stamp === 'string' && stamp !== '') createdAt = stamp
    } catch (error) {
      log('session stat failed', error)
    }
    try {
      const messages = await messagesOf(sessionId)
      const turns = messages.filter((message) => !message.injected && !message.summary)
      const firstQuestion = turns.find((message) => message.role === 'user')
      return {
        createdAt,
        title: firstQuestion
          ? truncate(firstQuestion.text.replace(/\s+/g, ' ').trim(), 32)
          : undefined,
        messageCount: turns.length,
      }
    } catch (error) {
      log('session transcript read failed', error)
      return { createdAt }
    }
  }

  async function conversationList(paperId: string): Promise<ChatConversationList> {
    const paper = store.getPaper(paperId)
    if (!paper) return { paperId, activeId: '', conversations: [] }
    const activeId = store.sessionIdFor(paper)
    const archived = archivedSet(paper)
    const customTitles = paper.conversationTitles ?? {}
    const conversations: ChatConversation[] = []
    for (const id of sessionIdsOf(paper)) {
      const meta = await sessionMeta(id)
      const custom = customTitles[id]?.trim()
      conversations.push({
        id,
        title: custom || meta.title || '新对话',
        active: id === activeId,
        archived: archived.has(id),
        ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
        ...(typeof meta.messageCount === 'number' ? { messageCount: meta.messageCount } : {}),
      })
    }
    return { paperId, activeId, conversations }
  }

  /** Start over: retire the active session and point the paper at a new one. */
  async function newConversation(paperId: string): Promise<ChatResetResult> {
    const paper = requirePaper(paperId)
    const retired = store.sessionIdFor(paper)
    const live = agents()?.get(retired)
    if (live?.status === 'running') {
      throw Object.assign(new Error('等这一轮回答结束再新建对话'), { status: 409 })
    }
    // Drop the live agent first: its handle keeps the old log open.
    await forget(retired)
    const sessionId = `pr-${paper.id}-${randomUUID().slice(0, 8)}`
    const retiredSessions = [...(paper.retiredSessions ?? []), retired].slice(-20)
    // The old log is never deleted; when the sidebar is off it is archived, and
    // when it is on it stays visible in the paper's own workspace group.
    await store.updatePaper(paper.id, {
      sessionId,
      retiredSessions,
      archivedConversations: (paper.archivedConversations ?? []).filter((id) => id !== retired),
    })
    if (store.config.paperSessionInSidebar !== true) await setArchived(retired, true)
    return { sessionId, retired }
  }

  async function createConversation(paperId: string): Promise<ChatConversationList> {
    await newConversation(paperId)
    return conversationList(paperId)
  }

  /** Switch the active session: the previous one joins the history list. */
  async function selectConversation(paperId: string, sessionId: string): Promise<ChatConversationList> {
    const paper = requirePaper(paperId)
    if (!validSession(paper, sessionId)) {
      throw Object.assign(new Error('这条对话不属于这篇论文'), { status: 404 })
    }
    const activeId = store.sessionIdFor(paper)
    if (activeId === sessionId) return conversationList(paperId)
    const live = agents()?.get(activeId)
    if (live?.status === 'running') {
      throw Object.assign(new Error('等这一轮回答结束再切换对话'), { status: 409 })
    }
    await forget(activeId)
    const retired = new Set(paper.retiredSessions ?? [])
    retired.delete(sessionId)
    retired.add(activeId)
    const retiredSessions = [...retired].slice(-20)
    const archivedConversations = (paper.archivedConversations ?? []).filter((id) => id !== sessionId)
    await store.updatePaper(paper.id, { sessionId, retiredSessions, archivedConversations })
    if (store.config.paperSessionInSidebar !== true) await setArchived(activeId, true)
    await joinGroup(sessionId, paper)
    return conversationList(paperId)
  }

  async function renameConversation(
    paperId: string,
    sessionId: string,
    title: string,
  ): Promise<ChatConversationList> {
    const paper = requirePaper(paperId)
    if (!validSession(paper, sessionId)) {
      throw Object.assign(new Error('这条对话不属于这篇论文'), { status: 404 })
    }
    const cleaned = truncate(String(title ?? '').replace(/\s+/g, ' ').trim(), 60)
    const conversationTitles = { ...(paper.conversationTitles ?? {}) }
    if (cleaned) conversationTitles[sessionId] = cleaned
    else delete conversationTitles[sessionId]
    await store.updatePaper(paper.id, { conversationTitles })
    if (cleaned) nameSessionWith(sessionId, cleaned)
    return conversationList(paperId)
  }

  async function archiveConversation(paperId: string, sessionId: string): Promise<ChatConversationList> {
    const paper = requirePaper(paperId)
    if (!validSession(paper, sessionId)) {
      throw Object.assign(new Error('这条对话不属于这篇论文'), { status: 404 })
    }
    if (sessionId === store.sessionIdFor(paper)) {
      throw Object.assign(new Error('当前对话不能归档，先新建一条对话'), { status: 409 })
    }
    const archivedConversations = [...new Set([...(paper.archivedConversations ?? []), sessionId])]
    await store.updatePaper(paper.id, { archivedConversations })
    await setArchived(sessionId, true)
    return conversationList(paperId)
  }

  async function unarchiveConversation(paperId: string, sessionId: string): Promise<ChatConversationList> {
    const paper = requirePaper(paperId)
    if (!validSession(paper, sessionId)) {
      throw Object.assign(new Error('这条对话不属于这篇论文'), { status: 404 })
    }
    const archivedConversations = (paper.archivedConversations ?? []).filter((id) => id !== sessionId)
    await store.updatePaper(paper.id, { archivedConversations })
    if (store.config.paperSessionInSidebar === true) {
      await joinGroup(sessionId, paper)
      await setArchived(sessionId, false)
    }
    return conversationList(paperId)
  }

  async function reset(paperId: string): Promise<ChatResetResult> {
    return newConversation(paperId)
  }

  const { setArchived, syncSidebar, joinGroup, dropWorkspace } = createPaperWorkspaces({
    store,
    log,
    registry: workspace,
    persistence,
    sessionIdsOf,
    archivedSet,
    forget,
  })

  async function release(paperId: string): Promise<void> {
    const paper = store.getPaper(paperId)
    if (!paper) return
    await forget(store.sessionIdFor(paper))
  }

  async function disposeAll(): Promise<void> {
    const ids = [...live.keys()]
    for (const id of ids) await forget(id)
  }

  return {
    available: () => Boolean(agents() && presets()),
    active: () => [...activeTurns.values()],
    // Translation is deliberately stateless: it never enters a session and
    // never waits behind one.
    stream: (input, sink, signal) => {
      const turn: ChatActivity = {
        paperId: input.paperId,
        kind: input.kind,
        startedAt: nowIso(),
      }
      activeTurns.set(input.paperId, turn)
      const paper = store.getPaper(input.paperId)
      const detail = input.kind === 'translate'
        ? '翻译选中片段'
        : input.kind === 'explain'
          ? '解释选中片段'
          : '正在回答'
      const handle = tasks?.begin({
        kind: 'chat',
        title: paper?.title || '论文',
        paperId: input.paperId,
        detail,
        state: 'running',
        // One row per question would flood the history, but the live row and
        // its in-flight token count are still useful.
        archive: false,
      })
      let failure: string | null = null
      const trackedSink: ChatSink = handle
        ? {
            delta: (text) => sink.delta(text),
            done: (payload) => sink.done(payload),
            error: (message) => {
              failure = message
              sink.error(message)
            },
            get closed() {
              return sink.closed
            },
          }
        : sink
      const execute = () => (input.kind === 'translate'
        ? runOneShot(input, trackedSink, signal)
        : enqueue(input.paperId, () => runTurn(input, trackedSink, signal)))
      const run = handle && tasks ? tasks.run(handle.id, execute) : execute()
      return run.finally(() => {
        if (activeTurns.get(input.paperId) === turn) activeTurns.delete(input.paperId)
        if (handle) {
          const canceled = Boolean(signal?.aborted) || failure === '已取消'
          handle.finish({
            state: canceled ? 'canceled' : failure ? 'failed' : 'done',
            detail: canceled ? '已取消' : failure ? '失败' : '完成',
            ...(failure && !canceled ? { error: failure } : {}),
          })
        }
      })
    },
    history,
    contextUsage,
    route: async (paperId) => {
      const paper = store.getPaper(paperId)
      return paper ? currentRoute(paper) : null
    },
    models,
    setModel,
    compact: (paperId) => enqueue(paperId, () => compact(paperId)),
    reset: (paperId) => enqueue(paperId, () => reset(paperId)),
    conversations: (paperId) => conversationList(paperId),
    createConversation: (paperId) => enqueue(paperId, () => createConversation(paperId)),
    selectConversation: (paperId, sessionId) =>
      enqueue(paperId, () => selectConversation(paperId, sessionId)),
    renameConversation: (paperId, sessionId, title) =>
      enqueue(paperId, () => renameConversation(paperId, sessionId, title)),
    archiveConversation: (paperId, sessionId) =>
      enqueue(paperId, () => archiveConversation(paperId, sessionId)),
    unarchiveConversation: (paperId, sessionId) =>
      enqueue(paperId, () => unarchiveConversation(paperId, sessionId)),
    dropWorkspace,
    syncSidebar,
    release,
    disposeAll,
  }
}
