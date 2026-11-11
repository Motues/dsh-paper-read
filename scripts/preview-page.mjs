/**
 * Screenshot a real translated page: original PDF bitmap + re-typeset Chinese.
 *
 * Usage:
 *   node scripts/preview-page.mjs [paperPdf] [page] [translationJson] [outDir]
 *
 * Defaults to page 4 of "Attention Is All You Need" and the translation cached
 * in the local DSH library. The preview server exists so pdf.js can load its
 * worker as a module (file:// blocks that), and the screenshot goes through the
 * DevTools protocol because `--screenshot` fires before the canvas is painted.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { extractPages } from '../dist/host/pdf/extract.js'

const home = process.env.USERPROFILE ?? process.env.HOME ?? 'C:/Users/Motues'
const pdfPath = path.resolve(process.argv[2]
  || path.join(home, '.dsh/paperreader/inbox/mw4xgeh5-1706.03762 - Attention Is All You Need.pdf'))
const pageNumber = Number(process.argv[3] || 4)
const translationPath = path.resolve(process.argv[4]
  || path.join(home, '.dsh/paperreader/papers/86c07be7af4b/translation.json'))
const outDir = path.resolve(process.argv[5] || '.tmp/page-preview')
await fs.mkdir(outDir, { recursive: true })

const sha1 = (value) => createHash('sha1').update(value).digest('hex')
const normalize = (value) => value.replace(/\s+/g, ' ').trim()

const bytes = await fs.readFile(pdfPath)
const { pages } = await extractPages(new Uint8Array(bytes))
const page = pages.find((item) => item.page === pageNumber)
if (!page) throw new Error(`page ${pageNumber} not found`)

const file = JSON.parse(await fs.readFile(translationPath, 'utf8'))
const entry = file.pages?.[String(pageNumber)]
if (!entry) throw new Error(`page ${pageNumber} has no cached translation`)

const byHash = new Map()
for (const [id, hash] of Object.entries(entry.sources ?? {})) {
  const value = entry.blocks?.[id]
  if (typeof value === 'string' && value !== '') byHash.set(hash, value)
}
const blocks = {}
let translated = 0
for (const block of page.blocks) {
  const direct = entry.blocks?.[block.id]
  const hash = sha1(normalize(block.text))
  let value = (direct && entry.sources?.[block.id] === hash ? direct : undefined) ?? byHash.get(hash)
  if (value) {
    blocks[block.id] = value
    translated += 1
  }
}
console.log(`page ${pageNumber}: ${page.blocks.length} blocks, ${translated} translated`)

const payload = {
  page,
  status: 'done',
  order: page.blocks.map((block) => block.id),
  blocks,
  skipped: {},
}
await fs.writeFile(path.join(outDir, 'payload.json'), JSON.stringify(payload))

const result = await build({
  entryPoints: [path.join(process.cwd(), 'scripts/preview/page.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  legalComments: 'none',
  logLevel: 'warning',
  absWorkingDir: process.cwd(),
  define: { 'process.env.NODE_ENV': '"production"' },
})
const bundle = result.outputFiles[0].text
const worker = await fs.readFile(path.join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))
const pdfBytes = await fs.readFile(pdfPath)

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>PaperReader · page preview</title></head>
<body><div id="root"></div><script src="/bundle.js"></script></body></html>`

const server = http.createServer((request, response) => {
  const url = (request.url ?? '/').split('?')[0]
  if (process.env.PR_PREVIEW_DEBUG) console.error('REQ', request.url, request.headers.range ?? '')
  if (url === '/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(bundle)
    return
  }
  if (url === '/pdf.worker.mjs') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(worker)
    return
  }
  if (url === '/paper.pdf') {
    response.writeHead(200, { 'content-type': 'application/pdf' })
    response.end(pdfBytes)
    return
  }
  if (url === '/payload.json') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(payload))
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0
console.log(`preview server on http://127.0.0.1:${port}`)

const browsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = browsers.find((candidate) => existsSync(candidate))
if (!browser) throw new Error('no headless browser found')

const pngPath = path.join(outDir, `page-${pageNumber}.png`)
await fs.rm(pngPath, { force: true })

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-preview-edge-'))
const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--force-prefers-reduced-motion',
  '--force-device-scale-factor=2',
  '--window-size=760,1080',
  '--remote-debugging-port=0',
  `--user-data-dir=${userDataDir}`,
  `http://127.0.0.1:${port}/?width=600`,
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function devtoolsPort() {
  const file = path.join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const [line] = (await fs.readFile(file, 'utf8')).split('\n')
      const value = Number(line)
      if (Number.isInteger(value) && value > 0) return value
    } catch {
      /* browser is still starting */
    }
    await wait(250)
  }
  throw new Error('devtools port not available')
}

try {
  const devtools = await devtoolsPort()
  let target = null
  for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
    const list = await fetch(`http://127.0.0.1:${devtools}/json/list`).then((response) => response.json())
    target = list.find((item) => item.type === 'page' && String(item.url).includes(`127.0.0.1:${port}`))
    if (!target) await wait(250)
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('no page target')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entryPending = pending.get(message.id)
    if (!entryPending) return
    pending.delete(message.id)
    if (message.error) entryPending.reject(new Error(message.error.message))
    else entryPending.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      console.error('PAGE ERROR', details?.exception?.description ?? details?.text)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      console.error('PAGE LOG', message.params.entry.text)
    }
  })
  await send('Runtime.enable')
  await send('Log.enable')

  const probe = "(() => { const canvas = document.querySelector('canvas.pr-trans-canvas'); "
    + "return Boolean(canvas && canvas.width > 10 && document.querySelectorAll('.pr-transblock').length > 0); })()"
  let painted = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const evaluated = await send('Runtime.evaluate', { expression: probe, returnByValue: true })
    if (evaluated?.result?.value) {
      painted = true
      break
    }
    await wait(250)
  }
  if (!painted) throw new Error('page never painted')
  await wait(800)
  if (process.env.PR_PREVIEW_DUMP) {
    const dump = await send('Runtime.evaluate', {
      expression: "JSON.stringify([...document.querySelectorAll('.pr-transblock')].map((element) => ({"
        + "top: element.style.top, left: element.style.left, height: element.style.height,"
        + "size: element.style.fontSize, line: element.style.lineHeight,"
        + "scroll: element.scrollHeight, client: element.clientHeight,"
        + "text: element.textContent.slice(0, 16) })))",
      returnByValue: true,
    })
    const rows = JSON.parse(dump.result.value)
    for (const [index, row] of rows.entries()) {
      const overflow = Number(row.scroll) > Number(row.client) + 1
      if (overflow || process.env.PR_PREVIEW_DUMP === 'all') {
        console.log(index, overflow ? 'OVERFLOW' : 'ok', JSON.stringify(row))
      }
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(pngPath, Buffer.from(shot.data, 'base64'))
  socket.close()
} finally {
  try {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    child.kill()
  }
  server.close()
  server.closeAllConnections?.()
  await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}
console.log(`screenshot ${pngPath}`)
