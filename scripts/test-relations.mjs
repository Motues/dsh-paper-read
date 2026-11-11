/**
 * Relation engine checks: identifier normalisation, citation matching,
 * bibliographic coupling, concept scoring, adjudication, clustering, edge
 * ledger semantics (symmetric dedupe, rejected pairs, user edges) and the
 * service's graph payload.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../dist/host/library/store.js'
import { createApp } from '../dist/host/app.js'
import { createHandler } from '../dist/host/http/handler.js'
import { installImportRunner } from '../dist/host/ingest/pipeline.js'
import { normalizeDoi, normalizeTitle, paperKeys } from '../dist/host/relations/keys.js'
import { buildCorpus, citationEdges, fuseSignals, shortlist, signalsFor, signalsRecord } from '../dist/host/relations/signals.js'
import { harvestReferences } from '../dist/host/pdf/references.js'
import { detectClusters, groupClusters } from '../dist/host/relations/cluster.js'
import { createRelations } from '../dist/host/relations/service.js'

const stamp = (offset = 0) => new Date(Date.now() - offset).toISOString()
const paper = (id, title, extra = {}) => ({
  id,
  title,
  authors: [],
  tags: [],
  folder: null,
  status: 'todo',
  progress: 0,
  source: 'pdf',
  addedAt: stamp(1000),
  updatedAt: stamp(1000),
  hasFullText: true,
  hasSummary: false,
  ...extra,
})

// ── identifier normalisation ───────────────────────────────────────────────
assert.equal(normalizeDoi('https://doi.org/10.1038/NATURE14539'), '10.1038/nature14539')
assert.equal(normalizeDoi('DOI: 10.1000/xyz.'), '10.1000/xyz')
assert.equal(normalizeTitle('Attention Is All You Need!'), 'attention is all you need')
assert.equal(paperKeys({ doi: '10.1/A', arxivId: 'arXiv:1706.03762v5', pmid: 'PMID: 123', title: 'X' }).arxiv, '1706.03762')

// ── citation matching ──────────────────────────────────────────────────────
const p1 = paper('attn', 'Attention Is All You Need', { doi: '10.1/attn', year: 2017 })
const p2 = paper('lin', 'Linformer: Self-Attention with Linear Complexity', { doi: '10.1/lin', year: 2020 })
const p3 = paper('mamba', 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces', { arxivId: '2312.00752', year: 2023 })
const p4 = paper('optics', 'Thin-Film Lithium Niobate Modulators', { year: 2024 })

const references = new Map([
  ['lin', [
    { title: 'Attention Is All You Need', doi: '10.1/attn' },
    { title: 'A totally unrelated paper about datasets', year: 2019 },
  ]],
  ['mamba', [
    { title: 'Linformer: Self-Attention with Linear Complexity', year: 2020 },
    { title: 'Attention Is All You Need.', year: 2017 },
  ]],
])
const cites = citationEdges({ papers: [p1, p2, p3, p4], references })
assert.equal(cites.length, 3, JSON.stringify(cites.map((edge) => `${edge.from}->${edge.to}`)))
assert.ok(cites.some((edge) => edge.from === 'lin' && edge.to === 'attn' && edge.confidence >= 0.97))
assert.ok(cites.some((edge) => edge.from === 'mamba' && edge.to === 'attn' && edge.confidence >= 0.9))
assert.ok(cites.every((edge) => edge.status === 'confirmed'))

// ── corpus + scoring ───────────────────────────────────────────────────────
const profile = (paperId, method, concepts, fingerprint) => ({
  paperId,
  question: `${method} 问题`,
  method,
  approach: `${method} 的做法`,
  claims: [`${method} 更快`],
  concepts,
  tasks: ['长序列'],
  limitations: [],
  fingerprint,
  contentHash: `hash-${paperId}`,
  model: 'stub/stub-1',
  createdAt: stamp(),
})
const profiles = new Map([
  ['attn', profile('attn', '自注意力', ['注意力机制', '长序列'], '用自注意力替代循环结构处理长序列')],
  ['lin', profile('lin', '线性注意力', ['注意力机制', '线性注意力'], '把自注意力近似成线性复杂度以处理长序列')],
  ['mamba', profile('mamba', '状态空间模型', ['状态空间模型', '长序列'], '用选择性状态空间模型做线性时间序列建模')],
  ['optics', profile('optics', '电光调制', ['光电子', '薄膜铌酸锂'], '薄膜铌酸锂调制器的偏置漂移与抑制')],
])
const papers = [p1, p2, p3, p4]
const corpus = buildCorpus({ papers, profiles, references })
assert.equal(corpus.size, 4)
assert.ok(corpus.docs.get('lin').refs.size >= 1)
assert.ok(corpus.docs.get('lin').phrases.has('注意力机制'))

const near = signalsFor(corpus.docs.get('attn'), corpus.docs.get('lin'))
const far = signalsFor(corpus.docs.get('attn'), corpus.docs.get('optics'))
assert.ok(near.concept > far.concept, `${near.concept} vs ${far.concept}`)
assert.ok(near.claim > far.claim)
assert.ok(near.ref >= 0 && near.ref <= 1)

// ── missing signals are redistributed, not counted as zero ────────────────
// `optics` has a profile but no reference list, so `ref` cannot be computed for
// its pairs; fusing it as 0 used to cap every such paper below the threshold.
const crossDomain = signalsFor(corpus.docs.get('optics'), corpus.docs.get('attn'))
assert.equal(crossDomain.available.ref, false, 'no references on the optics side')
assert.equal(crossDomain.available.concept, true)
const asIfZero = fuseSignals({ ...crossDomain, available: { ref: true, concept: true, claim: true, lexical: true } })
assert.ok(fuseSignals(crossDomain) >= asIfZero, 'the unavailable ref weight must be redistributed')
assert.equal('ref' in signalsRecord(crossDomain), false, 'a missing signal is not persisted as 0')

// ── PDF reference harvesting ──────────────────────────────────────────────
const pageText = (text) => ({
  page: 1, width: 595, height: 842,
  blocks: [{ id: 'b1', bbox: [0, 0, 595, 780], text, kind: 'para', size: 10 }],
})
const harvested = harvestReferences([
  pageText('1 Introduction\nWe build on prior work [1] and [2].'),
  pageText('References\n[1] Vaswani et al. Attention is all you need. arXiv:1706.03762, 2017.\n[2] Some journal paper. doi:10.1234/abcd.5678\n'),
])
assert.equal(harvested.length, 2, JSON.stringify(harvested))
assert.ok(harvested.some((entry) => entry.arxivId === '1706.03762'))
assert.ok(harvested.some((entry) => entry.doi === '10.1234/abcd.5678'))
assert.ok(harvested.every((entry) => entry.raw && entry.raw.length > 0), 'each entry keeps a readable snippet')
assert.equal(harvestReferences([pageText('No reference section at all.')]).length, 0)

const bundled = harvestReferences([
  pageText(
    'References\n'
    + '[1] Preprint. doi:10.48550/arXiv.2312.00752\n'
    + '[2] Duplicate. arXiv:2312.00752\n'
    + '[3] A third unrelated work with a long title, published in a journal in 2019.\n',
  ),
])
assert.equal(bundled.length, 1, 'an arXiv DOI and its arXiv id are the same paper')
assert.equal(bundled[0].arxivId, '2312.00752')

const pairs = shortlist(corpus)
assert.ok(pairs.some((pair) => [pair.a, pair.b].sort().join('|') === 'attn|lin'))
assert.equal(pairs.some((pair) => pair.a === 'optics' || pair.b === 'optics'), false, 'optics should not be shortlisted')
const top = pairs[0]
assert.ok(top.score >= 0.18)

// ── clustering ─────────────────────────────────────────────────────────────
const labels = detectClusters(['a', 'b', 'c'], [
  { from: 'a', to: 'b', weight: 0.9 },
  { from: 'b', to: 'c', weight: 0.1 },
])
assert.equal(labels.get('a'), labels.get('b'))
const groups = groupClusters(labels, profiles, new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]))
assert.ok(groups.length >= 1)
assert.equal(groups[0].paperIds.includes('a'), true)

// ── store ledger ───────────────────────────────────────────────────────────
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-rel-'))
try {
  const store = new Store(home)
  await store.load()
  for (const entry of papers) await store.addPaper(entry)
  await store.writeReferences('lin', references.get('lin'))
  await store.writeReferences('mamba', references.get('mamba'))

  await store.upsertRelations([{
    from: 'attn', to: 'lin', kind: 'same-method', reason: '同属注意力路线', origin: 'auto', confidence: 0.7,
  }])
  await store.upsertRelations([{
    from: 'lin', to: 'attn', kind: 'same-method', reason: '同属注意力路线', origin: 'auto', confidence: 0.8,
  }])
  assert.equal(store.readRelations().length, 1, 'symmetric edges must dedupe across direction')
  assert.equal(store.readRelations()[0].confidence, 0.8, 'the stronger observation wins')

  await store.setRelationStatus('lin', 'attn', 'same-method', 'rejected', 'user')
  await store.upsertRelations([{
    from: 'attn', to: 'lin', kind: 'same-method', reason: 'auto retry', origin: 'auto', confidence: 0.9,
  }])
  const rejected = store.readRelations()[0]
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.reason, '同属注意力路线', 'auto cascade must not overwrite a user rejection')

  await store.upsertRelations([{
    from: 'lin', to: 'mamba', kind: 'cites', reason: 'user says', origin: 'user', confidence: 0.99,
  }])
  await store.replaceAutoRelations([{
    from: 'attn', to: 'mamba', kind: 'cites', reason: 'fresh', origin: 'auto', confidence: 0.9, status: 'confirmed',
  }])
  assert.ok(store.readRelations().some((edge) => edge.from === 'lin' && edge.to === 'mamba'), 'user edges survive rebuilds')
  assert.ok(store.readRelations().some((edge) => edge.from === 'attn' && edge.to === 'mamba'), 'new edges are added')
  assert.equal(store.readRelations().some((edge) => edge.kind === 'same-method' && edge.status !== 'rejected'), false)

  // Old-shape edge file: status defaults to confirmed.
  const legacyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-rel-legacy-'))
  await fs.mkdir(path.join(legacyHome, 'paperreader'), { recursive: true })
  await fs.writeFile(
    path.join(legacyHome, 'paperreader', 'relations.json'),
    JSON.stringify([{ from: 'a', to: 'b', kind: 'same-method', reason: 'old', origin: 'auto', confidence: 0.6 }]),
    'utf8',
  )
  const legacy = await new Store(legacyHome).load()
  assert.equal(legacy.readRelations()[0].status, 'confirmed')
  await fs.rm(legacyHome, { recursive: true, force: true })

  // ── service: profiles + adjudication + graph ─────────────────────────────
  let jsonCalls = 0
  const scripted = {
    async available() { return true },
    async target() { return { provider: 'stub', model: 'stub-1' } },
    async json({ system, user }) {
      jsonCalls += 1
      if (system.includes('paper-relation engine')) {
        const title = String(user).split('\n')[0].replace(/^标题：/, '')
        const match = [...profiles.entries()].find(([id]) => papers.find((entry) => entry.id === id)?.title === title)
        if (match) {
          const { contentHash, model, createdAt, ...rest } = match[1]
          void contentHash
          void model
          void createdAt
          return rest
        }
        return {
          question: title,
          method: '未知',
          approach: '',
          claims: [],
          concepts: [],
          tasks: [],
          limitations: [],
          fingerprint: title,
        }
      }
      if (system.includes('substantively related')) {
        const blocks = String(user).split(/\[(\d+)\]/).slice(1)
        const rows = []
        for (let index = 0; index < blocks.length; index += 2) {
          const other = blocks[index + 1] ?? ''
          if (other.includes('Lithium Niobate')) continue
          rows.push({
            index: Number(blocks[index]),
            kind: 'same-method',
            direction: 'none',
            reason: '都沿注意力或状态空间路线处理长序列',
            evidenceA: '线性复杂度',
            evidenceB: '长序列建模',
            confidence: 0.78,
          })
        }
        return rows
      }
      if (system.includes('name one cluster')) return { 0: '线性序列建模' }
      return {}
    },
  }

  const relations = createRelations({ store, summoner: scripted, log: () => {} })
  const analyzed = await relations.analyzePaper(store.getPaper('lin'))
  assert.ok(analyzed.profile, 'profile is written')
  assert.ok((await store.readProfile('lin')).concepts.includes('线性注意力'))
  assert.ok(analyzed.edges.some((edge) => edge.kind === 'cites' && edge.to === 'attn'))

  await relations.rebuild()
  const rebuilt = store.readRelations()
  assert.ok(rebuilt.length >= 2, JSON.stringify(rebuilt.map((edge) => `${edge.from}->${edge.to}:${edge.kind}`)))
  assert.ok(rebuilt.every((edge) => edge.kind !== 'same-method' || edge.status === 'rejected' || edge.status === 'confirmed' || edge.status === 'suggested'))

  const graph = await relations.graph()
  assert.equal(graph.stats.papers, 4)
  assert.ok(graph.nodes.every((node) => typeof node.cluster === 'string'))
  assert.ok(graph.clusters.some((cluster) => cluster.paperIds.length > 0))
  assert.equal(graph.stats.ai, true)
  assert.ok(graph.edges.every((edge) => edge.status !== 'rejected'))

  // A scoped rebuild must not wipe edges that do not touch the target.
  await relations.rebuild({ scope: 'lin' })
  const scoped = store.readRelations()
  assert.ok(scoped.some((edge) => edge.from === 'mamba' && edge.to === 'attn' && edge.kind === 'cites'),
    'scoped rebuild keeps unrelated edges')
  assert.ok(scoped.some((edge) => edge.from === 'lin' && edge.to === 'attn' && edge.kind === 'cites'),
    'scoped rebuild re-derives the target edges')

  const focused = await relations.graph({ focus: 'attn', depth: 1 })
  assert.ok(focused.nodes.some((node) => node.id === 'attn'))
  assert.ok(focused.nodes.length <= graph.nodes.length)

  const insight = await relations.insight('lin')
  assert.equal(insight, null, 'a missing insight is null, never a thrown 500')

  const view = await relations.relationView('lin')
  assert.ok(view.edges.length >= 1)
  const attnView = await relations.relationView('attn')
  const incomingCite = attnView.edges.find((edge) => edge.kind === 'cites' && edge.paperId === 'lin')
  assert.ok(incomingCite, 'attention has an incoming citation from linformer')
  assert.equal(incomingCite.direction, 'in')

  // The settings switch must stop every relations-page model call, not just
  // hide the insight: rebuild, analysis and the graph all stay deterministic.
  const callsBeforeOff = jsonCalls
  store.config.relationsUseModel = false
  await relations.rebuild()
  assert.equal(jsonCalls, callsBeforeOff, 'model switch off makes no model calls')
  const offGraph = await relations.graph()
  assert.equal(offGraph.stats.ai, false)
  assert.equal(offGraph.stats.aiDisabled, true)
  assert.ok(offGraph.edges.every((edge) => edge.kind === 'cites'), 'only deterministic citations survive')
  const offAnalyzed = await relations.analyzePaper(store.getPaper('lin'))
  assert.equal(jsonCalls, callsBeforeOff, 'analyzePaper also respects the switch')
  assert.ok(offAnalyzed.edges.every((edge) => edge.kind === 'cites'))
  store.config.relationsUseModel = true

  // ── HTTP surface: graph before :id, rebuild job, feedback, insight ────────
  const httpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-rel-http-'))
  try {
    const seed = new Store(httpHome)
    await seed.load()
    await seed.addPaper(paper('a1', 'Attention Is All You Need', { doi: '10.1/http-attn', year: 2017 }))
    await seed.addPaper(paper('a2', 'A Linear Attention Variant', { doi: '10.1/http-lin', year: 2021 }))
    await seed.writeReferences('a2', [{ title: 'Attention Is All You Need', doi: '10.1/http-attn' }])

    const app = await createApp({ home: httpHome, getLlm: () => undefined, getSelection: () => undefined, log: () => {} })
    installImportRunner(app)
    const handler = createHandler(app)
    const server = http.createServer((request, response) => {
      handler(request, response).catch((error) => {
        response.statusCode = 500
        response.end(String(error))
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/paperreader`
    const call = async (route, init) => {
      const response = await fetch(base + route, init)
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null }
    }

    const before = await call('/relations/graph')
    assert.equal(before.status, 200)
    assert.equal(before.body.stats.papers, 2)
    assert.equal(before.body.stats.ai, false)
    assert.equal(before.body.nodes.length, 2)

    // A second record of the same paper must not become a semantic edge; it is
    // a duplicate badge instead.
    await app.store.addPaper(paper('a3', 'Attention Is All You Need', { doi: '10.1/http-attn-copy', addedAt: stamp(500) }))
    await app.store.upsertRelations([{
      from: 'a1', to: 'a3', kind: 'same-method', reason: 'duplicate', origin: 'auto', confidence: 0.9, status: 'confirmed',
    }])
    const withDuplicate = await call('/relations/graph')
    assert.equal(withDuplicate.body.nodes.length, 3)
    assert.equal(withDuplicate.body.edges.some((edge) => (
      (edge.from === 'a1' && edge.to === 'a3') || (edge.from === 'a3' && edge.to === 'a1')
    )), false, 'duplicate records are not a relation')
    assert.ok(withDuplicate.body.nodes.some((node) => node.duplicateOf), 'duplicate badge is set')

    const queued = await call('/relations/rebuild', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'all' }),
    })
    assert.equal(queued.status, 200)
    assert.ok(queued.body.jobId)
    await app.waitIdle()
    const job = await app.store.readJob(queued.body.jobId)
    assert.equal(job.state, 'done', JSON.stringify(job.error ?? job.warnings ?? []))

    const after = await call('/relations/graph')
    assert.ok(after.body.edges.some((edge) => edge.kind === 'cites' && edge.to === 'a1'))
    const single = await call('/relations/a1')
    assert.equal(single.status, 200)
    assert.ok(single.body.edges.some((edge) => edge.paperId === 'a2' && edge.direction === 'in'))

    const insight = await call('/relations/insights/a1')
    assert.equal(insight.status, 200)
    assert.equal(insight.body.insight, null)

    const rejected = await call('/relations/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'a2', to: 'a1', kind: 'cites', action: 'reject' }),
    })
    assert.equal(rejected.status, 200)
    const hidden = await call('/relations/graph')
    assert.equal(hidden.body.edges.some((edge) => edge.kind === 'cites' && edge.to === 'a1'), false,
      'rejected edges leave the graph')

    const badAction = await call('/relations/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'a2', to: 'a1', kind: 'cites', action: 'explode' }),
    })
    assert.equal(badAction.status, 400)

    server.close()
  } finally {
    await fs.rm(httpHome, { recursive: true, force: true })
  }

  // ── the citation layer repairs itself from the PDF ───────────────────────
  const harvestHome = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-rel-harvest-'))
  try {
    const harvestStore = new Store(harvestHome)
    await harvestStore.load()
    await harvestStore.addPaper(paper('ssm', 'Selective State Space Models', { arxivId: '2312.00752' }))
    await harvestStore.addPaper(paper('attn2', 'Attention Is All You Need', { arxivId: '1706.03762' }))
    await harvestStore.writePages('ssm', [
      pageText(
        'References\n'
        + '[1] Vaswani et al. Attention is all you need. arXiv:1706.03762\n'
        + '[2] Other work. arXiv:2006.04768\n'
        + '[3] A third unrelated work with a long title, published in a journal in 2019.\n',
      ),
    ])
    const quiet = {
      async available() { return false },
      async target() { return null },
      async json() { return {} },
    }
    const repair = createRelations({ store: harvestStore, summoner: quiet, log: () => {} })
    await repair.rebuild()
    const stored = await harvestStore.readReferences('ssm')
    assert.ok(stored.length >= 2, `harvested references: ${JSON.stringify(stored)}`)
    const repaired = await repair.graph()
    assert.ok(
      repaired.edges.some((edge) => edge.kind === 'cites' && edge.from === 'ssm' && edge.to === 'attn2'),
      `harvested citation became an edge: ${JSON.stringify(repaired.edges)}`,
    )
    assert.equal(repaired.stats.hidden, 0)
  } finally {
    await fs.rm(harvestHome, { recursive: true, force: true })
  }

  console.log('all relation engine checks passed')
} finally {
  await fs.rm(home, { recursive: true, force: true })
}
