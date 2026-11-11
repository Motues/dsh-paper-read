/**
 * Build the relation page into a standalone page and screenshot it with
 * headless Edge — light/dark, graph/list, overview/focused.
 *
 * Usage: node scripts/preview-relations.mjs [outDir]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const outDir = path.resolve(root, process.argv[2] ?? '.tmp/preview')
await mkdir(outDir, { recursive: true })

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

const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = edgeCandidates.find((candidate) => existsSync(candidate))
if (!browser) {
  console.error('no headless browser found (Edge or Chrome)')
  process.exit(1)
}

const screens = [
  { name: 'overview-light', scheme: 'light', focus: null, mode: 'graph' },
  { name: 'focus-light', scheme: 'light', focus: 'mamba', mode: 'graph' },
  { name: 'focus-dark', scheme: 'dark', focus: 'attn', mode: 'graph' },
  { name: 'list-light', scheme: 'light', focus: null, mode: 'list' },
  { name: 'grid-light', scheme: 'light', focus: null, mode: 'graph', empty: true },
  // First visit: the guide opens by itself, so the other screenshots must mark
  // it as seen or every one of them would be a photo of the modal.
  { name: 'guide-light', scheme: 'light', focus: 'mamba', mode: 'graph', guide: true },
  { name: 'guide-dark', scheme: 'dark', focus: 'mamba', mode: 'graph', guide: true },
]

for (const screen of screens) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PaperReader · ${screen.name}</title>
</head>
<body>
<div id="root"></div>
<script>window.__PR_PREVIEW__ = ${JSON.stringify({ scheme: screen.scheme, focus: screen.focus, mode: screen.mode, empty: screen.empty })};</script>
<script>try {
  ${screen.guide
    ? "localStorage.removeItem('paperreader.relations.guide')"
    : "localStorage.setItem('paperreader.relations.guide', 'off')"};
} catch (error) { void error }</script>
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
