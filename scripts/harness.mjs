/**
 * Test harness: boots the host app on a plain node http server with a stub
 * model, so routes/pipeline/SSE can be exercised without the DSH runtime.
 */
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../dist/host/app.js'
import { installImportRunner } from '../dist/host/ingest/pipeline.js'
import { createHandler, ROUTE_PATH } from '../dist/host/http/handler.js'

const home = process.argv[3] ?? path.join(os.tmpdir(), 'paperreader-harness')
const port = Number(process.argv[2] ?? 4790)

let calls = 0
const chunkText = (text, size = 24) => {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length > 0 ? out : [text]
}

const stubLlm = {
  listProviders: () => [{ id: 'stub', name: 'Stub' }],
  listModels: async () => [{ provider: 'stub', id: 'stub-1', name: 'Stub 1' }],
  async *stream(options) {
    calls += 1
    const system = options.system ?? ''
    const user = options.messages.map((message) => message.content.map((block) => block.text ?? '').join('')).join('\n')
    let text
    if (system.includes('paper-relation engine')) {
      text = JSON.stringify({
        question: '这篇论文要解决什么',
        method: '测试方法族',
        approach: '用测试装置验证一个假设。',
        claims: ['结论一', '结论二'],
        concepts: ['测试概念', '长序列'],
        tasks: ['测试任务'],
        limitations: ['局限一'],
        fingerprint: '如果另一篇论文也讨论测试概念与长序列建模，就说明相关。',
      })
    } else if (system.includes('substantively related')) {
      text = JSON.stringify([{ index: 0, kind: 'same-method', direction: 'none', reason: '都处理同一类信号', evidenceA: '同一方法', evidenceB: '同类任务', confidence: 0.78 }])
    } else if (system.includes('name one cluster')) {
      text = JSON.stringify({ 0: '测试主题' })
    } else if (system.includes('sits inside a library')) {
      text = JSON.stringify({ text: '它和库里另一篇论文同属测试方法，是该簇的基线。', bullets: ['与另一篇同属测试方法', '库内共两篇'] })
    } else if (system.includes('write a digest of one paper')) {
      text = JSON.stringify({
        tldr: '用一句话说明这篇论文做了什么、凭什么。',
        problem: '作者要解决的问题。',
        method: '作者提出的方法。',
        findings: ['结论一', '结论二'],
        limitations: ['局限一'],
        reusable: ['技巧一'],
        title: null,
        authors: null,
        year: null,
        venue: null,
      })
    } else if (system.includes('判断论文之间的关联')) {
      text = JSON.stringify([{ index: 0, kind: 'same-method', reason: '都处理同一类信号', confidence: 0.8 }])
    } else if (system.includes('检索重排')) {
      text = JSON.stringify([{ index: 0, reason: '直接回答了提问' }])
    } else if (system.includes('section-level facts')) {
      text = '[问题] 测试问题\n[方法] 测试方法\n[结论] 测试结论'
    } else {
      text = `这是第 ${calls} 次调用的测试回答。它引用第 1 页的原文来说明问题。`
    }
    for (const piece of chunkText(text)) {
      yield { type: 'text-delta', index: 0, text: piece }
      await new Promise((resolve) => setTimeout(resolve, 3))
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const app = await createApp({
  home,
  getLlm: () => stubLlm,
  getSelection: () => ({ provider: 'stub', model: 'stub-1' }),
  log: (message, error) => console.log(`[log] ${message}`, error?.message ?? ''),
})
installImportRunner(app)

const workerPath = fileURLToPath(new URL('../dist/vendor/pdf.worker.min.mjs', import.meta.url))
const handler = createHandler(app, { workerPath })

// Reproduce the harness router exactly: a prefix route matches only when the
// pathname equals the prefix or starts with `prefix + '/'`. Calling the handler
// directly would hide a wrong prefix (that bug shipped once already).
const prefixes = new Map([[ROUTE_PATH, handler]])
function matchRoute(pathname) {
  let best
  for (const [prefix, fn] of prefixes) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
    if (!best || prefix.length > best.prefix.length) best = { prefix, fn }
  }
  return best
}

const server = http.createServer((req, res) => {
  const route = matchRoute(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  route.fn(req, res).catch((error) => {
    console.error('[crash]', error)
    if (!res.headersSent) res.writeHead(500)
    res.end('crash')
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`harness listening on http://127.0.0.1:${port} home=${home}`)
})
