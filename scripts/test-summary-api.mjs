import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-summary-api-'))
const calls = []
const stubLlm = {
  listProviders: () => [{ id: 'stub', name: 'Stub' }],
  listModels: async () => [{ id: 'stub-1', name: 'Stub 1' }],
  resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' } }),
  async *stream(options) {
    calls.push(options)
    const system = options.system ?? ''
    let text
    if (system.includes('section-level facts')) {
      text = '[Problem] 测试问题\n[Method] 测试方法\n[Finding] 测试结论'
    } else if (system.includes('write a digest of one paper')) {
      text = JSON.stringify({
        tldr: '测试导读。',
        problem: '测试问题。',
        method: '测试方法。',
        findings: ['测试结论。'],
        limitations: [],
        reusable: [],
      })
    } else if (system.includes('paper-relation engine')) {
      text = JSON.stringify({
        question: '测试问题',
        method: 'test',
        approach: '测试方法。',
        claims: ['测试结论'],
        concepts: ['test concept'],
        tasks: ['test'],
        limitations: [],
        fingerprint: '测试指纹',
      })
    } else {
      text = 'ok'
    }
    yield { type: 'text-delta', text }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const app = await createApp({
  home,
  getLlm: () => stubLlm,
  getSelection: () => ({ provider: 'stub', model: 'stub-1' }),
  log: () => {},
})
const now = new Date().toISOString()
await app.store.addPaper({
  id: 'p1',
  title: 'Summary API Test',
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
  abstract: 'An abstract about state spaces and long sequences.',
})
await app.store.writePages('p1', [{
  page: 1,
  width: 600,
  height: 800,
  blocks: [{
    id: 'b1',
    bbox: [0, 0, 100, 20],
    kind: 'para',
    text: 'We study long sequence modeling with structured state spaces. '.repeat(20),
  }],
}])

const handler = createHandler(app)
const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    res.statusCode = 500
    res.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/paperreader`

const response = await fetch(`${base}/papers/p1/summarize`, { method: 'POST' })
const body = await response.json()
assert.equal(response.status, 200, JSON.stringify(body))
assert.equal(body.summary.tldr, '测试导读。')
assert.ok(!body.warning)

const tasks = await (await fetch(`${base}/tasks?kind=summary`)).json()
assert.equal(tasks.history.length, 1)
assert.equal(tasks.history[0].state, 'done')
assert.equal(tasks.history[0].kind, 'summary')
assert.ok(tasks.history[0].usage.calls >= 2, JSON.stringify(tasks.history[0]))
assert.deepEqual(tasks.history[0].models, ['stub/stub-1'])
assert.ok(calls.some((call) => call.reasoningEffort === 'low'), 'digest calls use low effort')

server.closeAllConnections?.()
await new Promise((resolve) => server.close(resolve))
await fs.rm(home, { recursive: true, force: true })
console.log('summary API integration checks passed')
