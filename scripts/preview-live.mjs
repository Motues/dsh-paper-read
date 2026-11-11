/**
 * Screenshot the relation page with data fetched from a running host.
 *
 * Usage: node scripts/preview-live.mjs [baseUrl] [outDir]
 * Defaults: http://127.0.0.1:8548 and .tmp/preview
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const base = (process.argv[2] ?? 'http://127.0.0.1:8548').replace(/\/$/, '')
const outDir = path.resolve(process.argv[3] ?? '.tmp/preview')
await mkdir(outDir, { recursive: true })

const api = `${base}/api/paperreader`
const graph = await fetch(`${api}/relations/graph`).then((response) => response.json())
const library = await fetch(`${api}/papers`).then((response) => response.json())
if (!graph?.nodes || !library?.papers) throw new Error('the host did not return a graph payload')
console.log(`live data: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${library.papers.length} papers`)

const result = await build({
  entryPoints: [path.join(root, 'scripts/preview/relations.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  legalComments: 'none',
  logLevel: 'warning',
  absWorkingDir: root,
  define: { 'process.env.NODE_ENV': '"production"' },
})
const bundle = result.outputFiles[0].text

const browsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = browsers.find((candidate) => existsSync(candidate))
if (!browser) throw new Error('no headless browser found')

const payload = JSON.stringify({ graph, papers: library.papers }).replaceAll('<', '\\u003c')
const mamba = graph.nodes.find((node) => /^Mamba/.test(node.title))?.id ?? null

const screens = [
  { name: 'live-overview-light', scheme: 'light', focus: null, mode: 'graph' },
  { name: 'live-focus-light', scheme: 'light', focus: mamba, mode: 'graph' },
  { name: 'live-focus-dark', scheme: 'dark', focus: mamba, mode: 'graph' },
  { name: 'live-list-light', scheme: 'light', focus: null, mode: 'list' },
]

for (const screen of screens) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>PaperReader · ${screen.name}</title></head>
<body>
<div id="root"></div>
<script>window.__PR_PREVIEW_DATA__ = ${payload};</script>
<script>window.__PR_PREVIEW__ = ${JSON.stringify({ scheme: screen.scheme, focus: screen.focus, mode: screen.mode })};</script>
<script>${bundle}</script>
</body>
</html>`
  const htmlPath = path.join(outDir, `${screen.name}.html`)
  const pngPath = path.join(outDir, `${screen.name}.png`)
  await writeFile(htmlPath, html, 'utf8')
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--force-prefers-reduced-motion',
    '--force-device-scale-factor=1',
    '--window-size=1440,900',
    '--virtual-time-budget=8000',
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replaceAll('\\', '/')}`,
  ], { stdio: 'ignore' })
  console.log(`screenshot ${pngPath}`)
}
