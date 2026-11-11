/**
 * Library HTTP contract: nested folders, soft delete / restore / purge, and the
 * payload the client actually receives (including the recycle bin).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-api-'))
const app = await createApp({
  home,
  getLlm: () => undefined,
  getSelection: () => undefined,
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
const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const now = new Date().toISOString()
const record = (id, folder = null) => ({
  id,
  title: `Paper ${id}`,
  authors: [],
  tags: [],
  folder,
  status: 'todo',
  progress: 0,
  source: 'pdf',
  addedAt: now,
  updatedAt: now,
  hasFullText: false,
  hasSummary: false,
})

try {
  await app.store.addPaper(record('p1'))

  const initial = await call('/papers')
  assert.equal(initial.body.papers.length, 1)
  assert.deepEqual(initial.body.trash, [])
  assert.equal(initial.body.counts.trash, 0)
  assert.equal(initial.body.unfiled, 1)

  // ── nested folders ───────────────────────────────────────────────────────
  const parent = await call('/folders', json({ name: '父母' }))
  assert.equal(parent.status, 201)
  const child = await call('/folders', json({ name: '孩子', parentId: parent.body.id }))
  assert.equal(child.status, 201)
  assert.equal(child.body.parentId, parent.body.id)
  const siblingClash = await call('/folders', json({ name: '孩子', parentId: parent.body.id }))
  assert.equal(siblingClash.status, 400)
  const sameNameElsewhere = await call('/folders', json({ name: '孩子' }))
  assert.equal(sameNameElsewhere.status, 201)

  // ── folder move: sibling order and nesting ───────────────────────────────
  const alpha = await call('/folders', json({ name: '甲' }))
  const beta = await call('/folders', json({ name: '乙' }))
  const gamma = await call('/folders', json({ name: '丙' }))
  const orderOf = (body) => body.folders.map((entry) => entry.id)

  const reordered = await call(`/folders/${gamma.body.id}/move`, json({ parentId: null, beforeId: alpha.body.id }))
  assert.equal(reordered.status, 200)
  const afterReorder = orderOf(reordered.body)
  assert.ok(afterReorder.indexOf(gamma.body.id) < afterReorder.indexOf(alpha.body.id))

  const nested = await call(`/folders/${beta.body.id}/move`, json({ parentId: alpha.body.id, beforeId: null }))
  assert.equal(nested.status, 200)
  assert.equal(nested.body.folders.find((entry) => entry.id === beta.body.id).parentId, alpha.body.id)
  const betaChild = await call('/folders', json({ name: '乙一', parentId: beta.body.id }))
  assert.equal(betaChild.status, 201)

  // A folder cannot move into its own descendant.
  const cycle = await call(`/folders/${alpha.body.id}/move`, json({ parentId: beta.body.id, beforeId: null }))
  assert.equal(cycle.status, 400)

  // Names stay unique per level.
  const duplicate = await call('/folders', json({ name: '丁' }))
  const duplicateChild = await call('/folders', json({ name: '丁', parentId: alpha.body.id }))
  assert.equal(duplicateChild.status, 201)
  const nameClash = await call(`/folders/${duplicate.body.id}/move`, json({ parentId: alpha.body.id, beforeId: null }))
  assert.equal(nameClash.status, 400)

  // A stale / non-sibling anchor is rejected, not silently appended.
  const badAnchor = await call(`/folders/${beta.body.id}/move`, json({ parentId: null, beforeId: child.body.id }))
  assert.equal(badAnchor.status, 400)

  // Dragging back out to the root keeps the folder and its parent link in sync.
  const backToRoot = await call(`/folders/${beta.body.id}/move`, json({ parentId: null, beforeId: parent.body.id }))
  assert.equal(backToRoot.status, 200)
  assert.equal(backToRoot.body.folders.find((entry) => entry.id === beta.body.id).parentId, null)
  assert.equal(backToRoot.body.folders.find((entry) => entry.id === betaChild.body.id).parentId, beta.body.id)

  const moved = await call('/papers/p1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folder: child.body.id }),
  })
  assert.equal(moved.status, 200)
  assert.equal(moved.body.folder, child.body.id)

  const inChild = await call(`/papers?folder=${child.body.id}`)
  assert.equal(inChild.body.papers.length, 1)
  assert.equal(inChild.body.folders.find((entry) => entry.id === child.body.id).count, 1)

  // ── recycle bin ──────────────────────────────────────────────────────────
  const trashed = await call('/papers/p1', { method: 'DELETE' })
  assert.equal(trashed.status, 200)
  assert.equal(trashed.body.permanent, false)
  assert.ok(trashed.body.deletedAt)

  const afterTrash = await call('/papers')
  assert.equal(afterTrash.body.papers.length, 0)
  assert.equal(afterTrash.body.trash.length, 1)
  assert.equal(afterTrash.body.counts.trash, 1)
  assert.equal(afterTrash.body.unfiled, 0)
  const detail = await call('/papers/p1')
  assert.equal(detail.status, 404)

  const restored = await call('/papers/p1/restore', { method: 'POST' })
  assert.equal(restored.status, 200)
  assert.equal(restored.body.deletedAt, undefined)
  assert.equal((await call('/papers')).body.trash.length, 0)

  // Purging drops the record for good.
  await call('/papers/p1', { method: 'DELETE' })
  const purged = await call('/papers/p1?permanent=1', { method: 'DELETE' })
  assert.equal(purged.status, 200)
  assert.equal(purged.body.permanent, true)
  assert.equal((await call('/papers/p1')).status, 404)
  assert.equal((await call('/papers')).body.trash.length, 0)

  // ── folder subtree delete ────────────────────────────────────────────────
  const p2 = record('p2', child.body.id)
  await app.store.addPaper(p2)
  const dropped = await call(`/folders/${parent.body.id}`, { method: 'DELETE' })
  assert.equal(dropped.status, 200)
  assert.equal(dropped.body.removed.length, 2)
  assert.equal(app.store.getFolder(child.body.id), undefined)
  assert.equal(app.store.getPaper('p2').folder, null)
  const remaining = await call('/folders')
  assert.equal(remaining.body.folders.some((entry) => entry.id === parent.body.id), false)
  assert.equal((await call('/papers')).body.papers.length, 1)

  // ── empty the recycle bin ────────────────────────────────────────────────
  await app.store.addPaper(record('p3'))
  await call('/papers/p3', { method: 'DELETE' })
  const emptied = await call('/trash', { method: 'DELETE' })
  assert.equal(emptied.status, 200)
  assert.equal(emptied.body.count, 1)
  assert.equal(app.store.getPaper('p3'), undefined)

  // ── reader find: exact matches in one paper's parsed text ────────────────
  await app.store.addPaper(record('find1'))
  await app.store.writePages('find1', [
    {
      page: 1,
      width: 612,
      height: 792,
      blocks: [{ id: 'b1', bbox: [72, 72, 200, 20], text: 'Attention is all you need', kind: 'para' }],
    },
    {
      page: 2,
      width: 612,
      height: 792,
      blocks: [{ id: 'b2', bbox: [72, 100, 300, 20], text: '布局与布局之间', kind: 'para' }],
    },
  ])
  const found = await call(`/papers/find1/search?q=${encodeURIComponent('布局')}`)
  assert.equal(found.status, 200)
  assert.equal(found.body.total, 2)
  assert.equal(found.body.hits.length, 2)
  assert.equal(found.body.hits[0].page, 2)
  assert.equal(found.body.hits[0].blockId, 'b2')
  assert.deepEqual(found.body.hits[0].bbox, [72, 100, 300, 20])
  assert.equal(found.body.hits[0].quote.slice(found.body.hits[0].quoteStart, found.body.hits[0].quoteStart + found.body.hits[0].quoteLength), '布局')
  const insensitive = await call('/papers/find1/search?q=ATTENTION')
  assert.equal(insensitive.body.total, 1)
  assert.equal(insensitive.body.hits[0].page, 1)
  const empty = await call('/papers/find1/search?q=')
  assert.equal(empty.body.total, 0)
  assert.equal((await call('/papers/nope/search?q=x')).status, 404)
  const absent = await call(`/papers/find1/search?q=${encodeURIComponent('没有')}`)
  assert.equal(absent.body.total, 0)
  assert.equal(absent.body.noText, undefined)
  await app.store.addPaper(record('find2'))
  const noText = await call('/papers/find2/search?q=x')
  assert.equal(noText.body.noText, true)

  // ── import targets a folder ──────────────────────────────────────────────
  const target = await call('/folders', json({ name: '导入目标' }))
  const source = path.join(home, 'inbox', 'sample.pdf')
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.writeFile(source, '%PDF-1.4\n% test\n')
  const queued = await call('/import/file', json({ path: source, folder: target.body.id }))
  assert.equal(queued.status, 202)
  let job = await app.store.readJob(queued.body.jobId)
  for (let attempt = 0; attempt < 25 && !job; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40))
    job = await app.store.readJob(queued.body.jobId)
  }
  assert.equal(job?.source?.folder, target.body.id)

  console.log('all library HTTP checks passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(home, { recursive: true, force: true })
}
