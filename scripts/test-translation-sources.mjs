/**
 * Translation source checks: OpenAI-compatible streaming, dedicated MT batch
 * mapping, browser commits, and the experimental/AI switch rules.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../dist/host/library/store.js'
import { createTranslationService } from '../dist/host/ai/translate.js'
import { createEngineRegistry } from '../dist/host/ai/engines/registry.js'
import { createNativeEngine } from '../dist/host/ai/engines/mt.js'
import { createDeepLEngine, createGoogleEngine, createAzureEngine, createLibreEngine } from '../dist/host/ai/engines/mt.js'
import { normalizeTranslationSettings, translationAllowed, effectiveTranslationSource } from '../dist/shared/translation.js'
import { protectMath, restoreMath, splitProtected } from '../dist/shared/math.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-sources-'))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeout = 10_000) {
  const started = Date.now()
  for (;;) {
    if (await check()) return
    if (Date.now() - started > timeout) throw new Error('timed out')
    await wait(40)
  }
}

function paper(id = 'p1', title = 'Source Test') {
  return {
    id,
    title,
    authors: ['A. Author'],
    tags: [],
    folder: null,
    status: 'todo',
    progress: 0,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'pdf',
    hasFullText: true,
    hasSummary: false,
    pageCount: 2,
  }
}

function page(number, text) {
  return {
    page: number,
    width: 600,
    height: 800,
    blocks: [
      { id: `t${number}`, bbox: [40, 30, 520, 20], text: `Title ${number}`, kind: 'title', size: 14 },
      { id: `p${number}`, bbox: [40, 70, 520, 60], text, kind: 'para', size: 10 },
      { id: `e${number}`, bbox: [80, 160, 440, 24], text: 'E = mc^2', kind: 'equation', size: 11 },
      { id: `r${number}`, bbox: [40, 700, 520, 30], text: '[1] A. Author. A paper title. In Proceedings of X, 2020.', kind: 'ref', size: 8 },
    ],
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function userText(messages) {
  return (messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n')
}

let openAiCalls = 0
let mtCalls = 0
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/v1/chat/completions') {
      openAiCalls += 1
      const body = await readJson(req)
      const user = userText(body.messages)
      const system = body.messages?.find((message) => message.role === 'system')?.content ?? ''
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (String(system).includes('术语表')) {
        res.write('data: {"choices":[{"delta":{"content":"[]"}}]}\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      const rows = user.split('\n').filter((line) => line.startsWith('{"id"')).map((line) => JSON.parse(line))
      if (rows.length === 0) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `接口译：${user}` } }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      for (const row of rows) {
        const delta = JSON.stringify({ id: row.id, t: `接口译：${row.s}` }) + '\n'
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model', name: 'Mock Model' }] }))
      return
    }
    if (req.url === '/translate') {
      mtCalls += 1
      const body = await readJson(req)
      const q = Array.isArray(body.q) ? body.q : [body.q]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ translatedText: q.map((text) => `机译：${text}`) }))
      return
    }
    if (req.url.startsWith('/libre/translate')) {
      const body = await readJson(req)
      const q = Array.isArray(body.q) ? body.q : [body.q]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ translatedText: q.map((text) => `L:${text}`) }))
      return
    }
    if (req.url.startsWith('/deepl/v2/translate')) {
      const body = await readJson(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ translations: body.text.map((text) => ({ text: `D:${text}` })) }))
      return
    }
    if (req.url.startsWith('/google/language/translate/v2')) {
      const body = await readJson(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        data: { translations: body.q.map((text) => ({ translatedText: `G:${text}&amp;` })) },
      }))
      return
    }
    if (req.url.startsWith('/azure/translate')) {
      const body = await readJson(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body.map((row) => ({ translations: [{ text: `A:${row.Text}` }] }))))
      return
    }
    res.writeHead(404)
    res.end('no')
  } catch (error) {
    res.writeHead(500)
    res.end(String(error?.message ?? error))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const credentials = {
  async resolve(ref) {
    if (String(ref).includes('OPENAI') || String(ref).includes('LOCAL')) return { value: 'test-key' }
    return undefined
  },
  async describe() {
    return { configured: true }
  },
  async set() {},
  async unset() {},
}

const summoner = {
  async available() { return true },
  async target() { return { provider: 'stub', model: 'stub-1' } },
  async *streamText() {
    yield JSON.stringify({ id: 'p1', t: 'DSH 译' }) + '\n'
  },
}

try {
  const store = new Store(home)
  await store.load()
  await store.addPaper(paper())
  await store.writePages('p1', [
    page(1, 'The loss is $L = x + y$ here.'),
    page(2, 'Second page body.'),
  ])

  const registry = createEngineRegistry({
    summoner,
    config: () => store.config,
    getCredentials: () => credentials,
    getTranslator: () => undefined,
    log: () => {},
  })
  const service = createTranslationService({
    store,
    summoner,
    log: () => {},
    resolveEngine: (source) => registry.resolve(source),
    keyStatus: () => registry.keys(),
  })

  // ── source contract ────────────────────────────────────────────────────
  assert.equal(
    effectiveTranslationSource({ experimentalTranslationSources: false, translation: { source: 'api' } }),
    'dsh',
    'experiment off forces the default source',
  )
  assert.equal(
    effectiveTranslationSource({ experimentalTranslationSources: true, translation: { source: 'api' } }),
    'api',
  )
  const openAiSettings = normalizeTranslationSettings({ source: 'api', api: { kind: 'openai' } })
  const localSettings = normalizeTranslationSettings({ source: 'local', local: { kind: 'llm' } })
  const nativeSettings = normalizeTranslationSettings({ source: 'native' })
  assert.equal(translationAllowed(false, openAiSettings), false, 'AI switch stops token APIs')
  assert.equal(translationAllowed(false, localSettings), true, 'AI switch keeps local models')
  assert.equal(translationAllowed(false, nativeSettings), true, 'AI switch keeps free MT')
  assert.equal(
    translationAllowed(false, normalizeTranslationSettings({ source: 'api', api: { kind: 'deepl' } })),
    true,
    'AI switch keeps character-billed translation APIs',
  )

  // The harness' native machine-translation route is a plain batch engine.
  const native = createNativeEngine({
    resolve: (request) => request,
    async translate(spec) {
      return `原生：${spec.text}`
    },
  }, 'bing')
  assert.equal(await native.available(), true)
  assert.equal(native.mode, 'mt')
  assert.deepEqual(
    await native.translateBatch(['hello', 'world'], new AbortController().signal),
    ['原生：hello', '原生：world'],
  )

  const signal = new AbortController().signal
  const base = `http://127.0.0.1:${port}`
  assert.deepEqual(
    await createDeepLEngine({ apiKey: 'test', baseUrl: `${base}/deepl` }).translateBatch(['a', 'b'], signal),
    ['D:a', 'D:b'],
  )
  assert.deepEqual(
    await createGoogleEngine({ apiKey: 'test', baseUrl: `${base}/google` }).translateBatch(['a', 'b'], signal),
    ['G:a&', 'G:b&'],
    'Google HTML entities are decoded',
  )
  assert.deepEqual(
    await createAzureEngine({ apiKey: 'test', baseUrl: `${base}/azure` }).translateBatch(['a', 'b'], signal),
    ['A:a', 'A:b'],
  )
  assert.deepEqual(
    await createLibreEngine({ baseUrl: `${base}/libre` }).translateBatch(['a', 'b'], signal),
    ['L:a', 'L:b'],
  )

  // ── OpenAI-compatible source ───────────────────────────────────────────
  store.config.experimentalTranslationSources = true
  store.config.translation = normalizeTranslationSettings({
    source: 'api',
    api: { kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-model' },
  })
  await store.saveConfig()

  const runtime = await service.describe()
  assert.equal(runtime.source, 'api')
  assert.equal(runtime.engine.mode, 'llm')
  assert.equal(runtime.engine.available, true)
  assert.match(runtime.engine.label, /api\/openai\/mock-model/)

  const status = await service.status('p1')
  assert.equal(status.source, 'api')
  assert.equal(status.mode, 'llm')
  assert.equal(status.allowed, true)

  await service.start('p1')
  await waitFor(async () => !(await service.status('p1')).running)
  const apiDone = await service.status('p1')
  assert.equal(apiDone.donePages, 2)
  const apiPage = await service.page('p1', 1)
  assert.equal(apiPage.blocks.p1, '接口译：The loss is $L = x + y$ here.')
  assert.ok(apiPage.blocks.p1.includes('⟦0⟧') === false, 'host restores the placeholder')
  assert.ok(apiPage.blocks.p1.includes('$L = x + y$'), 'formula survives an API translation')
  assert.ok(openAiCalls >= 2, 'one request per page plus the glossary probe')

  // Selection translation uses the same source.
  const excerpt = await service.translateText('A short excerpt with $x$ inside.')
  assert.match(excerpt, /^接口译：/)
  assert.match(excerpt, /\$x\$/)

  // ── dedicated MT source: batch order, no prompts ───────────────────────
  store.config.translation = normalizeTranslationSettings({
    source: 'local',
    local: { kind: 'libretranslate', baseUrl: `http://127.0.0.1:${port}`, model: '' },
  })
  await store.saveConfig()
  const mtRuntime = await service.describe()
  assert.equal(mtRuntime.engine.mode, 'mt')
  assert.equal(mtRuntime.engine.billing, 'local')

  await service.start('p1', { force: true })
  await waitFor(async () => !(await service.status('p1')).running)
  const mtDone = await service.status('p1')
  assert.equal(mtDone.donePages, 2)
  const mtPage = await service.page('p1', 1)
  assert.match(mtPage.blocks.p1, /^机译：/)
  assert.ok(mtPage.blocks.p1.includes('$L = x + y$'), 'MT path restores formulas too')
  assert.ok(mtCalls > 0, 'LibreTranslate endpoint was called')

  // ── browser commit ─────────────────────────────────────────────────────
  store.config.translation = normalizeTranslationSettings({ source: 'browser' })
  await store.saveConfig()
  const browserRuntime = await service.describe()
  assert.equal(browserRuntime.source, 'browser')
  assert.equal(browserRuntime.engine.mode, 'mt')
  await assert.rejects(
    () => service.start('p1', { force: true }),
    (error) => error.code === 'BROWSER_SOURCE',
    'host refuses to start a browser-owned run',
  )

  const committed = await service.commitExternal('p1', 1, [
    { id: 'p1', t: '浏览器译：损失是 ⟦0⟧。' },
  ])
  assert.deepEqual(committed.accepted, ['p1'])
  assert.deepEqual(committed.rejected, [])
  const browserPage = await service.page('p1', 1)
  assert.equal(browserPage.blocks.p1, '浏览器译：损失是 $L = x + y$。')

  const rejected = await service.commitExternal('p1', 1, [
    { id: 'p1', t: '坏占位符 ⟦7⟧' },
    { id: 'nope', t: '不存在' },
  ])
  assert.deepEqual(rejected.accepted, [])
  assert.deepEqual(rejected.rejected.sort(), ['nope', 'p1'])
  const intact = await service.page('p1', 1)
  assert.equal(intact.blocks.p1, '浏览器译：损失是 $L = x + y$。', 'bad commits never overwrite')

  // ── AI switch and experiment fallback ──────────────────────────────────
  store.config.aiEnabled = false
  store.config.translation = normalizeTranslationSettings({
    source: 'api',
    api: { kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-model' },
  })
  await store.saveConfig()
  const blocked = await service.describe()
  assert.equal(blocked.allowed, false)
  await assert.rejects(
    () => service.start('p1', { force: true }),
    (error) => error.code === 'AI_DISABLED',
  )
  const blockedStatus = await service.status('p1')
  assert.equal(blockedStatus.allowed, false)

  store.config.translation = normalizeTranslationSettings({
    source: 'local',
    local: { kind: 'libretranslate', baseUrl: `http://127.0.0.1:${port}`, model: '' },
  })
  await store.saveConfig()
  assert.equal((await service.describe()).allowed, true, 'local source survives AI switch off')

  store.config.experimentalTranslationSources = false
  await store.saveConfig()
  const fallback = await service.describe()
  assert.equal(fallback.source, 'dsh', 'experiment off ignores the saved source')
  assert.equal(fallback.settings.source, 'dsh', 'runtime settings expose the effective source')

  // ── plain fallback for a translation-specialized LLM ───────────────────
  const guarded = protectMath('The loss is $L = x + y$ here.')
  assert.equal(restoreMath('损失是 ⟦0⟧。', guarded.spans), '损失是 $L = x + y$。')
  const long = `${'word '.repeat(90)}⟦0⟧ tail`
  const pieces = splitProtected(long, 80)
  assert.ok(pieces.length > 1, 'long MT input is split')
  assert.equal(pieces.join(''), long, 'splitting never drops or duplicates text')

  store.config.aiEnabled = true
  await store.saveConfig()
  const special = {
    id: 'local-llm',
    label: 'local/llm/mt-special',
    mode: 'llm',
    billing: 'local',
    plainFallback: true,
    limits: { concurrency: 1, batch: 40, charsPerItem: 6000, charsPerRequest: 12_000 },
    async available() { return true },
    async *stream({ system, user }) {
      if (String(system).includes('术语表')) {
        yield '[]'
        return
      }
      // A translation model that ignores the JSONL instruction and replies
      // with prose; the fallback should still produce a usable page.
      if (String(user).includes('"id"')) {
        yield '这是一段普通译文。'
        return
      }
      yield '逐段译文。'
    },
  }
  const specialService = createTranslationService({
    store,
    summoner,
    log: () => {},
    resolveEngine: async () => special,
  })
  await store.addPaper(paper('p2'))
  await store.writePages('p2', [page(1, 'A short sentence without formulas.')])
  await specialService.start('p2')
  await waitFor(async () => !(await specialService.status('p2')).running)
  const specialPage = await specialService.page('p2', 1)
  assert.equal(specialPage.blocks.p1, '逐段译文。', 'prose replies fall back to plain per-block translation')

  console.log('all translation source checks passed')
} finally {
  server.close()
  await fs.rm(home, { recursive: true, force: true })
}
