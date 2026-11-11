/**
 * Token ledger checks: daily folding, model/source splits, range filtering,
 * invalid samples and durable reload.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'
import { UsageLedger } from '../dist/host/usage/ledger.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-usage-'))

try {
  const ledger = new UsageLedger(root)
  await ledger.load()

  ledger.record({
    at: '2026-11-01T10:00:00',
    provider: 'stub',
    model: 'm1',
    source: 'summary',
    inputTokens: 100,
    outputTokens: 50,
  })
  ledger.record({
    at: '2026-11-01T12:00:00',
    provider: 'stub',
    model: 'm1',
    source: 'chat',
    inputTokens: 200,
    outputTokens: 100,
  })
  ledger.record({
    at: '2026-11-02T09:00:00',
    provider: 'stub',
    model: 'm2',
    source: 'relation',
    inputTokens: 50,
    outputTokens: 25,
  })
  // Invalid counts are ignored instead of corrupting the day.
  ledger.record({ inputTokens: -1, outputTokens: 10 })
  // An explicit total wins over the computed sum.
  ledger.record({
    at: '2026-11-02T10:00:00',
    provider: 'stub',
    model: 'm2',
    source: 'insight',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 100,
  })

  const both = ledger.snapshot('2026-11-01', '2026-11-02')
  assert.equal(both.total.input, 360)
  assert.equal(both.total.output, 180)
  assert.equal(both.total.total, 625)
  assert.equal(both.total.calls, 4)
  assert.equal(both.days.length, 2)
  assert.equal(both.firstAt, '2026-11-01')
  assert.equal(both.lastAt, '2026-11-02')

  const m1 = both.models.find((model) => model.model === 'm1')
  assert.equal(m1?.total, 450)
  assert.equal(m1?.calls, 2)
  const m2 = both.models.find((model) => model.model === 'm2')
  assert.equal(m2?.total, 175)
  assert.equal(m2?.calls, 2)

  const summary = both.sources.find((source) => source.source === 'summary')
  assert.equal(summary?.total, 150)
  const insight = both.sources.find((source) => source.source === 'insight')
  assert.equal(insight?.total, 100)

  const oneDay = ledger.snapshot('2026-11-02', '2026-11-02')
  assert.equal(oneDay.total.total, 175)
  assert.equal(oneDay.days.length, 1)
  assert.equal(oneDay.days[0].date, '2026-11-02')

  await ledger.flush()
  const reread = new UsageLedger(root)
  await reread.load()
  const reloaded = reread.snapshot('2026-11-01', '2026-11-02')
  assert.deepEqual(reloaded.total, both.total)
  assert.equal(reloaded.models.length, both.models.length)

  // The HTTP route must expose the same projection the settings page consumes.
  const httpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-usage-http-'))
  try {
    const app = await createApp({
      home: httpHome,
      getLlm: () => undefined,
      getSelection: () => undefined,
      log: () => {},
    })
    app.usage.record({
      at: '2026-11-03T09:00:00',
      provider: 'stub',
      model: 'm3',
      source: 'summary',
      inputTokens: 10,
      outputTokens: 5,
    })
    await app.usage.flush()

    const handler = createHandler(app)
    const server = http.createServer((request, response) => {
      handler(request, response).catch((error) => {
        response.statusCode = 500
        response.end(String(error))
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const response = await fetch(`http://127.0.0.1:${port}/api/paperreader/usage?from=2026-11-03&to=2026-11-03`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.total.total, 15)
    assert.equal(body.days[0].date, '2026-11-03')
    assert.equal(body.models[0].model, 'm3')
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  } finally {
    await fs.rm(httpHome, { recursive: true, force: true })
  }

  console.log('all token ledger checks passed')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
