/**
 * Bundle the re-typeset page preview and screenshot it with headless Edge.
 *
 * Usage: node scripts/preview-typeset.mjs [outDir]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const outDir = path.resolve(process.argv[2] ?? '.tmp/typeset-preview')
await mkdir(outDir, { recursive: true })

const result = await build({
  entryPoints: [path.join(root, 'scripts/preview/typeset.tsx')],
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

const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>PaperReader · typeset preview</title></head>
<body style="margin:0">
<div id="root"></div>
<script>${bundle}</script>
</body>
</html>`

const htmlPath = path.join(outDir, 'typeset.html')
const pngPath = path.join(outDir, 'typeset.png')
await writeFile(htmlPath, html, 'utf8')
execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--force-prefers-reduced-motion',
  '--force-device-scale-factor=2',
  '--window-size=760,880',
  '--virtual-time-budget=6000',
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replaceAll('\\', '/')}`,
], { stdio: 'ignore' })
console.log(`screenshot ${pngPath}`)
