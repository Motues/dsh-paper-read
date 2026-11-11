/**
 * Paper conversations, owned by the workspace instead of the reader.
 *
 * A conversation is a DSH session on the host; this module is only its live
 * projection plus the in-flight answer. Keeping it outside the component tree
 * matters because switching tabs unmounts the reader: if the stream lived in
 * that component, leaving the tab would abort the host turn. Here the stream
 * keeps running, and the reader re-subscribes to the same store when its tab
 * comes back.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, askStream } from './api.js'
import type {
  ChatContextUsage,
  ChatConversation,
  ChatMessage,
  ChatRoute,
  CompactResult,
} from '../types.js'

export interface ChatSnapshot {
  messages: ChatMessage[]
  context: ChatContextUsage | null
  route: ChatRoute | null
  busy: boolean
  loaded: boolean
  /** This paper's conversations: active first, then its history. */
  conversations: ChatConversation[]
  conversationsLoaded: boolean
  /** Transient failure for a toast; `at` lets the reader react only once. */
  error: { message: string; at: number } | null
}

interface ChatStore {
  snapshot: ChatSnapshot
  listeners: Set<() => void>
  loading: Promise<void> | null
}

export interface ChatInput {
  kind: 'ask' | 'explain' | 'translate'
  question?: string
  quote?: string
  page?: number
}

const stores = new Map<string, ChatStore>()
let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`

function emptySnapshot(): ChatSnapshot {
  return {
    messages: [],
    context: null,
    route: null,
    busy: false,
    loaded: false,
    conversations: [],
    conversationsLoaded: false,
    error: null,
  }
}

function storeFor(paperId: string): ChatStore {
  let store = stores.get(paperId)
  if (!store) {
    store = { snapshot: emptySnapshot(), listeners: new Set(), loading: null }
    stores.set(paperId, store)
  }
  return store
}

function emit(store: ChatStore): void {
  for (const listener of store.listeners) listener()
}

function apply(store: ChatStore, patch: Partial<ChatSnapshot>): void {
  store.snapshot = { ...store.snapshot, ...patch }
  emit(store)
}

function ensureLoaded(store: ChatStore, paperId: string): Promise<void> {
  if (store.snapshot.loaded) return Promise.resolve()
  if (store.loading) return store.loading
  store.loading = Promise.all([
    api.chat(paperId),
    api.conversations(paperId).catch(() => null),
  ])
    .then(([history, list]) => {
      apply(store, {
        messages: history.messages,
        context: history.context,
        route: history.route,
        loaded: true,
        ...(list
          ? { conversations: list.conversations, conversationsLoaded: true }
          : {}),
      })
    })
    .catch((error) => {
      // Leave `loaded` false so the next mount retries a host that was still
      // starting when the reader first asked for the transcript.
      apply(store, {
        loaded: false,
        error: { message: (error as Error).message, at: Date.now() },
      })
    })
    .finally(() => {
      store.loading = null
    })
  return store.loading
}

/** Replace transcript + meter with the host's canonical projection. */
function reload(store: ChatStore, paperId: string): Promise<void> {
  return Promise.all([
    api.chat(paperId),
    api.conversations(paperId).catch(() => null),
  ]).then(([history, list]) => {
    apply(store, {
      messages: history.messages,
      context: history.context,
      route: history.route,
      loaded: true,
      ...(list
        ? { conversations: list.conversations, conversationsLoaded: true }
        : {}),
    })
  }).catch(() => {})
}

/** Refresh only the conversation list; the transcript is left untouched. */
function reloadConversations(store: ChatStore, paperId: string): Promise<void> {
  return api.conversations(paperId)
    .then((list) => {
      apply(store, { conversations: list.conversations, conversationsLoaded: true })
    })
    .catch(() => {})
}

function send(store: ChatStore, paperId: string, input: ChatInput): void {
  if (store.snapshot.busy) return
  const user: ChatMessage = {
    id: nextId('u'),
    role: 'user',
    text: input.question ?? '',
    quote: input.quote,
    page: input.page,
    mode: input.kind === 'translate' ? undefined : input.kind,
  }
  const pendingId = nextId('pending')
  apply(store, {
    busy: true,
    error: null,
    messages: [
      ...store.snapshot.messages,
      user,
      { id: pendingId, role: 'assistant', text: '' },
    ],
  })

  void askStream(
    { paperId, kind: input.kind, question: input.question, quote: input.quote, page: input.page },
    {
      onDelta: (delta) => {
        apply(store, {
          messages: store.snapshot.messages.map((message) => (
            message.id === pendingId ? { ...message, text: message.text + delta } : message
          )),
        })
      },
      onDone: () => {
        apply(store, {
          busy: false,
          messages: store.snapshot.messages.map((message) => (
            message.id === pendingId ? { ...message, id: nextId('a') } : message
          )),
        })
        void api.chat(paperId).then((history) => {
          apply(store, { context: history.context, route: history.route })
        }).catch(() => {})
        // The first question also becomes this conversation's display title.
        void reloadConversations(store, paperId)
      },
      onError: (message) => {
        apply(store, {
          busy: false,
          error: { message, at: Date.now() },
          messages: store.snapshot.messages.filter((item) => item.id !== pendingId),
        })
      },
    },
  )
}

/**
 * Subscribe one reader to a paper's conversation. The store survives unmount,
 * so a stream started in one tab is still there when the tab is reopened.
 */
export function usePaperChat(paperId: string) {
  const store = useMemo(() => storeFor(paperId), [paperId])
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => storeFor(paperId).snapshot)

  useEffect(() => {
    const current = storeFor(paperId)
    const listener = () => setSnapshot(current.snapshot)
    current.listeners.add(listener)
    listener()
    void ensureLoaded(current, paperId)
    return () => {
      current.listeners.delete(listener)
    }
  }, [paperId])

  const sendQuestion = useCallback((input: ChatInput) => {
    send(store, paperId, input)
  }, [paperId, store])

  const compact = useCallback((): Promise<CompactResult> => (
    api.compact(paperId).then(async (result) => {
      await reload(store, paperId)
      return result
    }).catch((error) => {
      apply(store, { error: { message: (error as Error).message, at: Date.now() } })
      throw error
    })
  ), [paperId, store])

  const newConversation = useCallback(async (): Promise<void> => {
    const list = await api.newConversation(paperId)
    apply(store, {
      messages: [],
      context: null,
      busy: false,
      error: null,
      conversations: list.conversations,
      conversationsLoaded: true,
    })
  }, [paperId, store])

  /** Make an older conversation active again and load its transcript. */
  const switchConversation = useCallback(async (sessionId: string): Promise<void> => {
    const list = await api.selectConversation(paperId, sessionId)
    const history = await api.chat(paperId)
    apply(store, {
      messages: history.messages,
      context: history.context,
      route: history.route,
      busy: false,
      error: null,
      conversations: list.conversations,
      conversationsLoaded: true,
    })
  }, [paperId, store])

  const renameConversation = useCallback(async (sessionId: string, title: string): Promise<void> => {
    const list = await api.renameConversation(paperId, sessionId, title)
    apply(store, { conversations: list.conversations, conversationsLoaded: true })
  }, [paperId, store])

  const archiveConversation = useCallback(async (sessionId: string): Promise<void> => {
    const list = await api.archiveConversation(paperId, sessionId)
    apply(store, { conversations: list.conversations, conversationsLoaded: true })
  }, [paperId, store])

  const unarchiveConversation = useCallback(async (sessionId: string): Promise<void> => {
    const list = await api.unarchiveConversation(paperId, sessionId)
    apply(store, { conversations: list.conversations, conversationsLoaded: true })
  }, [paperId, store])

  const refresh = useCallback(() => reload(store, paperId), [paperId, store])

  const setRoute = useCallback((route: ChatRoute) => {
    apply(store, { route })
  }, [store])

  return {
    ...snapshot,
    send: sendQuestion,
    compact,
    newConversation,
    switchConversation,
    renameConversation,
    archiveConversation,
    unarchiveConversation,
    refresh,
    setRoute,
  }
}
