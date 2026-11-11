/**
 * Library search + metadata / guide editing contract.
 *
 * The search endpoint is deliberately independent of the model: metadata is
 * matched directly, while notes and parsed chunks reuse BM25. This test pins
 * the fields the UI relies on (abstract, venue, identifiers, notes, full text)
 * and the two PATCH endpoints that let a reader repair a record.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-search-'))
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
const json = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const now = new Date().toISOString()
const record = (id, patch) => ({
  id,
  title: id,
  authors: [],
  tags: [],
  folder: null,
  status: 'todo',
  progress: 0,
  source: 'pdf',
  addedAt: now,
  updatedAt: now,
  hasFullText: false,
  hasSummary: false,
  ...patch,
})

try {
  await app.store.addPaper(record('p1', {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    venue: 'NeurIPS',
    abstract: 'We propose the Transformer, based solely on attention mechanisms.',
    doi: '10.5555/attention',
    tags: ['transformer'],
    tldr: '用注意力替代循环。',
  }))
  await app.store.addPaper(record('p2', {
    title: 'Bias Drift in Memristive Arrays',
    authors: ['Jun Wang'],
    year: 2026,
    venue: 'LPR',
    abstract: 'A study of bias drift and device variability.',
    pmid: '26017442',
    tags: ['drift'],
    tldr: '偏置漂移的成因与抑制。',
  }))

  await app.store.writeChunks('p1', [{
    id: 'p1#0',
    paperId: 'p1',
    page: 3,
    blockIds: ['b1'],
    text: 'The encoder uses multi-head attention and positional encoding for sequence modeling.',
    tokens: 20,
    index: 0,
  }])
  await app.store.addNote('p2', {
    body: '这条笔记讨论 attention 与 bias drift 的关系。',
    page: 5,
  })

  // ── metadata fields ──────────────────────────────────────────────────────
  const byAbstract = await call('/search/papers?q=Transformer')
  assert.equal(byAbstract.status, 200)
  assert.deepEqual(byAbstract.body.matches.map((match) => match.paperId), ['p1'])
  assert.ok(byAbstract.body.matches[0].fields.includes('abstract'))

  const byVenue = await call('/search/papers?q=NeurIPS')
  assert.deepEqual(byVenue.body.matches.map((match) => match.paperId), ['p1'])
  assert.ok(byVenue.body.matches[0].fields.includes('venue'))

  const byAuthor = await call(`/search/papers?q=${encodeURIComponent('Jun Wang')}`)
  assert.deepEqual(byAuthor.body.matches.map((match) => match.paperId), ['p2'])
  assert.ok(byAuthor.body.matches[0].fields.includes('author'))

  const byIdentifier = await call('/search/papers?q=10.5555')
  assert.deepEqual(byIdentifier.body.matches.map((match) => match.paperId), ['p1'])
  assert.ok(byIdentifier.body.matches[0].fields.includes('identifier'))

  // ── notes and full text ──────────────────────────────────────────────────
  const byNote = await call(`/search/papers?q=${encodeURIComponent('bias drift 的关系')}`)
  assert.ok(byNote.body.matches.some((match) => match.paperId === 'p2'))
  assert.ok(byNote.body.matches.find((match) => match.paperId === 'p2').fields.includes('note'))

  const byFullText = await call(`/search/papers?q=${encodeURIComponent('positional encoding')}`)
  assert.ok(byFullText.body.matches.some((match) => match.paperId === 'p1'))
  const fullTextHit = byFullText.body.matches.find((match) => match.paperId === 'p1')
  assert.ok(fullTextHit.fields.includes('fulltext'))
  assert.equal(fullTextHit.page, 3)

  assert.equal((await call('/search/papers?q=zzzz-no-hit')).body.total, 0)

  // ── metadata patch ───────────────────────────────────────────────────────
  const patched = await call('/papers/p1', json('PATCH', {
    title: 'Attention Is All You Need (Revised)',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
    year: 2018,
    venue: 'NeurIPS 2017',
    abstract: 'Revised abstract with residual connections.',
    doi: 'https://doi.org/10.5555/attention',
    pmid: '12345678',
  }))
  assert.equal(patched.status, 200)
  assert.equal(patched.body.title, 'Attention Is All You Need (Revised)')
  assert.equal(patched.body.year, 2018)
  assert.equal(patched.body.venue, 'NeurIPS 2017')
  assert.equal(patched.body.pmid, '12345678')

  const detail = await call('/papers/p1')
  assert.equal(detail.body.doi, '10.5555/attention')
  assert.equal(detail.body.abstract, 'Revised abstract with residual connections.')
  assert.deepEqual(detail.body.authors, ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'])
  assert.equal((await call('/search/papers?q=residual')).body.matches[0].paperId, 'p1')

  const badYear = await call('/papers/p1', json('PATCH', { year: 12 }))
  assert.equal(badYear.status, 400)
  const badDoi = await call('/papers/p1', json('PATCH', { doi: 'not-a-doi' }))
  assert.equal(badDoi.status, 400)

  // ── guide edit ───────────────────────────────────────────────────────────
  await app.store.writeSummary('p1', {
    paperId: 'p1',
    tldr: '旧导读。',
    problem: '旧问题',
    method: '旧方法',
    findings: ['旧结论'],
    limitations: [],
    reusable: [],
    related: [],
    model: 'stub/stub-1',
    createdAt: now,
  })
  const edited = await call('/papers/p1/summary', json('PATCH', {
    tldr: '新导读：$E=mc^2$。',
    findings: ['结论一', '结论二'],
    limitations: ['局限一'],
  }))
  assert.equal(edited.status, 200)
  assert.equal(edited.body.summary.tldr, '新导读：$E=mc^2$。')
  assert.deepEqual(edited.body.summary.findings, ['结论一', '结论二'])
  assert.ok(edited.body.summary.editedAt)
  assert.equal((await app.store.readSummary('p1')).editedAt, edited.body.summary.editedAt)
  assert.equal(app.store.getPaper('p1').tldr, '新导读：$E=mc^2$。')

  // A filter API call combines author / year / venue.
  const filtered = await call(`/papers?author=${encodeURIComponent('Jun Wang')}&year=2026&venue=LPR`)
  assert.deepEqual(filtered.body.papers.map((paper) => paper.id), ['p2'])

  console.log('all search / metadata / guide checks passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(home, { recursive: true, force: true })
}
