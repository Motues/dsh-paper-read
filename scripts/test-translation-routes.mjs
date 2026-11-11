/**
 * Route-level translation checks: config round-trip, source catalog, key store,
 * model discovery, probe, browser commit and the experiment/AI switch gates.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler, ROUTE_PATH } from '../dist/host/http/handler.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-routes-'))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeout = 10_000) {
  const started = Date.now()
  for (;;) {
    if (await check()) return
    if (Date.now() - started > timeout) throw new Error('timed out')
    await wait(40)
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
  return (messages ?? []).filter((item) => item.role === 'user').map((item) => item.content).join('\n')
}

const provider = http.createServer(async (req, res) => {
  try {
    if (req.url === '/v1/chat/completions') {
      const body = await readJson(req)
      const system = body.messages?.find((message) => message.role === 'system')?.content ?? ''
      const user = userText(body.messages)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (String(system).includes('术语表')) {
        res.write('data: {"choices":[{"delta":{"content":"[]"}}]}\n\n')
        res.end('data: [DONE]\n\n')
        return
      }
      const rows = user.split('\n').filter((line) => line.startsWith('{"id"')).map((line) => JSON.parse(line))
      if (rows.length === 0) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `接口译：${user}` } }] })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }
      for (const row of rows) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${JSON.stringify({ id: row.id, t: `接口译：${row.s}` })}\n` } }] })}\n\n`)
      }
      res.end('data: [DONE]\n\n')
      return
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model', name: 'Mock Model' }] }))
      return
    }
    if (req.url === '/translate') {
      const body = await readJson(req)
      const q = Array.isArray(body.q) ? body.q : [body.q]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ translatedText: q.map((text) => `机译：${text}`) }))
      return
    }
    res.writeHead(404)
    res.end('no')
  } catch (error) {
    res.writeHead(500)
    res.end(String(error?.message ?? error))
  }
})
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))
const providerPort = provider.address().port

const keys = new Map()
keys.set('PAPERREADER_TRANSLATION_OPENAI_KEY', 'test-openai-key')
const credentials = {
  async resolve(ref) {
    const value = keys.get(String(ref))
    return value ? { value } : undefined
  },
  async describe(ref) {
    return { configured: keys.has(String(ref)) }
  },
  async set(ref, value) {
    keys.set(String(ref), value)
  },
  async unset(ref) {
    keys.delete(String(ref))
  },
}

const stubLlm = {
  listProviders: () => [{ id: 'stub', name: 'Stub' }],
  listModels: async () => [{ id: 'stub-1', name: 'Stub 1' }],
  async *stream() {
    yield { type: 'text-delta', text: 'unused' }
  },
}

const app = await createApp({
  home,
  getLlm: () => stubLlm,
  getSelection: () => ({ provider: 'stub', model: 'stub-1' }),
  getCredentials: () => credentials,
  getTranslator: () => undefined,
  log: () => {},
})
app.store.config.provider = 'stub'
app.store.config.model = 'stub-1'
await app.store.saveConfig()

const paper = {
  id: 'p1',
  title: 'Route Test',
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
  pageCount: 1,
}
await app.store.addPaper(paper)
await app.store.writePages('p1', [{
  page: 1,
  width: 600,
  height: 800,
  blocks: [
    { id: 'p1', bbox: [40, 70, 520, 60], text: 'The loss is $L = x + y$ here.', kind: 'para', size: 10 },
    { id: 'r1', bbox: [40, 700, 520, 30], text: '[1] A. Author. A paper title.', kind: 'ref', size: 8 },
  ],
}])

const handler = createHandler(app)
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (pathname !== ROUTE_PATH && !pathname.startsWith(`${ROUTE_PATH}/`)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  handler(req, res).catch((error) => {
    res.writeHead(500)
    res.end(String(error?.message ?? error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}${ROUTE_PATH}`

async function json(pathname, init) {
  const response = await fetch(`${base}${pathname}`, init)
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

const post = (pathname, payload) => json(pathname, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

try {
  // Default source + settings page contract.
  let sources = await json('/translation/sources')
  assert.equal(sources.status, 200)
  assert.equal(sources.body.source, 'dsh')
  assert.equal(sources.body.engine.mode, 'llm')
  assert.equal(sources.body.settings.source, 'dsh')

  // Configure an OpenAI-compatible source through the normal config route.
  const saved = await post('/config', {
    experimentalTranslationSources: true,
    translation: {
      source: 'api',
      api: {
        kind: 'openai',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        model: 'mock-model',
      },
    },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.translation.source, 'api')
  assert.equal(saved.body.translationKeys.openai, true)

  sources = await json('/translation/sources')
  assert.equal(sources.body.source, 'api')
  assert.equal(sources.body.engine.available, true)
  assert.match(sources.body.engine.label, /mock-model/)

  // Key storage never echoes the value.
  const keySaved = await post('/translation/key', { provider: 'deepl', value: 'secret-key' })
  assert.equal(keySaved.status, 200)
  assert.equal(keySaved.body.keys.deepl, true)
  assert.equal(JSON.stringify(keySaved.body).includes('secret-key'), false)
  const keyCleared = await post('/translation/key', { provider: 'deepl', value: '' })
  assert.equal(keyCleared.body.keys.deepl, false)

  // Model discovery uses the saved endpoint.
  const models = await json('/translation/models?target=api')
  assert.equal(models.status, 200)
  assert.deepEqual(models.body.models, [{ id: 'mock-model', name: 'Mock Model' }])

  // Probe one short text through the configured engine.
  const test = await post('/translation/test', {})
  assert.equal(test.status, 200)
  assert.equal(test.body.ok, true)
  assert.match(test.body.output, /接口译/)

  // Full-text run through the API source.
  const started = await post('/papers/p1/translation', { action: 'start' })
  assert.equal(started.status, 200)
  await waitFor(async () => {
    const status = await json('/papers/p1/translation')
    return status.body.running === false
  })
  const done = await json('/papers/p1/translation')
  assert.equal(done.body.donePages, 1)
  const page = await json('/papers/p1/translation/pages/1')
  assert.equal(page.body.blocks.p1, '接口译：The loss is $L = x + y$ here.')

  // Browser source: host refuses to start, but accepts page commits.
  await post('/config', { translation: { source: 'browser' } })
  const browserStart = await post('/papers/p1/translation', { action: 'start' })
  assert.equal(browserStart.status, 409)
  assert.equal(browserStart.body.error.code, 'BROWSER_SOURCE')

  const commit = await post('/papers/p1/translation/blocks', {
    page: 1,
    blocks: [{ id: 'p1', t: '浏览器译：⟦0⟧' }],
  })
  assert.equal(commit.status, 200)
  assert.deepEqual(commit.body.accepted, ['p1'])
  assert.equal(commit.body.status.source, 'browser')

  // Turning the experiment off forces the default source even though the saved
  // source is still browser.
  const off = await post('/config', { experimentalTranslationSources: false })
  assert.equal(off.status, 200)
  const fallback = await json('/translation/sources')
  assert.equal(fallback.body.source, 'dsh')
  assert.equal(fallback.body.settings.source, 'dsh')

  // AI master switch stops token sources but keeps local/MT sources.
  await post('/config', {
    experimentalTranslationSources: true,
    aiEnabled: false,
    translation: {
      source: 'api',
      api: {
        kind: 'openai',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        model: 'mock-model',
      },
    },
  })
  const blocked = await json('/translation/sources')
  assert.equal(blocked.body.allowed, false)
  const blockedStart = await post('/papers/p1/translation', { action: 'start' })
  assert.equal(blockedStart.status, 503)
  assert.equal(blockedStart.body.error.code, 'AI_DISABLED')

  await post('/config', {
    translation: {
      source: 'local',
      local: { kind: 'libretranslate', baseUrl: `http://127.0.0.1:${providerPort}`, model: '' },
    },
  })
  const local = await json('/translation/sources')
  assert.equal(local.body.allowed, true)
  assert.equal(local.body.engine.mode, 'mt')

  console.log('all translation route checks passed')
} finally {
  server.close()
  provider.close()
  await fs.rm(home, { recursive: true, force: true })
}
