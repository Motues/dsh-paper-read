/**
 * Reader geometry checks against the real client bundle, with pdf.js stubbed
 * out: zoom must be a single transform on a fixed-geometry layer (no glyph
 * re-render, no immediate re-raster), page turns must re-raster immediately,
 * and the PDF view must not fetch `pages.json` at all.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
  url: 'http://127.0.0.1:12462/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.getSelection = () => window.getSelection()
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.ResizeObserver = globalThis.ResizeObserver
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
// jsdom lacks rAF; the reader restores/tracks scroll on the next frame.
globalThis.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id)
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}

const PAGE_W = 600
const PAGE_H = 800

window.__pdfRenders = []

const pdfStub = `
const PAGE_W = 600
const PAGE_H = 800
export const textSpans = (content, viewport) => (content.items || []).map((item) => ({
  text: item.str,
  left: item.transform[4] * viewport.scale,
  top: (item.transform[5] - 10) * viewport.scale,
  width: (item.width || 0) * viewport.scale,
  fontSize: 10 * viewport.scale,
}))
export const renderPage = (page, canvas, options) => {
  const list = (window.__pdfRenders = window.__pdfRenders || [])
  list.push({ page: page.n, options })
  return Promise.resolve()
}
export const loadDocument = () => Promise.resolve({
  numPages: 3,
  destroy: () => Promise.resolve(),
  getPage: (number) => Promise.resolve({
    n: number,
    getViewport: ({ scale }) => ({ width: PAGE_W * scale, height: PAGE_H * scale, scale }),
    getTextContent: () => Promise.resolve({
      items: Array.from({ length: 3 }, (_, index) => ({
        str: 'p' + number + '-w' + index,
        transform: [10, 0, 0, 10, 60, 700 - index * 20],
        width: 40,
      })),
    }),
  }),
})
`

const bundle = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__paperreaderBundle',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  legalComments: 'none',
  logLevel: 'warning',
  define: { __PR_BUILD__: JSON.stringify('test'), __PR_VERSION__: JSON.stringify('test') },
  plugins: [{
    name: 'stub-pdf',
    setup(build) {
      build.onResolve({ filter: /pdf\.js$/ }, () => ({ path: 'pdf-stub', namespace: 'pdfstub' }))
      build.onLoad({ filter: /.*/, namespace: 'pdfstub' }, () => ({ contents: pdfStub, loader: 'js' }))
    },
  }],
})
const code = `window.__ModuleLoader__.load({ id: "paperreader", factory: (require) => {
${bundle.outputFiles[0].text}
return __paperreaderBundle;
}});`

const paper = {
  id: 'p1',
  title: 'Zoom Geometry',
  authors: ['A. Author'],
  authorLine: 'A. Author',
  year: 2026,
  venue: 'LPR',
  tags: [],
  folder: null,
  status: 'reading',
  progress: 0,
  source: 'pdf',
  pageCount: 3,
  addedAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  tldr: '',
  hasFullText: true,
  hasSummary: false,
  fileUrl: 'http://127.0.0.1:12462/pdf/p1.pdf',
  pdfUnavailable: null,
  lastReadAt: null,
  lastReadPage: 1,
}

const detail = {
  ...paper,
  abstract: '',
  doi: '',
  pmid: '',
  references: [],
  summary: null,
  annotations: [],
  notes: [],
  lastRead: { page: 1, scrollTop: 0, at: null },
}

const chat = { sessionId: 'pr-p1', messages: [], context: null, route: null }

const library = {
  papers: [paper],
  folders: [],
  unfiled: 1,
  tags: [],
  counts: { all: 1, todo: 0, reading: 1, done: 0, recent: 1 },
}

const calls = []
globalThis.fetch = async (url, init) => {
  const path = String(url)
  calls.push(`${init?.method ?? 'GET'} ${path}`)
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  if (path.includes('/papers/p1/pages/')) return json({ page: 1, width: PAGE_W, height: PAGE_H, blocks: [] })
  if (path.includes('/papers/p1/annotations')) return json({ annotations: [] })
  if (path.includes('/papers/p1/chat')) return json(chat)
  if (path.includes('/papers/p1')) return json(detail)
  if (path.includes('/relations/p1')) return json({ paperId: 'p1', edges: [] })
  if (path.includes('/relations')) return json({ edges: [] })
  if (path.includes('/folders')) return json({ folders: [], unfiled: 1 })
  if (path.includes('/models')) return json({ available: true, providers: [], default: null, current: null })
  if (path.includes('/config')) return json({ watchFolders: [], provider: '', model: '', autoSummarize: false, maxImportBytes: 0, inbox: '', home: '', available: false, route: null })
  if (path.includes('/papers')) return json(library)
  return json({})
}

let captured = null
window.__ModuleLoader__ = {
  load({ factory }) {
    captured = { module: factory((name) => {
      if (name === 'react') return React
      if (name === 'react/jsx-runtime') return jsxRuntime
      throw new Error(`unexpected require: ${name}`)
    }) }
  },
}
new window.Function(code).call(window)

const slots = []
const ctx = {
  slots: {
    inject(name, factory) { slots.push({ name, result: factory() }) },
    register(options, component) { return { options, component } },
  },
  effect(fn) { if (typeof fn === 'function') fn() },
  on() { return () => {} },
  theme: { getTheme: () => ({ active: { colorScheme: 'light' } }) },
  uiWorkspace: { pickDirectory: async () => '' },
  get() { return undefined },
}
captured.module.apply(ctx)
const main = slots.find((slot) => slot.name === 'main')?.result?.component
assert(main, 'client registers a main slot')

const { createRoot } = await import('react-dom/client')
const container = document.getElementById('app')
createRoot(container).render(React.createElement(main, { size: 18 }))
const flush = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))
const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
await flush(220)

const navItem = (label) => [...container.querySelectorAll('.pr-nav-item')]
  .find((button) => button.textContent?.includes(label))
click(navItem('文献库'))
await flush(120)
// The library now opens in list view; switch to cards so this exercises the card.
click(container.querySelector('.pr-seg [title="卡片视图"]'))
await flush(120)
click(container.querySelector('.pr-card'))
await flush(260)

const pageBox = () => container.querySelector('.pr-pdfpage')
const stage = () => container.querySelector('.pr-pdfpage-stage')
const zoomButton = (title) => container.querySelector(`.pr-zoom button[title="${title}"]`)
const renders = () => window.__pdfRenders
// Thumbnails also rasterize (directly, into their own small canvas); the page
// view is the one that goes through the offscreen swap.
const pageRenders = () => renders().filter((entry) => !entry.options.direct)
const pageTextCalls = () => calls.filter((call) => call.includes('/pages/'))

assert(pageBox(), 'reader renders the PDF page box')
assert(stage(), 'page content lives in a zoom layer')
assert.equal(Number.parseFloat(pageBox().style.width), PAGE_W, 'page box is fit-width at 100%')
assert.equal(Number.parseFloat(pageBox().style.height), PAGE_H, 'page box is fit-height at 100%')
assert.equal(stage().style.transform, 'scale(1)', 'layer starts unscaled')
assert.equal(stage().querySelectorAll('.pr-textlayer span').length, 3, 'text layer holds this page\'s glyphs')
assert.equal(pageRenders().length, 1, 'first page is rasterized once')
assert.equal(pageRenders()[0].page, 1)
assert.equal(pageTextCalls().length, 0, 'PDF view does not fetch pages.json')

// Zoom: transform moves now, the bitmap follows once the gesture settles.
click(zoomButton('放大'))
await flush(30)
assert.equal(Number.parseFloat(pageBox().style.width), PAGE_W * 1.1, 'page box follows the zoom step')
assert.equal(stage().style.transform, 'scale(1.1)', 'zoom only rewrites the transform')
assert.equal(stage().querySelectorAll('.pr-textlayer span').length, 3, 'glyph nodes are reused, not rebuilt')
assert.equal(pageRenders().length, 1, 'no raster during the zoom burst')

await flush(260)
assert.equal(pageRenders().length, 2, 'bitmap is repainted after the gesture settles')
assert.equal(pageRenders()[1].page, 1)
assert(Math.abs(pageRenders()[1].options.rasterScale - 1.1) < 0.001, `crisp raster at the new zoom, got ${pageRenders()[1].options.rasterScale}`)
assert.equal(pageRenders()[1].options.cssWidth, PAGE_W, 'raster keeps the 100% CSS box')

// Page turn: immediate raster for the new page, same fixed geometry.
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
await flush(200)
assert.equal(pageBox().style.width, `${PAGE_W * 1.1}px`, 'geometry is unchanged across pages')
assert.equal(pageRenders().length, 3, 'page turn rasterizes immediately')
assert.equal(pageRenders()[2].page, 2)
assert(container.querySelector('.pr-textlayer')?.textContent?.includes('p2-w0'), 'new page\'s glyphs are on screen')
assert(!container.querySelector('.pr-textlayer')?.textContent?.includes('p1-w0'), 'old page\'s glyphs are gone')

console.log('all reader geometry checks passed')
