/**
 * Structural contracts shared by the chat service and its callers.
 *
 * Deliberately minimal: this plugin never imports DSH packages, it only uses
 * the slice of their contract described here.
 */
import type {
  ChatContextUsage,
  ChatConversationList,
  ChatHistoryPayload,
  ChatMode,
  ChatModelCatalog,
  ChatResetResult,
  ChatRoute,
  CompactResult,
} from '../../shared/domain.js'
import type { Store } from '../library/store.js'
import type { Indexer } from '../search/indexer.js'
import type { TaskCenter } from '../tasks/center.js'
import type { Summoner } from './summoner.js'
import type { UsageSample } from '../usage/ledger.js'

/** The preset declared in `cordis.patch.yml`. No tools, no skills, no plan. */
export const PAPER_PRESET = 'paper-reader'
/** The sidebar's root group: every paper folder nests under it. */
export const PAPER_WORKSPACE_TITLE = '论文阅读'

export type PaperChatMode = ChatMode | 'translate'

// ── structural types for the harness services ──────────────────────────────
// Deliberately minimal: this plugin never imports DSH packages, it only uses
// the slice of their contract described here.

export interface MessageSourceLike {
  kind: string
  [key: string]: unknown
}

export interface UserMessageLike {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: MessageSourceLike
}

export interface SessionLike {
  readonly id: string
  deriveMessages(): Array<{ role: string; content: Array<{ type: string; text?: string }>; source?: MessageSourceLike }>
}

export interface AgentLike {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly session: SessionLike
  readonly ctx: unknown
  readonly options?: { provider?: string; model?: string }
  /** The loop's own model seat; the recorded selection wins over `options`. */
  readonly model?: AgentModelLike
  /** Pending input queues; read to avoid re-queuing context a failed turn left behind. */
  readonly inbox?: {
    readonly nextTurn?: readonly UserMessageLike[]
    readonly nextStep?: readonly UserMessageLike[]
    remove?(id: string): boolean
  }
  followup(message: UserMessageLike): void
  /** Model-facing context that does not wake the driver. */
  inject(message: UserMessageLike): void
  cancel(cause: unknown, options?: { keepInbox?: boolean }): void
  whenIdle(): Promise<void>
}

export interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

/** `agent.model`: read the recorded selection, record a new one. */
export interface AgentModelLike {
  current?(): ChatRoute | undefined
  select?(selection: ChatRoute): void
}

/** The slice of the harness `llm` registry the model menu reads. */
export interface LlmLike {
  listProviders?(): Array<{ id: string; name?: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
  resolveModelInfo?(provider: string, model: string): Promise<{
    reasoning?: {
      efforts?: Array<{ id: string; name?: string; description?: string }>
      defaultEffort?: string
    }
  }>
  /** Rejects an effort this exact model does not support. */
  resolveCallConfig?(config: ChatRoute): Promise<unknown>
}

export interface AgentsServiceLike {
  create(options: Record<string, unknown>): Promise<AgentHandleLike>
  resume(options: Record<string, unknown>): Promise<AgentHandleLike>
  get(id: string): AgentLike | undefined
}

export interface AgentPresetsServiceLike {
  mount(ctx: unknown, id: string): Promise<unknown>
  serviceFor(agent: { ctx: unknown }, name: string): unknown
}

export interface SessionPersistenceLike {
  list(): Promise<Array<{ header: SessionHeaderLike }>>
  stat(id: string): Promise<{ header: SessionHeaderLike } | undefined>
}

/** Only the header fields the history list reads; all optional but `id`. */
export interface SessionHeaderLike {
  id: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
  title?: string
}

export interface SessionQueryLike {
  readSurface(id: string): Promise<{ events: Array<{ type: string; data: any }> }>
  /** Folded session title, when this profile's query service exposes it. */
  readTitle?(id: string): Promise<{ title?: unknown; value?: unknown } | undefined>
}

export interface TokenMeterLike {
  contextPressure(session: SessionLike): { pressureTokens?: number; contextWindow?: number } | undefined
}

export interface CompactionServiceLike {
  compactNow(agent: unknown, signal: AbortSignal): Promise<{
    shadowedSeqs?: readonly unknown[]
    shadowedTokenCount?: number
  } | null>
}

export interface WorkspaceLike {
  id: string
  path?: string
  /** Stored `sessionIds`; membership has to be recorded, not just implied by cwd. */
  readonly sessionIds?: readonly string[]
  attachSession?(sessionId: string): Promise<void>
  /** Remove one accounted session from this group (used when a paper is deleted). */
  detachSession?(sessionId: string): Promise<void>
}

export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<WorkspaceLike>
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>
  /** Registered workspaces (used to clean up groups for deleted papers). */
  list?(): WorkspaceLike[]
  delete(id: string): Promise<boolean>
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

export interface SessionTitleLike {
  rename(session: SessionLike, title: string): unknown
}

/**
 * Everything the chat service needs from the Cordis context.
 *
 * Kept as two closures instead of a service map so tests can drive the service
 * with plain stubs and so a profile missing half these services still works.
 */
export interface ChatBridge {
  /** `ctx.get(name)` — `undefined` when this profile does not mount it. */
  service(name: string): unknown
  /** `ctx.on(name, listener)`; returns the disposer. */
  on(event: string, listener: (payload: any) => void): () => void
}

export interface ChatSink {
  delta(text: string): void
  done(payload: { citations: number[] }): void
  error(message: string): void
  readonly closed: boolean
}

export interface AskStreamInput {
  paperId: string
  kind: PaperChatMode
  question: string
  quote?: string
  page?: number
}

/** One conversation turn that has not settled yet. */
export interface ChatActivity {
  paperId: string
  kind: PaperChatMode
  startedAt: string
}

export interface PaperChat {
  /** Whether this profile can host sessions (agents + preset registry mounted). */
  available(): boolean
  /** Stream one turn into the sink; resolves when the turn is over. */
  stream(input: AskStreamInput, sink: ChatSink, signal?: AbortSignal): Promise<void>
  /** Turns that are running right now, for the task page. */
  active(): ChatActivity[]
  history(paperId: string): Promise<ChatHistoryPayload>
  contextUsage(paperId: string): Promise<ChatContextUsage | null>
  /** The route this paper's conversation runs on, or the default it would use. */
  route(paperId: string): Promise<ChatRoute | null>
  /** Models this profile can route to, with each one's reasoning efforts. */
  models(paperId: string): Promise<ChatModelCatalog>
  /** Record a per-paper route; applies from the next step. */
  setModel(paperId: string, route: ChatRoute): Promise<ChatRoute>
  compact(paperId: string): Promise<CompactResult>
  /**
   * Drop the conversation: retire this paper's session and point the record at a
   * fresh one. The old log stays on disk, like closing a tab.
   */
  reset(paperId: string): Promise<ChatResetResult>
  /** This paper's active conversation plus every older one still on disk. */
  conversations(paperId: string): Promise<ChatConversationList>
  /** Start a fresh conversation (the old one becomes history). */
  createConversation(paperId: string): Promise<ChatConversationList>
  /** Make an older conversation the active one again. */
  selectConversation(paperId: string, sessionId: string): Promise<ChatConversationList>
  /** Give one conversation a display title; stored on the paper record. */
  renameConversation(paperId: string, sessionId: string, title: string): Promise<ChatConversationList>
  /** Hide a conversation from the normal history list; the log is kept. */
  archiveConversation(paperId: string, sessionId: string): Promise<ChatConversationList>
  /** Put an archived conversation back into the history list. */
  unarchiveConversation(paperId: string, sessionId: string): Promise<ChatConversationList>
  /** Remove the sidebar workspace group owned by one paper (on delete). */
  dropWorkspace(paperId: string): Promise<void>
  /** Archive/unarchive every paper session and register/remove the sidebar group. */
  syncSidebar(enabled: boolean): Promise<void>
  /** Drop the live agent for one paper (its log stays on disk). */
  release(paperId: string): Promise<void>
  disposeAll(): Promise<void>
}

export interface PaperChatDeps {
  store: Store
  indexer: Indexer
  summoner: Summoner
  bridge: ChatBridge
  /** One-shot plan builder, used for translation and as the fallback. */
  buildAsk: (input: { paperId: string; question: string; quote?: string; page?: number; kind: PaperChatMode }) => Promise<{
    temperature: number
    maxTokens: number
    system: string
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: Array<{ type: 'text'; text: string }> }>
    citations: Array<{ page: number }>
  } | null>
  log: (message: string, error?: unknown) => void
  /** Receives one usage sample per committed/abandoned model attempt. */
  recordUsage?: (sample: UsageSample) => void
  /** Live-only task row for the task list (chat turns are not archived). */
  tasks?: TaskCenter
}
