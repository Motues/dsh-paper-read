/**
 * Task-page aggregation and the new config switches.
 *
 * A queued import job is enough to exercise the `/tasks` projection without a
 * model; translation and chat activity are covered by their own services.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-tasks-'))

try {
  const app = await createApp({
    home,
    getLlm: () => undefined,
    getSelection: () => undefined,
    log: () => {},
  })
  let release = () => {}
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined)
  })
  app.onJobRunner(() => gate)
  assert.equal(app.store.config.experimentalFullTextTranslation, false, 'experiments are off by default')
  assert.equal(app.store.config.experimentalTaskCenter, false, 'task page is off by default')
  assert.equal(app.store.config.recentLimit, 20, 'recent limit defaults to 20')
  const job = app.enqueueJob({ kind: 'file', filePath: path.join(home, 'queued-paper.pdf') })
  assert.equal(app.activeJobs().length, 1, 'a queued job is active')
  assert.equal(app.activeJobs()[0]?.id, job.id)

  const handler = createHandler(app)
  const server = http.createServer((request, response) => {
    handler(request, response).catch((error) => {
      response.statusCode = 500
      response.end(String(error))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const tasksResponse = await fetch(`http://127.0.0.1:${port}/api/paperreader/tasks`)
  const tasksBody = await tasksResponse.json()
  assert.equal(tasksResponse.status, 200)
  assert.equal(tasksBody.tasks.length, 1)
  assert.equal(tasksBody.tasks[0].kind, 'import')
  assert.equal(tasksBody.tasks[0].state, 'queued')
  assert.equal(tasksBody.tasks[0].title, 'queued-paper.pdf')
  assert.equal(tasksBody.tasks[0].detail, '排队中')

  const saveResponse = await fetch(`http://127.0.0.1:${port}/api/paperreader/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      experimentalFullTextTranslation: false,
      experimentalTaskCenter: true,
      libraryDefaultView: 'grid',
      recentLimit: 30,
    }),
  })
  const saved = await saveResponse.json()
  assert.equal(saveResponse.status, 200)
  assert.equal(saved.experimentalFullTextTranslation, false)
  assert.equal(saved.experimentalTaskCenter, true)
  assert.equal(saved.libraryDefaultView, 'grid')
  assert.equal(saved.recentLimit, 30)

  // An unknown layout value must not replace the stored one.
  const badResponse = await fetch(`http://127.0.0.1:${port}/api/paperreader/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ libraryDefaultView: 'masonry' }),
  })
  const bad = await badResponse.json()
  assert.equal(bad.libraryDefaultView, 'grid')

  // History + token attribution: a summary task writes a durable row with the
  // usage recorded inside its async context.
  const summaryTask = app.tasks.begin({
    kind: 'summary',
    title: 'Test Paper',
    paperId: 'p1',
    detail: '分节阅读',
  })
  await app.tasks.run(summaryTask.id, async () => {
    app.tasks.record({
      provider: 'stub',
      model: 'stub-1',
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
    })
    app.tasks.record({
      provider: 'stub',
      model: 'stub-1',
      inputTokens: 400,
      outputTokens: 100,
      totalTokens: 500,
    })
  })
  summaryTask.finish({ state: 'done', detail: '完成' })

  const historyResponse = await fetch(`http://127.0.0.1:${port}/api/paperreader/tasks?kind=summary&state=done`)
  const historyBody = await historyResponse.json()
  assert.equal(historyResponse.status, 200)
  assert.equal(historyBody.history.length, 1)
  assert.equal(historyBody.history[0].kind, 'summary')
  assert.equal(historyBody.history[0].state, 'done')
  assert.equal(historyBody.history[0].usage.input, 1400)
  assert.equal(historyBody.history[0].usage.output, 300)
  assert.equal(historyBody.history[0].usage.total, 1700)
  assert.equal(historyBody.history[0].usage.calls, 2)
  assert.deepEqual(historyBody.history[0].models, ['stub/stub-1'])
  assert.equal(historyBody.total, 1)
  assert.ok(historyBody.history[0].startedAt)
  assert.ok(historyBody.history[0].finishedAt)

  const wrongKind = await (await fetch(`http://127.0.0.1:${port}/api/paperreader/tasks?kind=import`)).json()
  assert.equal(wrongKind.history.length, 0)
  const search = await (await fetch(`http://127.0.0.1:${port}/api/paperreader/tasks?q=stub-1`)).json()
  assert.equal(search.history.length, 1, 'search covers model labels')

  await app.tasks.flush()

  release()
  await app.waitIdle()
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
  console.log('all task and config checks passed')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
