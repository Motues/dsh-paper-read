/**
 * Session-backed conversation checks, driven entirely by stubs.
 *
 * There is no harness in the test process, so `agents` / `agentPresets` /
 * `sessionPersistence` / `sessionQuery` / `workspaceRegistry` are small fakes
 * that record what the chat service asked them to do. That is enough to pin the
 * behaviour the plan cares about:
 *
 *   1. one session per paper, `resume` (not `create`) on the second question
 *   2. the request prefix of turn 2 is byte-identical to turn 1
 *   3. `start` / `text-delta` / `committed end` frames become `delta` / `done`
 *   4. `explain` enters the session, `translate` does not
 *   5. manual compaction reports removed turns and freed tokens
 *   6. the sidebar switch archives/unarchives existing sessions and owns its
 *      workspace group
 *   7. a profile without `agents` still answers through `llm.stream`
 *   8. the preset persona in `cordis.patch.yml` matches the code constant
 *   9. the model seat is per paper, validated, and survives a cold start
 *  10. clearing the context retires the session and starts a fresh one
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../dist/host/library/store.js'
import { createPaperChat, PAPER_PRESET } from '../dist/host/ai/chat.js'
import { PAPER_PERSONA } from '../dist/host/ai/persona.js'
import { createAskService } from '../dist/host/ai/ask.js'

const ROOT = path.resolve(import.meta.dirname, '..')

// ── harness stubs ──────────────────────────────────────────────────────────
class FakeSession {
  constructor(id) {
    this.id = id
    this.messages = []
    /** One entry per turn: the messages the model would have been sent. */
    this.requests = []
  }

  append(_type, data) {
    this.messages.push(data)
  }

  deriveMessages() {
    return this.messages.map((message) => ({
      role: message.role,
      content: message.content,
      source: message.source,
    }))
  }
}

function createHarness() {
  const listeners = new Map()
  const sessions = new Map()
  const live = new Map()
  const persisted = new Set()
  /** Session id → creation cwd; DSH validates workspace membership against it. */
  const cwdById = new Map()
  const calls = {
    create: [],
    resume: [],
    mounted: [],
    serviceFor: [],
    compactNow: [],
    workspace: [],
    archive: [],
    unarchive: [],
    attached: [],
    toolDeny: [],
    rename: [],
    modelSelect: [],
    resolveCall: [],
  }

  const emit = (name, payload) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(payload)
  }

  /** The agent-scoped context handed to `setup`: it exposes the tool registry. */
  const fakeAgentCtx = {
    get(name) {
      if (name !== 'tools') return undefined
      return {
        definitions: () => [{ name: 'alpha' }, { name: 'beta' }],
        restrict(filter) {
          calls.toolDeny.push(filter)
        },
      }
    },
  }

  /** A loop stand-in: one committed `assistant/message` per turn. */
  function makeAgent(id) {
    // A resume loads the existing log; only a create starts an empty one.
    const session = sessions.get(id) ?? new FakeSession(id)
    sessions.set(id, session)
    /** Queued `inject` messages, claimed at the next turn boundary. */
    const nextStep = []
    /** The loop's model seat: a recorded selection wins over agent options. */
    let selection = null
    let settle = () => {}
    let idle = Promise.resolve()

    const agent = {
      id,
      status: 'idle',
      session,
      ctx: {},
      model: {
        current: () => (selection === null ? undefined : { ...selection }),
        select(next) {
          selection = { ...next }
          calls.modelSelect.push({ id, ...next })
        },
      },
      inbox: {
        get nextTurn() {
          return []
        },
        get nextStep() {
          return [...nextStep]
        },
        remove(messageId) {
          const index = nextStep.findIndex((item) => item.id === messageId)
          if (index < 0) return false
          nextStep.splice(index, 1)
          return true
        },
      },
      /** `inject` lands in the next-step queue; the claim puts it before the prompt. */
      inject(message) {
        nextStep.push(message)
      },
      followup(message) {
        // The loop claims the whole next-step queue, then one next-turn prompt.
        const batch = [...nextStep.splice(0), message]
        for (const item of batch) session.append('user/message', item)
        session.requests.push(structuredClone(session.deriveMessages()))
        agent.status = 'running'
        idle = new Promise((resolve) => {
          settle = resolve
        })
        const question = message.content.map((block) => block.text).join('')
        const answer = `回答：${question.split('\n').find((line) => line.trim() !== '') ?? ''}`
        queueMicrotask(() => {
          emit('agent/assistant-stream', {
            agent,
            frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 },
          })
          const pieces = [answer.slice(0, 3), answer.slice(3)]
          for (const piece of pieces) {
            emit('agent/assistant-stream', {
              agent,
              frame: {
                type: 'chunk',
                attemptId: 'a1',
                revision: 1,
                index: 0,
                time: Date.now(),
                chunk: { type: 'text-delta', index: 0, text: piece },
              },
            })
          }
          session.messages.push({
            id: `m-${session.messages.length}`,
            role: 'assistant',
            content: [{ type: 'text', text: answer }],
            source: { kind: 'model', provider: 'test', model: 'test' },
          })
          emit('agent/assistant-stream', {
            agent,
            frame: {
              type: 'end',
              attemptId: 'a1',
              revision: 1,
              index: 2,
              outcome: { kind: 'committed', eventType: 'assistant/message', seq: session.messages.length },
            },
          })
          agent.status = 'idle'
          settle()
        })
      },
      cancel() {
        agent.status = 'idle'
        settle()
      },
      whenIdle: () => idle,
    }
    live.set(id, agent)
    return agent
  }

  const agents = {
    async create(options) {
      calls.create.push(options)
      persisted.add(options.sessionId)
      if (options.meta?.cwd) cwdById.set(options.sessionId, options.meta.cwd)
      if (options.setup) await options.setup(fakeAgentCtx)
      const agent = makeAgent(options.sessionId)
      return { agent, dispose: async () => live.delete(options.sessionId) }
    },
    async resume(options) {
      calls.resume.push(options)
      if (options.setup) await options.setup(fakeAgentCtx)
      const agent = makeAgent(options.resumeSessionId)
      return { agent, dispose: async () => live.delete(options.resumeSessionId) }
    },
    get: (id) => live.get(id),
  }

  const persistence = {
    async list() {
      return [...persisted].map((id) => ({ header: { id, cwd: cwdById.get(id) } }))
    },
    async stat(id) {
      return persisted.has(id) ? { header: { id, cwd: cwdById.get(id) } } : undefined
    },
  }

  const sessionQuery = {
    async readSurface(id) {
      const session = sessions.get(id)
      if (!session) throw new Error(`no session ${id}`)
      return {
        events: session.messages.map((message) => ({
          type: message.role === 'assistant' ? 'assistant/message' : 'user/message',
          data: message.role === 'assistant' ? { message } : message,
        })),
      }
    },
  }

  /**
   * A path-keyed workspace registry. `attachSession` mirrors DSH: the stored
   * session header cwd must equal the workspace directory, so a test that
   * attaches a session to the wrong folder fails loudly.
   */
  const workspaces = new Map()
  let nextWorkspaceId = 0
  const keyOf = (dir) => (process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir))
  const registry = {
    async create(dir, title) {
      calls.workspace.push({ op: 'create', dir, title })
      const key = keyOf(dir)
      let found = workspaces.get(key)
      if (!found) {
        found = {
          id: `ws-${++nextWorkspaceId}`,
          path: dir,
          title,
          sessionIds: [],
          async attachSession(sessionId) {
            if (cwdById.get(sessionId) !== dir) {
              throw new Error(`cannot attach ${sessionId}: cwd ${cwdById.get(sessionId)} != ${dir}`)
            }
            if (!this.sessionIds.includes(sessionId)) this.sessionIds.push(sessionId)
            calls.attached.push(sessionId)
          },
          async detachSession(sessionId) {
            this.sessionIds = this.sessionIds.filter((id) => id !== sessionId)
          },
        }
        workspaces.set(key, found)
      }
      return found
    },
    async resolveByPath(dir) {
      calls.workspace.push({ op: 'resolveByPath', dir })
      return workspaces.get(keyOf(dir))
    },
    list() {
      return [...workspaces.values()]
    },
    async delete(id) {
      calls.workspace.push({ op: 'delete', id })
      for (const [key, workspace] of workspaces) {
        if (workspace.id !== id) continue
        workspaces.delete(key)
        return true
      }
      return false
    },
    async archiveSession(id) {
      calls.archive.push(id)
    },
    async unarchiveSession(id) {
      calls.unarchive.push(id)
    },
  }

  const services = {
    agents,
    llm: {
      listProviders: () => [{ id: 'test', name: 'Test' }],
      async listModels() {
        return [{ id: 'test', name: 'Test' }, { id: 'test-pro', name: 'Test Pro' }]
      },
      async resolveModelInfo(_provider, model) {
        if (model !== 'test-pro') return {}
        return {
          reasoning: {
            efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }],
            defaultEffort: 'low',
          },
        }
      },
      async resolveCallConfig(config) {
        calls.resolveCall.push({ ...config })
        if (config.reasoningEffort === 'bogus') throw new Error('unsupported reasoning effort')
        return config
      },
    },
    agentPresets: {
      async mount(_ctx, id) {
        calls.mounted.push(id)
      },
      serviceFor(agent, name) {
        calls.serviceFor.push({ agentId: agent.id, name })
        if (name !== 'compaction') return undefined
        return {
          async compactNow(_agent, signal) {
            calls.compactNow.push({ hasSignal: Boolean(signal) })
            return { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 900 }
          },
        }
      },
    },
    sessionPersistence: persistence,
    sessionQuery,
    tokenMeter: {
      contextPressure: () => ({ pressureTokens: 1200, contextWindow: 8000 }),
    },
    workspaceRegistry: registry,
    sessionTitle: {
      rename(session, title) {
        calls.rename.push({ sessionId: session.id, title })
      },
    },
  }

  const bridge = {
    service: (name) => services[name],
    on(name, listener) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      set.add(listener)
      return () => set.delete(listener)
    },
  }

  return { bridge, calls, sessions, cwdById, persisted }
}

/** `llm.stream` stub: a couple of text deltas. */
function fakeSummoner(chunks = ['回答', '片段']) {
  return {
    async target() {
      return { provider: 'test', model: 'test' }
    },
    async available() {
      return true
    },
    /** Mirrors the harness adapter's advertised efforts for `test-pro`. */
    async reasoning(_provider, model) {
      if (model !== 'test-pro') return null
      return { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' }
    },
    async *streamText() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeSink() {
  const state = { deltas: [], done: null, error: null }
  const sink = {
    delta: (text) => state.deltas.push(text),
    done: (payload) => {
      state.done = payload
    },
    error: (message) => {
      state.error = message
    },
    get closed() {
      return false
    },
  }
  return { sink, state }
}

const fakeIndexer = {
  ensureIndex: async () => {},
  index: {
    search: () => [{ doc: { page: 2, text: '检索到的第 2 页原文片段' } }],
  },
}

function fakePaper() {
  return {
    id: 'p1',
    title: '一篇关于多物理场耦合的论文',
    authors: ['张三', '李四'],
    tags: [],
    folder: null,
    status: 'reading',
    progress: 10,
    source: 'pdf',
    pageCount: 3,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasFullText: true,
    hasSummary: true,
    abstract: '摘要：本文提出了一种耦合方法。',
  }
}

/** Pull the `prefix: |-` block scalar out of the bundle patch. */
function personaFromPatch(patch) {
  const lines = patch.split('\n')
  const start = lines.findIndex((line) => /^\s*prefix: \|-/.test(line))
  assert.ok(start >= 0, 'the persona prefix is a block scalar')
  const indent = lines[start].match(/^\s*/)[0].length
  const body = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') {
      body.push('')
      continue
    }
    if (line.match(/^\s*/)[0].length < indent + 2) break
    body.push(line.slice(indent + 2))
  }
  return body.join('\n').replace(/\n+$/, '')
}

// ── checks ─────────────────────────────────────────────────────────────────
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-chat-'))
try {
  const store = new Store(home)
  await store.load()
  await store.addPaper(fakePaper())
  await store.writeSummary('p1', {
    paperId: 'p1',
    tldr: '一句话结论。',
    problem: '问题描述。',
    method: '方法描述。',
    findings: ['发现一'],
    limitations: ['局限一'],
    related: [],
    model: 'test/test',
    createdAt: new Date().toISOString(),
  })
  await store.writePages('p1', [{
    page: 1,
    width: 600,
    height: 800,
    blocks: [{ id: 'b1', bbox: [0, 0, 600, 12], text: '第一页第一段，足够长的一段正文内容。', kind: 'para' }],
  }])

  const ask = createAskService({ store, indexer: fakeIndexer })
  const harness = createHarness()
  const chat = createPaperChat({
    store,
    indexer: fakeIndexer,
    summoner: fakeSummoner(),
    bridge: harness.bridge,
    buildAsk: ask.buildAsk,
    log: () => {},
  })

  // ── 1 + 3: first turn creates the session and streams through ────────────
  assert.equal(chat.available(), true)
  const first = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'ask', question: '它解决了什么问题？', page: 2 }, first.sink)
  assert.equal(first.state.error, null, `unexpected error: ${first.state.error}`)
  assert.equal(first.state.deltas.join(''), '回答：它解决了什么问题？')
  assert.deepEqual(first.state.done, { citations: [2] })
  assert.equal(harness.calls.create.length, 1)
  assert.equal(harness.calls.create[0].sessionId, 'pr-p1')
  assert.equal(harness.calls.create[0].meta.agentPreset, PAPER_PRESET)
  assert.equal(
    harness.calls.create[0].meta.cwd,
    path.join(home, 'paperreader', 'workspace', 'p1'),
    'the paper directory is the session cwd, so DSH can attach it to the paper group',
  )
  assert.deepEqual(harness.calls.mounted, [PAPER_PRESET])
  assert.deepEqual(harness.calls.toolDeny, [{ deny: ['alpha', 'beta'] }], 'global tools are denied for this agent')
  assert.equal(harness.calls.rename[0]?.title, '新对话 · 一篇关于多物理场耦合的论文')
  assert.equal(harness.calls.rename.at(-1)?.title, '它解决了什么问题？', 'the first question names the conversation')
  assert.equal(store.getPaper('p1').sessionId, 'pr-p1', 'the paper record remembers the session id')

  const session = harness.sessions.get('pr-p1')
  assert.deepEqual(
    session.messages.map((message) => message.source?.mode ?? message.role),
    ['digest', 'context', 'ask', 'assistant'],
    'digest, retrieval, question, answer — in that order',
  )
  assert.equal(session.messages[1].source.kind, 'paperreader')
  assert.deepEqual(session.messages[1].source.pages, [2])
  assert.deepEqual(harness.calls.unarchive, ['pr-p1'], 'a hidden turn lifts the archive gate')
  assert.deepEqual(harness.calls.archive, ['pr-p1'], 'and re-hides the session afterwards')
  const firstRequest = session.requests[0]
  assert.equal(firstRequest.length, 3, 'the first request carries digest + retrieval + question')

  // The transcript carries the injected blocks at their real position, plus the
  // route the conversation runs on.
  const history = await chat.history('p1')
  assert.equal(history.sessionId, 'pr-p1')
  assert.deepEqual(
    history.messages.map((message) => message.injected ?? message.role),
    ['digest', 'retrieval', 'user', 'assistant'],
    'injected context is part of the transcript, in position',
  )
  assert.deepEqual(history.messages[1].pages, [2], 'a retrieval block names the pages it covers')
  assert.equal(history.messages[2].text.includes('它解决了什么问题'), true)
  assert.equal(history.messages[2].page, 2)
  assert.deepEqual(history.context, { tokens: 1200, window: 8000, percent: 15, compacted: false })
  assert.deepEqual(history.route, { provider: 'test', model: 'test' })

  // ── 1: cold session resumes instead of creating a second log ─────────────
  await chat.release('p1')
  const second = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'ask', question: '方法的步骤？' }, second.sink)
  assert.equal(second.state.error, null)
  assert.equal(harness.calls.create.length, 1, 'a cold session is resumed, not recreated')
  assert.equal(harness.calls.resume.length, 1)
  assert.equal(harness.calls.resume[0].resumeSessionId, 'pr-p1')

  // ── 2: turn 2 extends turn 1's bytes, it does not rewrite them ───────────
  const secondRequest = harness.sessions.get('pr-p1').requests[1]
  assert.deepEqual(
    secondRequest.slice(0, firstRequest.length),
    firstRequest,
    'the request prefix of turn 2 is byte-identical to turn 1',
  )
  assert.equal(secondRequest.length, firstRequest.length + 3, 'turn 2 only appends')
  assert.deepEqual(
    harness.sessions.get('pr-p1').messages.slice(-3).map((message) => message.source?.mode ?? message.role),
    ['context', 'ask', 'assistant'],
  )

  // ── 5: compaction goes through the agent's own preset realm ──────────────
  assert.deepEqual(await chat.compact('p1'), { removed: 3, freedTokens: 900 })
  assert.equal(harness.calls.serviceFor.at(-1).name, 'compaction')
  assert.equal(harness.calls.compactNow.length, 1)
  assert.equal(harness.calls.compactNow[0].hasSignal, true)

  // Compaction replaces the turn span with one checkpoint node. The transcript
  // keeps that node visible, and the digest must not be written a second time.
  const compactedSession = harness.sessions.get('pr-p1')
  compactedSession.messages = [{
    id: 'ck1',
    role: 'user',
    content: [{ type: 'text', text: '（此前两轮对话的摘要）' }],
    source: { kind: 'compact-checkpoint' },
  }]
  const compactedHistory = await chat.history('p1')
  assert.equal(compactedHistory.messages.length, 1, 'the checkpoint is the surviving message')
  assert.equal(compactedHistory.messages[0].summary, true, 'and it is marked as a summary')

  const afterCompact = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'ask', question: '压缩之后还能问吗？' }, afterCompact.sink)
  assert.equal(afterCompact.state.error, null)
  const postCompactRequest = harness.sessions.get('pr-p1').requests.at(-1)
  assert.equal(
    postCompactRequest.some((message) => message.source?.mode === 'digest'),
    false,
    'a compacted session does not get a second digest',
  )

  // ── 4: explain enters the session, translate never does ─────────────────
  const explain = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'explain', question: '', quote: '要解释的一段', page: 3 }, explain.sink)
  assert.equal(explain.state.error, null)
  const afterExplain = harness.sessions.get('pr-p1').messages.length
  assert.equal(harness.sessions.get('pr-p1').messages.at(-2).source.mode, 'explain')
  const explainHistory = await chat.history('p1')
  assert.equal(explainHistory.messages.at(-2).mode, 'explain')
  assert.equal(explainHistory.messages.at(-2).quote, '要解释的一段')

  const translate = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'translate', question: '', quote: '要翻译的一段', page: 3 }, translate.sink)
  assert.equal(translate.state.error, null)
  assert.equal(translate.state.deltas.join(''), '回答片段')
  assert.equal(harness.sessions.get('pr-p1').messages.length, afterExplain, 'translation stays stateless')

  // ── 9: the model seat is per paper and survives a cold start ────────────
  assert.deepEqual(await chat.route('p1'), { provider: 'test', model: 'test' })
  const catalog = await chat.models('p1')
  assert.equal(catalog.available, true)
  assert.deepEqual(catalog.options.map((option) => option.model), ['test', 'test-pro'])
  assert.deepEqual(catalog.options[1].efforts.map((effort) => effort.id), ['low', 'high'])
  assert.equal(catalog.options[1].defaultEffort, 'low')
  assert.deepEqual(catalog.current, { provider: 'test', model: 'test' })

  const applied = await chat.setModel('p1', { provider: 'test', model: 'test-pro', reasoningEffort: 'high' })
  assert.deepEqual(applied, { provider: 'test', model: 'test-pro', reasoningEffort: 'high' })
  assert.deepEqual(store.getPaper('p1').chatModel, applied, 'the paper record owns the choice')
  assert.deepEqual(
    harness.calls.modelSelect.at(-1),
    { id: 'pr-p1', provider: 'test', model: 'test-pro', reasoningEffort: 'high' },
    'a live session switches on its next step',
  )
  assert.deepEqual((await chat.history('p1')).route, applied)
  assert.deepEqual(harness.calls.resolveCall.at(-1), applied, 'the effort is validated before it is recorded')
  await assert.rejects(
    () => chat.setModel('p1', { provider: 'test', model: 'test-pro', reasoningEffort: 'bogus' }),
    /这个模型不可用/,
  )
  assert.deepEqual(store.getPaper('p1').chatModel, applied, 'a rejected effort changes nothing')

  // A later cold start hands the stored route to the agent factory.
  await chat.release('p1')
  const switched = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'ask', question: '换模型之后还能问吗？' }, switched.sink)
  assert.equal(switched.state.error, null, `unexpected error: ${switched.state.error}`)
  assert.deepEqual(harness.calls.resume.at(-1).agentOptions, { provider: 'test', model: 'test-pro' })
  assert.deepEqual(
    harness.calls.modelSelect.at(-1),
    { id: 'pr-p1', provider: 'test', model: 'test-pro', reasoningEffort: 'high' },
    'a resumed session is re-seeded with the stored effort',
  )

  // ── 6: the sidebar switch archives/unarchives and nests papers under the root ──
  harness.calls.archive.length = 0
  harness.calls.unarchive.length = 0
  harness.calls.workspace.length = 0
  harness.calls.attached.length = 0
  await chat.syncSidebar(true)
  const rootWorkspace = path.join(home, 'paperreader', 'workspace')
  const paperWorkspace = path.join(rootWorkspace, 'p1')
  assert.deepEqual(
    harness.calls.workspace.find((call) => call.op === 'create' && call.dir === rootWorkspace),
    { op: 'create', dir: rootWorkspace, title: '论文阅读' },
    'one root group contains every paper folder',
  )
  assert.deepEqual(
    harness.calls.workspace.find((call) => call.op === 'create' && call.dir === paperWorkspace),
    { op: 'create', dir: paperWorkspace, title: '一篇关于多物理场耦合的论文' },
    'the paper folder is a child of the root group',
  )
  assert.equal(path.relative(rootWorkspace, paperWorkspace), 'p1', 'the paper directory is nested under the root')
  assert.deepEqual(harness.calls.unarchive, ['pr-p1'])
  assert.deepEqual(harness.calls.attached, ['pr-p1'], 'membership is recorded, not implied by cwd')

  // With the preference on, a turn must not touch the archive state: a visible
  // session is already admitted.
  store.config.paperSessionInSidebar = true
  const archiveCalls = harness.calls.archive.length + harness.calls.unarchive.length
  const visible = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'ask', question: '侧栏打开时还归档吗？' }, visible.sink)
  assert.equal(visible.state.error, null, `unexpected error: ${visible.state.error}`)
  assert.equal(
    harness.calls.archive.length + harness.calls.unarchive.length,
    archiveCalls,
    'a visible session needs no archive round-trip',
  )
  store.config.paperSessionInSidebar = false

  await chat.syncSidebar(false)
  assert.deepEqual(harness.calls.archive, ['pr-p1'])
  const deleted = harness.calls.workspace.filter((call) => call.op === 'delete')
  assert.equal(deleted.length >= 2, true, 'the paper group and the root group are both removed')

  // ── 10: a new conversation retires the session, the next turn starts over ──
  const beforeReset = store.getPaper('p1').sessionId
  harness.calls.archive.length = 0
  const reset = await chat.reset('p1')
  assert.equal(reset.retired, beforeReset)
  assert.match(reset.sessionId, /^pr-p1-[0-9a-f]{8}$/)
  assert.equal(store.getPaper('p1').sessionId, reset.sessionId, 'the paper points at the fresh session')
  assert.deepEqual(store.getPaper('p1').retiredSessions, [beforeReset], 'the old one is remembered as history')
  assert.deepEqual(harness.calls.archive, [beforeReset], 'the old transcript is hidden, never deleted')
  assert.deepEqual(store.getPaper('p1').chatModel, { provider: 'test', model: 'test-pro', reasoningEffort: 'high' },
    'the model choice belongs to the paper and survives the reset')

  const afterReset = await chat.history('p1')
  assert.equal(afterReset.sessionId, reset.sessionId)
  assert.deepEqual(afterReset.messages, [], 'the new session has no transcript yet')
  assert.equal(harness.calls.create.length, 1, 'nothing is created until the next question')

  // Every conversation of the paper is in the history list, active first.
  const listed = await chat.conversations('p1')
  assert.equal(listed.activeId, reset.sessionId)
  assert.deepEqual(listed.conversations.map((item) => item.id), [reset.sessionId, beforeReset])
  assert.equal(listed.conversations[0].active, true)
  assert.equal(listed.conversations[1].title, '压缩之后还能问吗？', 'history titles come from the first surviving question')

  // The sidebar sync attaches every conversation that already has a log. The
  // fresh active session has no log until its first question, so it joins later.
  harness.calls.unarchive.length = 0
  harness.calls.attached.length = 0
  await chat.syncSidebar(true)
  assert.deepEqual(
    harness.calls.attached,
    [beforeReset],
    'the paper workspace holds every conversation with a transcript',
  )
  assert.deepEqual(harness.calls.unarchive, [beforeReset])
  await chat.syncSidebar(false)

  const fresh = makeSink()
  await chat.stream({ paperId: 'p1', kind: 'ask', question: '清理之后重新开始。' }, fresh.sink)
  assert.equal(fresh.state.error, null, `unexpected error: ${fresh.state.error}`)
  assert.equal(harness.calls.create.at(-1).sessionId, reset.sessionId, 'the next question opens the fresh session')
  assert.deepEqual(
    harness.sessions.get(reset.sessionId).messages.map((message) => message.source?.mode ?? message.role),
    ['digest', 'context', 'ask', 'assistant'],
    'a fresh session gets its own digest instead of inheriting the old context',
  )

  // ── 11: history can be switched, renamed and archived ────────────────────
  const activeAfterFresh = store.getPaper('p1').sessionId
  const switchedHistory = await chat.selectConversation('p1', beforeReset)
  assert.equal(switchedHistory.activeId, beforeReset, 'an older conversation becomes active again')
  assert.equal(store.getPaper('p1').sessionId, beforeReset)
  assert.deepEqual(store.getPaper('p1').retiredSessions, [activeAfterFresh], 'the previous active session joins history')
  const restored = await chat.history('p1')
  assert.equal(restored.sessionId, beforeReset)
  assert.equal(restored.messages[0].summary, true, 'the older transcript is intact')

  await chat.renameConversation('p1', beforeReset, '方法部分')
  const renamed = await chat.conversations('p1')
  assert.equal(renamed.conversations.find((item) => item.id === beforeReset)?.title, '方法部分')
  assert.equal(store.getPaper('p1').conversationTitles[beforeReset], '方法部分', 'the title lives on the paper record')

  await chat.archiveConversation('p1', activeAfterFresh)
  const archived = await chat.conversations('p1')
  assert.equal(archived.conversations.find((item) => item.id === activeAfterFresh)?.archived, true)
  assert.equal(harness.calls.archive.at(-1), activeAfterFresh, 'archiving hides the log, never deletes it')

  await assert.rejects(
    chat.archiveConversation('p1', beforeReset),
    /当前对话不能归档/,
    'the active conversation cannot be archived',
  )

  await chat.unarchiveConversation('p1', activeAfterFresh)
  const unarchived = await chat.conversations('p1')
  assert.equal(unarchived.conversations.find((item) => item.id === activeAfterFresh)?.archived, false)

  // ── 12: root-cwd conversations cannot be re-homed; they are dropped once ──
  const legacyId = 'pr-p2'
  await store.addPaper({ ...fakePaper(), id: 'p2', title: '旧论文' })
  harness.persisted.add(legacyId)
  harness.persisted.add('pr-p2-old')
  harness.cwdById.set(legacyId, path.join(home, 'paperreader', 'workspace'))
  harness.cwdById.set('pr-p2-old', path.join(home, 'paperreader', 'workspace'))
  await store.updatePaper('p2', {
    sessionId: legacyId,
    retiredSessions: ['pr-p2-old'],
    conversationTitles: { [legacyId]: '旧对话' },
    archivedConversations: [],
  })
  harness.calls.archive.length = 0
  harness.calls.attached.length = 0
  await chat.syncSidebar(true)
  const migrated = store.getPaper('p2')
  assert.notEqual(migrated.sessionId, legacyId, 'the active pointer moves off the root-cwd session')
  assert.match(migrated.sessionId, /^pr-p2-[0-9a-f]{8}$/)
  assert.deepEqual(migrated.retiredSessions, [], 'its retired sessions are dropped too')
  assert.deepEqual(migrated.conversationTitles, {}, 'the old title is gone with the conversation')
  assert.ok(harness.calls.archive.includes(legacyId), 'the log is archived, not deleted')
  assert.equal(harness.calls.attached.includes(legacyId), false, 'a legacy session never joins a paper folder')
  await chat.syncSidebar(false)

  // ── 7: a profile without agents still answers, without a session ────────
  const degraded = createPaperChat({
    store,
    indexer: fakeIndexer,
    summoner: fakeSummoner(['降级', '回答']),
    bridge: { service: () => undefined, on: () => () => {} },
    buildAsk: ask.buildAsk,
    log: () => {},
  })
  assert.equal(degraded.available(), false)
  const degradedSink = makeSink()
  await degraded.stream({ paperId: 'p1', kind: 'ask', question: '降级了吗？' }, degradedSink.sink)
  assert.equal(degradedSink.state.error, null)
  assert.equal(degradedSink.state.deltas.join(''), '降级回答')
  assert.deepEqual(degradedSink.state.done, { citations: [2] })
  assert.equal((await degraded.history('p1')).messages.length, 0, 'no session, no transcript')

  // ── 8: the shipped preset declares the persona the code expects ─────────
  const patch = await fs.readFile(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, new RegExp(`^\\s+id: ${PAPER_PRESET}$`, 'm'), 'the preset id matches PAPER_PRESET')
  assert.match(patch, /name: '@deepseek-ai\/dsh-persona'/)
  assert.match(patch, /isolate:\n\s+compaction: true/, 'the preset mounts its own compaction')
  assert.equal(personaFromPatch(patch), PAPER_PERSONA, 'cordis.patch.yml persona must equal PAPER_PERSONA')

  await chat.disposeAll()
  console.log('all conversation checks passed')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
