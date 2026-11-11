/**
 * Digest pipeline guards.
 *
 * These cover the failures seen in the real app: a reasoning model spending
 * the whole per-window budget, an empty JSON object, top-level arrays and
 * string fields, and a short paper that used to produce zero map windows.
 */
import assert from 'node:assert/strict'
import { buildSummary, summaryHasContent } from '../dist/host/ai/summarize.js'
import { Summoner } from '../dist/host/ai/summoner.js'

const paper = { id: 'p1', title: 'Test Paper', abstract: 'An abstract about long sequences.' }

function page(text, pageNumber = 1) {
  return {
    page: pageNumber,
    width: 600,
    height: 800,
    blocks: [{
      id: `b${pageNumber}`,
      bbox: [0, 0, 100, 20],
      kind: 'para',
      text,
    }],
  }
}

const longText = 'We study long sequence modeling with structured state spaces. '.repeat(24)
const shortText = '这是一个很短的摘要正文，用来确认短论文不会因为没有窗口而直接失败。'.repeat(4)

let mapCalls = 0
const retrySummoner = {
  async complete({ maxTokens }) {
    mapCalls += 1
    if (maxTokens < 3000) return ''
    return '[Problem] 长序列建模\n[Method] 结构化状态空间\n[Finding] 线性时间'
  },
  async json() {
    return {
      tldr: '用结构化状态空间做线性时间序列建模。',
      problem: '长序列上的计算与显存开销。',
      method: '结构化状态空间递推。',
      findings: ['线性时间', '长程依赖'],
      limitations: ['极端长度仍需验证'],
      reusable: ['状态空间参数化'],
    }
  },
  async target() {
    return { provider: 'stub', model: 'stub-1' }
  },
}

const retried = await buildSummary({
  summoner: retrySummoner,
  paper,
  pages: [page(longText)],
})
assert.equal(mapCalls, 2, 'an empty map window is retried once')
assert.equal(retried.model, 'stub/stub-1')
assert.ok(retried.tldr.includes('结构化'))
assert.ok(summaryHasContent(retried))

// A model may return the object inside an array, and list fields as text.
const tolerantSummoner = {
  async complete() {
    return '[Problem] 测试'
  },
  async json() {
    return [{
      tldr: '',
      problem: '作者要解决的问题。',
      method: '作者的方法。',
      findings: '结论一\n- 结论二',
      limitations: '局限一；局限二',
      reusable: ['可复用点'],
      authors: 'Alice, Bob',
      year: '2024',
    }]
  },
  async target() {
    return { provider: 'stub', model: 'stub-1' }
  },
}
const tolerant = await buildSummary({
  summoner: tolerantSummoner,
  paper,
  pages: [page(longText)],
})
assert.equal(tolerant.tldr, '作者要解决的问题。', 'a missing tldr falls back to the problem')
assert.deepEqual(tolerant.findings, ['结论一', '结论二'])
assert.deepEqual(tolerant.limitations, ['局限一', '局限二'])
assert.deepEqual(tolerant.refined.authors, ['Alice', 'Bob'])
assert.equal(tolerant.refined.year, 2024)

// An empty JSON object must fail rather than overwrite a good guide.
let emptyJsonCalls = 0
const emptySummoner = {
  async complete() {
    return '[Problem] 测试'
  },
  async json() {
    emptyJsonCalls += 1
    return {}
  },
  async target() {
    return null
  },
}
await assert.rejects(
  buildSummary({ summoner: emptySummoner, paper, pages: [page(longText)] }),
  /空导读/,
)
assert.equal(emptyJsonCalls, 2, 'an empty digest is retried once')

// All-empty map output gets a precise error instead of a generic failure.
let emptyMapCalls = 0
const emptyMapSummoner = {
  async complete() {
    emptyMapCalls += 1
    return '   '
  },
  async json() {
    throw new Error('should not reach reduce')
  },
  async target() {
    return null
  },
}
await assert.rejects(
  buildSummary({ summoner: emptyMapSummoner, paper, pages: [page(longText)] }),
  /分节内容/,
)
assert.equal(emptyMapCalls, 2, 'the single window is retried once')

// A short body must still produce one window.
const shortSummoner = {
  async complete() {
    return '[Problem] 短论文'
  },
  async json() {
    return { tldr: '短论文也能生成导读。', problem: '短正文', method: '', findings: [], limitations: [], reusable: [] }
  },
  async target() {
    return { provider: 'stub', model: 'stub-1' }
  },
}
const short = await buildSummary({ summoner: shortSummoner, paper, pages: [page(shortText)] })
assert.equal(short.tldr, '短论文也能生成导读。')

// Digest calls ask the adapter for a low reasoning effort when it supports it,
// because a high-effort reasoning model can spend the whole window budget on
// hidden tokens and return no visible text at all.
const efforts = []
const streamLlm = (ids) => ({
  listProviders: () => [{ id: 'stub', name: 'Stub' }],
  listModels: async () => [{ id: 'stub-1' }],
  resolveModelInfo: async () => ({ reasoning: { efforts: ids.map((id) => ({ id })) } }),
  async *stream(options) {
    efforts.push(options.reasoningEffort)
    yield { type: 'text-delta', text: 'ok' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
})
const lowSummoner = new Summoner({
  getLlm: () => streamLlm(['low', 'high']),
  getSelection: () => ({ provider: 'stub', model: 'stub-1' }),
  getConfig: () => ({ provider: 'stub', model: 'stub-1' }),
})
assert.equal(await lowSummoner.complete({ user: 'test', reasoningEffort: 'low' }), 'ok')
assert.equal(efforts.at(-1), 'low')

const highOnlySummoner = new Summoner({
  getLlm: () => streamLlm(['high']),
  getSelection: () => ({ provider: 'stub', model: 'stub-1' }),
  getConfig: () => ({ provider: 'stub', model: 'stub-1' }),
})
await highOnlySummoner.complete({ user: 'test', reasoningEffort: 'low' })
assert.equal(efforts.at(-1), undefined, 'an unsupported effort is not sent')

console.log('all summary checks passed')
