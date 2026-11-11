/**
 * Global AI switch: the host must refuse every token-consuming route even when
 * a model is configured, while deterministic search and relations still work.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'

const calls = { stream: 0 }
const stubLlm = {
  listProviders: () => [{ id: 'stub', name: 'Stub' }],
  listModels: async () => [{ provider: 'stub', id: 'stub-1', name: 'Stub 1' }],
  async *stream() {
    calls.stream += 1
    yield { type: 'text-delta', text: 'should not run' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-ai-switch-'))
const app = await createApp({
  home,
  getLlm: () => stubLlm,
  getSelection: () => ({ provider: 'stub', model: 'stub-1' }),
  log: () => {},
})
const handler = createHandler(app)
const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    res.statusCode = 500
    res.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/paperreader`

const call = async (route, init) => {
  const response = await fetch(base + route, init)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}
const json = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const now = new Date().toISOString()
const paper = {
  id: 'p1',
  title: 'Switch Test',
  authors: ['Tester'],
  tags: [],
  folder: null,
  status: 'todo',
  progress: 0,
  source: 'pdf',
  addedAt: now,
  updatedAt: now,
  hasFullText: true,
  hasSummary: false,
}

try {
  await app.store.addPaper(paper)
  await app.store.writeChunks('p1', [{
    id: 'p1#0',
    paperId: 'p1',
    page: 1,
    blockIds: ['b1'],
    text: 'attention and bias drift',
    tokens: 4,
    index: 0,
  }])
  await app.store.writeSummary('p1', {
    paperId: 'p1',
    tldr: '旧导读',
    problem: '',
    method: '',
    findings: [],
    limitations: [],
    reusable: [],
    related: [],
    model: 'stub/stub-1',
    createdAt: now,
  })

  assert.equal((await call('/config')).body.aiEnabled, true)
  const off = await call('/config', json('POST', { aiEnabled: false }))
  assert.equal(off.status, 200)
  assert.equal(off.body.aiEnabled, false)

  const config = await call('/config')
  assert.equal(config.body.aiEnabled, false)
  assert.equal(config.body.available, false)
  assert.equal(config.body.route, null)

  const ask = await call('/ask', json('POST', {
    paperId: 'p1',
    kind: 'ask',
    question: '解释一下',
  }))
  assert.equal(ask.status, 503)
  assert.equal(ask.body.error.code, 'AI_DISABLED')

  const summarize = await call('/papers/p1/summarize', { method: 'POST' })
  assert.equal(summarize.status, 503)
  assert.equal(summarize.body.error.code, 'AI_DISABLED')

  const translate = await call('/papers/p1/translation', json('POST', { action: 'start' }))
  assert.equal(translate.status, 503)
  assert.equal(translate.body.error.code, 'AI_DISABLED')

  const compact = await call('/papers/p1/compact', { method: 'POST' })
  assert.equal(compact.status, 503)
  assert.equal(compact.body.error.code, 'AI_DISABLED')

  // Manual guide edits are not AI work and must stay available.
  const edited = await call('/papers/p1/summary', json('PATCH', { tldr: '手动导读' }))
  assert.equal(edited.status, 200)
  assert.equal(edited.body.summary.tldr, '手动导读')

  // Search still works and never reranks (no stream call).
  const search = await call('/search', json('POST', { query: 'attention' }))
  assert.equal(search.status, 200)
  assert.equal(search.body.reranked, false)
  assert.ok(search.body.hits.length > 0)
  assert.equal(calls.stream, 0)

  // Deterministic relations remain available; the AI flag is explicit.
  const graph = await call('/relations/graph')
  assert.equal(graph.status, 200)
  assert.equal(graph.body.stats.ai, false)
  assert.equal(graph.body.stats.aiDisabled, true)

  const rebuild = await call('/relations/rebuild', json('POST', { scope: 'p1' }))
  assert.equal(rebuild.status, 200)
  assert.ok(rebuild.body.jobId)

  // Turning the switch back on restores availability.
  const on = await call('/config', json('POST', { aiEnabled: true }))
  assert.equal(on.status, 200)
  assert.equal(on.body.aiEnabled, true)
  assert.equal((await call('/config')).body.available, true)

  console.log('all AI switch checks passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(home, { recursive: true, force: true })
}
