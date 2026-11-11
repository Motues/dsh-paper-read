/**
 * Full-text translation checks, with a stub model instead of a harness.
 *
 * Pins the behaviour the reader relies on:
 *   1. only natural-language blocks are sent (formulas, bibliography and meta stay)
 *   2. a truncated JSONL reply keeps the blocks it did return
 *   3. the content-hash cache survives a restart and a re-parse with new block ids
 *   4. a changed page only retranslates the changed blocks
 *   5. cancelling stops the run and keeps completed pages
 *   6. document-level reference detection stops at the heading
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../dist/host/library/store.js'
import { createTranslationService } from '../dist/host/ai/translate.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-translation-'))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeout = 8000) {
  const started = Date.now()
  for (;;) {
    if (await check()) return
    if (Date.now() - started > timeout) throw new Error('timed out')
    await wait(30)
  }
}

function paper(id = 'p1', title = '多物理场耦合') {
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

function page(number, text, ids = {}) {
  const titleId = ids.title ?? `t${number}`
  const paraId = ids.para ?? `p${number}`
  return {
    page: number,
    width: 600,
    height: 800,
    blocks: [
      { id: titleId, bbox: [40, 30, 520, 20], text: `标题 ${number}`, kind: 'title', size: 14 },
      { id: paraId, bbox: [40, 70, 520, 60], text, kind: 'para', size: 10 },
      { id: `e${number}`, bbox: [80, 160, 440, 24], text: 'E = mc^2', kind: 'equation', size: 11 },
      { id: `r${number}`, bbox: [40, 700, 520, 30], text: '[1] A. Author. A paper title. In Proceedings of X, 2020.', kind: 'ref', size: 8 },
    ],
  }
}

/** Parse the JSONL prompt back into blocks. */
function promptBlocks(user) {
  return user.split('\n').slice(1).filter(Boolean).map((line) => JSON.parse(line))
}

/** A well-behaved model: one JSONL line per block. */
function goodSummoner(calls, options = {}) {
  return {
    available: async () => true,
    target: async () => ({ provider: 'test', model: 'mock' }),
    async *streamText({ messages, signal }) {
      if (signal?.aborted) throw new Error('aborted')
      const user = messages[0]?.content?.[0]?.text ?? ''
      const blocks = promptBlocks(user)
      calls.push({ system: messages[0]?.content?.[0]?.text, ids: blocks.map((block) => block.id), user })
      if (options.delay) await wait(options.delay)
      if (signal?.aborted) throw new Error('aborted')
      for (const block of blocks) {
        yield `${JSON.stringify({ id: block.id, t: `译：${block.s}` })}\n`
      }
    },
  }
}

try {
  const store = new Store(home)
  await store.load()
  await store.addPaper(paper())
  await store.writePages('p1', [page(1, '第一页正文。'), page(2, '第二页正文。')])

  const calls = []
  const summoner = goodSummoner(calls)
  const service = createTranslationService({ store, summoner, log: () => {} })

  const initial = await service.status('p1')
  assert.equal(initial.totalPages, 2)
  assert.equal(initial.donePages, 0)
  assert.equal(initial.running, false)
  assert.equal(initial.totalBlocks, 4, 'titles and paragraphs need translation; formulas/references do not')

  await service.start('p1')
  await waitFor(async () => !(await service.status('p1')).running)
  const done = await service.status('p1')
  assert.equal(done.donePages, 2, 'both pages translated')
  assert.equal(done.pages['1'], 'done')
  assert.equal(calls.length, 2, 'one request per page')

  assert.deepEqual(calls[0].ids, ['t1', 'p1'], 'formulas and references are not translated')

  const first = await service.page('p1', 1)
  assert.equal(first.status, 'done')
  assert.equal(first.blocks.t1, '译：标题 1')
  assert.equal(first.blocks.p1, '译：第一页正文。')
  assert.equal(first.blocks.e1, undefined)
  assert.equal(first.skipped.e1, 'equation')
  assert.equal(first.skipped.r1, 'ref')

  const stored = await store.readTranslation('p1')
  assert.equal(stored.pages['1'].blocks.p1, '译：第一页正文。')
  assert.ok(stored.pages['1'].sources.p1, 'the page records per-block source hashes')

  // Reopening after a restart reuses the cache.
  const reloaded = new Store(home)
  await reloaded.load()
  calls.length = 0
  const restarted = createTranslationService({ store: reloaded, summoner, log: () => {} })
  await restarted.start('p1')
  await waitFor(async () => !(await restarted.status('p1')).running)
  assert.equal(calls.length, 0, 'a cached paper is never retranslated')

  // A changed page invalidates only that page.
  await store.writePages('p1', [page(1, '第一页正文改了。'), page(2, '第二页正文。')])
  calls.length = 0
  await restarted.start('p1')
  await waitFor(async () => !(await restarted.status('p1')).running)
  assert.equal(calls.length, 1, 'only the changed page is retranslated')
  assert.equal((await restarted.page('p1', 1)).blocks.p1, '译：第一页正文改了。')

  // A re-parse renumbers blocks; the content hash still serves the cache.
  await store.writePages('p1', [
    page(1, '第一页正文改了。', { title: 'x1', para: 'y1' }),
    page(2, '第二页正文。', { title: 'x2', para: 'y2' }),
  ])
  calls.length = 0
  await restarted.start('p1')
  await waitFor(async () => !(await restarted.status('p1')).running)
  assert.equal(calls.length, 0, 'same text under new ids is reused')
  assert.equal((await restarted.page('p1', 1)).blocks.y1, '译：第一页正文改了。')

  // A truncated reply: the first block is kept, only the missing one is re-asked.
  const truncated = []
  let firstReply = true
  const truncating = {
    available: async () => true,
    target: async () => ({ provider: 'test', model: 'mock' }),
    async *streamText({ messages, signal }) {
      if (signal?.aborted) throw new Error('aborted')
      const user = messages[0]?.content?.[0]?.text ?? ''
      const blocks = promptBlocks(user)
      truncated.push(blocks.map((block) => block.id))
      if (firstReply) {
        firstReply = false
        yield `${JSON.stringify({ id: blocks[0].id, t: `译：${blocks[0].s}` })}\n`
        return
      }
      for (const block of blocks) yield `${JSON.stringify({ id: block.id, t: `译：${block.s}` })}\n`
    },
  }
  await store.addPaper({ ...paper('p2', '截断测试'), pageCount: 1 })
  await store.writePages('p2', [{
    page: 1,
    width: 600,
    height: 800,
    blocks: [
      { id: 'a', bbox: [40, 30, 520, 20], text: '第一段。', kind: 'para', size: 10 },
      { id: 'b', bbox: [40, 70, 520, 20], text: '第二段。', kind: 'para', size: 10 },
    ],
  }])
  const partial = createTranslationService({ store, summoner: truncating, log: () => {} })
  await partial.start('p2')
  await waitFor(async () => !(await partial.status('p2')).running)
  const partialStatus = await partial.status('p2')
  assert.equal(partialStatus.donePages, 1, 'the page completes after the missing block is re-asked')
  assert.equal(partialStatus.translatedBlocks, 2)
  assert.equal(truncated.length, 2, 'the truncated block list is retried once')
  const partialPage = await partial.page('p2', 1)
  assert.equal(partialPage.blocks.a, '译：第一段。')
  assert.equal(partialPage.blocks.b, '译：第二段。')

  // Reference pages are detected at document level: heading → end of paper.
  await store.addPaper({ ...paper('p3', '参考文献测试'), pageCount: 2 })
  await store.writePages('p3', [
    page(1, '正文。'),
    {
      page: 2,
      width: 600,
      height: 800,
      blocks: [
        { id: 'rh', bbox: [40, 40, 520, 20], text: 'References', kind: 'title', size: 12 },
        { id: 'r1', bbox: [40, 80, 520, 100], text: '[1] A reference entry that is long enough to look like a reference entry in the list.'.repeat(2), kind: 'para', size: 9 },
        { id: 'r2', bbox: [40, 200, 520, 100], text: '[2] Another reference entry that also looks like a reference entry in the list.'.repeat(2), kind: 'para', size: 9 },
      ],
    },
  ])
  calls.length = 0
  const refs = createTranslationService({ store, summoner, log: () => {} })
  await refs.start('p3')
  await waitFor(async () => !(await refs.status('p3')).running)
  assert.equal(calls.length, 1, 'only page 1 is sent')
  assert.deepEqual(calls[0].ids, ['t1', 'p1'])
  const refPage = await refs.page('p3', 2)
  assert.equal(refPage.skipped.rh, 'ref')
  assert.equal(refPage.skipped.r1, 'ref')
  const doc = await refs.document('p3')
  assert.ok(doc.referencePages.includes(2), 'the reference heading page is reported')
  assert.equal(doc.pages.length, 2)

  // Cancel keeps what already finished.
  await store.addPaper({ ...paper('p4', '取消测试') })
  await store.writePages('p4', [page(1, '正文一。'), page(2, '正文二。')])
  const slow = {
    available: async () => true,
    target: async () => ({ provider: 'test', model: 'mock' }),
    async *streamText({ signal }) {
      await wait(400)
      if (signal?.aborted) throw new Error('aborted')
      yield `${JSON.stringify({ id: 'p1', t: '译' })}\n`
    },
  }
  const cancellable = createTranslationService({ store, summoner: slow, log: () => {} })
  await cancellable.start('p4')
  await wait(80)
  const cancelled = await cancellable.cancel('p4')
  assert.equal(cancelled.running, false)
  await waitFor(async () => !(await cancellable.status('p4')).running)
  assert.equal((await cancellable.status('p4')).donePages, 0, 'nothing was committed before the cancel')

  console.log('all translation checks passed')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
