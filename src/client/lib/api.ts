/** HTTP client for the host half. Every network call in the UI goes through here. */

import type {
  Annotation,
  AppConfig,
  ChatConversationList,
  ChatHistoryPayload,
  ChatModelCatalog,
  ChatResetResult,
  ChatRoute,
  CompactResult,
  EdgeView,
  Folder,
  GlobalEdge,
  Job,
  LibraryPayload,
  LibrarySearchPayload,
  ModelCatalog,
  Paper,
  PaperDetail,
  PaperMetadataPatch,
  PaperSearchPayload,
  PageText,
  RelationGraph,
  RelationInsight,
  RelationEdge,
  SearchHit,
  Summary,
  SummaryEdit,
  TasksPayload,
  TranslationBlockInput,
  TranslationCommitResult,
  TranslationDocument,
  TranslationModelList,
  TranslationPagePayload,
  TranslationRuntime,
  TranslationStatus,
  TranslationTestResult,
  UsagePayload,
} from '../types.js'
import { API_BASE } from '../../shared/constants.js'

export const BASE = API_BASE

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, status: number, code = 'ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Requests retry a few times when the host answers 404/503 *without* JSON:
 * that is the harness fallback replying before the plugin finished mounting,
 * not a real routing decision. Real 404s (missing paper) come back as JSON and
 * are not retried.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const attempts = method === 'GET' ? 4 : 1
  let response: Response | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const type = response.headers.get('content-type') ?? ''
    const startupMiss = (response.status === 404 || response.status === 503) && !type.includes('json')
    if (startupMiss && attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
      continue
    }
    break
  }
  if (!response) throw new ApiError('请求失败', 0, 'NO_RESPONSE')
  const type = response.headers.get('content-type') ?? ''
  const body = type.includes('json') ? await response.json().catch(() => null) : await response.text()
  if (!response.ok) {
    const message = body?.error?.message ?? `请求失败（${response.status}）`
    throw new ApiError(message, response.status, body?.error?.code ?? 'ERROR')
  }
  return body as T
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export type { LibraryPayload }

/** Folder view: the tree in sibling order, plus the two unfiled/trash totals. */
export type FolderListPayload = { folders: Folder[]; unfiled: number; trash: number }

export const api = {
  library: (params: {
    q?: string
    status?: string
    tag?: string
    folder?: string
    author?: string
    year?: number
    venue?: string
    sort?: string
  } = {}) => {
    const search = new URLSearchParams()
    if (params.q) search.set('q', params.q)
    if (params.status && params.status !== 'all') search.set('status', params.status)
    if (params.tag) search.set('tag', params.tag)
    if (params.folder) search.set('folder', params.folder)
    if (params.author) search.set('author', params.author)
    if (params.year) search.set('year', String(params.year))
    if (params.venue) search.set('venue', params.venue)
    if (params.sort) search.set('sort', params.sort)
    const suffix = search.toString()
    return request<LibraryPayload>(`/papers${suffix ? `?${suffix}` : ''}`)
  },

  folders: () => request<FolderListPayload>('/folders'),

  addFolder: (name: string, parentId: string | null = null) => request<Folder>('/folders', json({ name, parentId })),

  renameFolder: (id: string, name: string) =>
    request<Folder>(`/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  /** Drop into `parentId`, immediately before `beforeId`; null appends last. */
  moveFolder: (id: string, parentId: string | null, beforeId: string | null) =>
    request<FolderListPayload>(`/folders/${encodeURIComponent(id)}/move`, json({ parentId, beforeId })),

  removeFolder: (id: string) =>
    request<{ ok: boolean; removed: string[] }>(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  reindex: () =>
    request<{ papers: number; chunks: number; notes: number }>('/maintenance/reindex', { method: 'POST' }),

  missing: () => request<{ papers: Paper[] }>('/maintenance/missing'),

  cleanMissing: () =>
    request<{ removed: string[]; count: number }>('/maintenance/clean-missing', { method: 'POST' }),

  paper: (id: string) => request<PaperDetail>(`/papers/${encodeURIComponent(id)}`),

  /** The paper's conversation, projected from its DSH session log. */
  chat: (id: string) => request<ChatHistoryPayload>(`/papers/${encodeURIComponent(id)}/chat`),

  /** Models this profile can route to, with each one's reasoning efforts. */
  chatModels: (id: string) =>
    request<ChatModelCatalog>(`/papers/${encodeURIComponent(id)}/models`),

  /** Switch this paper's conversation to another model/effort. */
  setChatModel: (id: string, route: ChatRoute) =>
    request<ChatRoute>(`/papers/${encodeURIComponent(id)}/model`, json(route)),

  compact: (id: string) =>
    request<CompactResult>(`/papers/${encodeURIComponent(id)}/compact`, { method: 'POST' }),

  /** Drop the conversation and start a fresh session for this paper. */
  resetChat: (id: string) =>
    request<ChatResetResult>(`/papers/${encodeURIComponent(id)}/reset`, { method: 'POST' }),

  /** Active conversation first, then every older transcript on disk. */
  conversations: (id: string) =>
    request<ChatConversationList>(`/papers/${encodeURIComponent(id)}/conversations`),

  newConversation: (id: string) =>
    request<ChatConversationList>(`/papers/${encodeURIComponent(id)}/conversations`, { method: 'POST' }),

  selectConversation: (id: string, sessionId: string) =>
    request<ChatConversationList>(
      `/papers/${encodeURIComponent(id)}/conversations/${encodeURIComponent(sessionId)}/select`,
      { method: 'POST' },
    ),

  renameConversation: (id: string, sessionId: string, title: string) =>
    request<ChatConversationList>(
      `/papers/${encodeURIComponent(id)}/conversations/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', body: JSON.stringify({ title }) },
    ),

  archiveConversation: (id: string, sessionId: string) =>
    request<ChatConversationList>(
      `/papers/${encodeURIComponent(id)}/conversations/${encodeURIComponent(sessionId)}/archive`,
      { method: 'POST' },
    ),

  unarchiveConversation: (id: string, sessionId: string) =>
    request<ChatConversationList>(
      `/papers/${encodeURIComponent(id)}/conversations/${encodeURIComponent(sessionId)}/unarchive`,
      { method: 'POST' },
    ),

  page: (id: string, page: number) =>
    request<PageText>(`/papers/${encodeURIComponent(id)}/pages/${page}`),

  /** Full-text translation cache state for this paper. */
  translation: (id: string) =>
    request<TranslationStatus>(`/papers/${encodeURIComponent(id)}/translation`),

  /** Parsed geometry + translated blocks for one page, in one round-trip. */
  translationPage: (id: string, page: number) =>
    request<TranslationPagePayload>(`/papers/${encodeURIComponent(id)}/translation/pages/${page}`),

  /** The whole paper, for the continuous reflowed view. */
  translationDocument: (id: string) =>
    request<TranslationDocument>(`/papers/${encodeURIComponent(id)}/translation/document`),

  /** Effective translation source, engine and key status for the settings page. */
  translationSources: () => request<TranslationRuntime>('/translation/sources'),

  /** Model discovery for an OpenAI-compatible endpoint. */
  translationModels: (target: 'api' | 'local') =>
    request<TranslationModelList>(`/translation/models?target=${target}`),

  /** Send one short sample through the configured engine. */
  testTranslation: () =>
    request<TranslationTestResult>('/translation/test', { method: 'POST' }),

  /** Store or clear one translation API key in the harness credential store. */
  setTranslationKey: (provider: string, value: string) =>
    request<{ keys: Record<string, boolean> }>('/translation/key', json({ provider, value })),

  /** The browser page commits translations it produced with the built-in Translator. */
  commitTranslation: (id: string, page: number, blocks: TranslationBlockInput[]) =>
    request<TranslationCommitResult>(
      `/papers/${encodeURIComponent(id)}/translation/blocks`,
      json({ page, blocks }),
    ),

  startTranslation: (id: string, input: { pages?: number[]; force?: boolean } = {}) =>
    request<TranslationStatus>(`/papers/${encodeURIComponent(id)}/translation`, json({ action: 'start', ...input })),

  cancelTranslation: (id: string) =>
    request<TranslationStatus>(`/papers/${encodeURIComponent(id)}/translation`, json({ action: 'cancel' })),

  /** Exact matches in this paper's parsed full text, in page order. */
  paperSearch: (id: string, query: string, options: { limit?: number; signal?: AbortSignal } = {}) => {
    const search = new URLSearchParams({ q: query, limit: String(options.limit ?? 50) })
    return request<PaperSearchPayload>(
      `/papers/${encodeURIComponent(id)}/search?${search.toString()}`,
      options.signal ? { signal: options.signal } : undefined,
    )
  },

  patchPaper: (
    id: string,
    patch: Partial<Omit<Paper, 'title' | 'authors' | 'year' | 'venue' | 'pmid'>>
      & PaperMetadataPatch
      & { lastRead?: { page: number; scrollTop: number } },
  ) =>
    request<Paper>(`/papers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Soft delete: the paper moves to the recycle bin and can be restored. */
  trashPaper: (id: string) =>
    request<{ ok: boolean; deletedAt?: string }>(`/papers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Hard delete: drops the record, its PDF and its annotations. */
  purgePaper: (id: string) =>
    request<{ ok: boolean }>(`/papers/${encodeURIComponent(id)}?permanent=1`, { method: 'DELETE' }),

  restorePaper: (id: string) =>
    request<Paper>(`/papers/${encodeURIComponent(id)}/restore`, { method: 'POST' }),

  emptyTrash: () =>
    request<{ ok: boolean; removed: string[]; count: number }>('/trash', { method: 'DELETE' }),

  annotations: (id: string) =>
    request<{ annotations: Annotation[] }>(`/papers/${encodeURIComponent(id)}/annotations`),

  addAnnotation: (id: string, input: {
    page: number
    rects: number[][]
    quote: string
    prefix?: string
    suffix?: string
    color: string
  }) => request<Annotation>(`/papers/${encodeURIComponent(id)}/annotations`, json(input)),

  patchAnnotation: (id: string, annotationId: string, patch: { color?: string; note?: string }) =>
    request<Annotation>(`/papers/${encodeURIComponent(id)}/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeAnnotation: (id: string, annotationId: string) =>
    request<{ ok: boolean }>(`/papers/${encodeURIComponent(id)}/annotations/${annotationId}`, { method: 'DELETE' }),

  addNote: (id: string, input: { body: string; page?: number }) =>
    request<Annotation>(`/papers/${encodeURIComponent(id)}/notes`, json(input)),

  importPdf: async (file: File, folder: string | null = null) => {
    const query = `name=${encodeURIComponent(file.name)}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`
    const response = await fetch(`${BASE}/import/pdf?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: file,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new ApiError(body?.error?.message ?? '导入失败', response.status)
    return body as { jobId: string; fileName: string }
  },

  importLink: (url: string, folder: string | null = null) =>
    request<{ jobId: string; url: string }>('/import', json({ url, folder })),

  attachPdf: async (paperId: string, file: File) => {
    const response = await fetch(
      `${BASE}/papers/${encodeURIComponent(paperId)}/attach?name=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: file,
      },
    )
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw new ApiError(body?.error?.message ?? '上传失败', response.status, body?.error?.code ?? 'ERROR')
    }
    return body as { jobId: string; fileName: string }
  },

  importFile: (path: string, folder: string | null = null) =>
    request<{ jobId: string; filePath: string }>('/import/file', json({ path, folder })),

  jobs: () => request<{ jobs: Job[] }>('/jobs'),

  /** Active tasks plus durable history; `kind/state/q/from/to` filter history. */
  tasks: (params: {
    kind?: string
    state?: string
    q?: string
    from?: string
    to?: string
    offset?: number
    limit?: number
    signal?: AbortSignal
  } = {}) => {
    const search = new URLSearchParams()
    for (const key of ['kind', 'state', 'q', 'from', 'to'] as const) {
      const value = params[key]
      if (value) search.set(key, value)
    }
    if (params.offset) search.set('offset', String(params.offset))
    if (params.limit) search.set('limit', String(params.limit))
    const suffix = search.toString()
    return request<TasksPayload>(`/tasks${suffix ? `?${suffix}` : ''}`, { signal: params.signal })
  },

  job: (id: string) => request<Job>(`/jobs/${id}`),

  search: (query: string, options: { limit?: number; rerank?: boolean } = {}) =>
    request<{ query: string; hits: SearchHit[]; reranked: boolean }>('/search', json({ query, ...options })),

  /** Paper-level library search: metadata + notes + full text, no model call. */
  searchPapers: (query: string, options: { limit?: number; signal?: AbortSignal } = {}) => {
    const search = new URLSearchParams({ q: query })
    if (options.limit) search.set('limit', String(options.limit))
    return request<LibrarySearchPayload>(
      `/search/papers?${search.toString()}`,
      options.signal ? { signal: options.signal } : undefined,
    )
  },

  relations: (id: string) => request<{ paperId: string; edges: EdgeView[] }>(`/relations/${id}`),

  allRelations: () => request<{ edges: GlobalEdge[] }>('/relations'),

  /** Nodes, edges, clusters and stats for the relation page. */
  relationGraph: (params: { focus?: string; depth?: number; limit?: number } = {}) => {
    const search = new URLSearchParams()
    if (params.focus) search.set('focus', params.focus)
    if (params.depth) search.set('depth', String(params.depth))
    if (params.limit) search.set('limit', String(params.limit))
    const suffix = search.toString()
    return request<RelationGraph>(`/relations/graph${suffix ? `?${suffix}` : ''}`)
  },

  relationInsight: (paperId: string, refresh = false) =>
    request<{ insight: RelationInsight | null }>(
      `/relations/insights/${encodeURIComponent(paperId)}${refresh ? '?refresh=1' : ''}`,
    ),

  rebuildRelations: (scope?: string) =>
    request<{ jobId: string }>('/relations/rebuild', json({ scope })),

  relationFeedback: (input: { from: string; to: string; kind: string; action: 'accept' | 'reject' | 'pin' | 'delete' }) =>
    request<{ ok: boolean; edge: RelationEdge | null }>('/relations/feedback', json(input)),

  removeRelation: (from: string, to: string, kind: string) =>
    request<{ ok: boolean }>('/relations/remove', json({ from, to, kind })),

  config: () => request<AppConfig>('/config'),

  /** Daily token usage for the settings matrix; `from`/`to` are inclusive local dates. */
  usage: (params: { from?: string; to?: string } = {}) => {
    const search = new URLSearchParams()
    if (params.from) search.set('from', params.from)
    if (params.to) search.set('to', params.to)
    const suffix = search.toString()
    return request<UsagePayload>(`/usage${suffix ? `?${suffix}` : ''}`)
  },

  models: () => request<ModelCatalog>('/models'),

  saveConfig: (patch: Partial<AppConfig>) => request<AppConfig>('/config', json(patch)),

  scan: () => request<{ scanned: number; added: number; jobs: string[] }>('/scan', { method: 'POST' }),

  summarize: (id: string) =>
    request<{ summary: Summary; edges: unknown[]; warning?: string }>(
      `/papers/${encodeURIComponent(id)}/summarize`,
      { method: 'POST' },
    ),

  /** Save manual edits to an existing guide; generation metadata is preserved. */
  updateSummary: (id: string, patch: SummaryEdit) =>
    request<{ summary: Summary }>(`/papers/${encodeURIComponent(id)}/summary`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
}

export interface StreamHandlers {
  onDelta: (text: string) => void
  onDone: (payload: { citations?: number[] }) => void
  onError: (message: string) => void
}

/**
 * POST + SSE. EventSource cannot POST, and the answer needs a body, so the
 * stream is parsed off `fetch`'s ReadableStream.
 */
export async function askStream(
  payload: {
    paperId: string
    kind: 'ask' | 'explain' | 'translate'
    question?: string
    quote?: string
    page?: number
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') return
    handlers.onError((error as Error).message)
    return
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null)
    handlers.onError(body?.error?.message ?? `请求失败（${response.status}）`)
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // A stream can end without a `done` frame (host restart, agent crash, proxy
  // timeout). Without this flag `busy` stayed true until the page reloaded.
  let settled = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const chunk = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          let event: any
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (event.type === 'delta') handlers.onDelta(event.text)
          else if (event.type === 'done') {
            settled = true
            handlers.onDone({ citations: event.citations })
          } else if (event.type === 'error') {
            settled = true
            handlers.onError(event.message)
          }
        }
        index = buffer.indexOf('\n\n')
      }
    }
    if (!settled) {
      settled = true
      handlers.onError('回答流中断了，请重试')
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      settled = true
      handlers.onError((error as Error).message)
    }
  }
}

/** Job progress: SSE with an immediate snapshot, no reconnect games. */
export function watchJob(
  id: string,
  onJob: (job: Job) => void,
): () => void {
  let closed = false
  let source: EventSource | null = null

  void api.job(id).then((job) => {
    if (!closed) onJob(job)
    if (closed || job.state === 'done' || job.state === 'failed') return
    source = new EventSource(`${BASE}/jobs/${id}/stream`)
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as Job
        onJob(next)
        if (next.state === 'done' || next.state === 'failed') {
          source?.close()
          source = null
        }
      } catch {
        /* ignore malformed frame */
      }
    }
    source.onerror = () => {
      source?.close()
      source = null
    }
  }).catch(() => {})

  return () => {
    closed = true
    source?.close()
    source = null
  }
}
