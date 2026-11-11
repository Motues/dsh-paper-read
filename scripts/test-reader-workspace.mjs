/**
 * Reading workspace checks against the real client bundle: opening papers
 * creates tabs, tabs keep their own page/zoom/layout, the rail switches between
 * previews and titles, and spread/continuous layouts render the right pages.
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
window.matchMedia = () => ({
  matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
})
globalThis.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id)
window.localStorage.clear()

const PAGE_W = 600
const PAGE_H = 800
const PAGES = 6

const pdfStub = `
const PAGE_W = ${PAGE_W}
const PAGE_H = ${PAGE_H}
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
export const loadDocument = (url) => Promise.resolve({
  numPages: ${PAGES},
  destroy: () => Promise.resolve(),
  // p1 carries bookmarks (outline mode); p2 has none (first-line fallback).
  getOutline: () => Promise.resolve(String(url).includes('p2') ? [] : [
    { title: 'Introduction', dest: [{ num: 0, gen: 0 }], items: [] },
    { title: 'Methods', dest: [{ num: 2, gen: 0 }], items: [] },
  ]),
  getPageIndex: (ref) => Promise.resolve(ref.num),
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

const paper = (id, title, lastReadPage) => ({
  id,
  title,
  authors: ['A. Author'],
  authorLine: 'A. Author',
  year: 2026,
  venue: 'LPR',
  tags: [],
  folder: null,
  status: 'reading',
  progress: 0,
  source: 'pdf',
  pageCount: PAGES,
  addedAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  tldr: '',
  hasFullText: true,
  hasSummary: false,
  fileUrl: `http://127.0.0.1:12462/pdf/${id}.pdf`,
  pdfUnavailable: null,
  lastReadAt: '2026-11-04T00:00:00Z',
  lastReadPage,
})

const p1 = paper('p1', 'First Paper', 1)
const p2 = paper('p2', 'Second Paper', 1)

const detail = (item) => ({
  ...item,
  abstract: '',
  doi: '',
  pmid: '',
  references: [],
  summary: null,
  annotations: [],
  notes: [],
  lastRead: { page: item.lastReadPage, scrollTop: 0, at: null },
})

const calls = []
globalThis.fetch = async (url, init) => {
  const path = String(url)
  calls.push(`${init?.method ?? 'GET'} ${path}`)
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  for (const item of [p1, p2]) {
    if (path.includes(`/papers/${item.id}/pages/`)) {
      return json({ page: 1, width: PAGE_W, height: PAGE_H, blocks: [] })
    }
    if (path.includes(`/papers/${item.id}/annotations`)) return json({ annotations: [] })
    if (path.includes(`/papers/${item.id}/chat`)) {
      return json({ sessionId: `pr-${item.id}`, messages: [], context: null, route: null })
    }
    if (path.includes(`/papers/${item.id}/models`)) {
      return json({ available: true, providers: [], default: null, current: null })
    }
    if (path.includes(`/papers/${item.id}`)) return json(detail(item))
  }
  if (path.includes('/relations')) return json({ edges: [] })
  if (path.includes('/folders')) return json({ folders: [], unfiled: 2 })
  if (path.includes('/models')) return json({ available: true, providers: [], default: null, current: null })
  if (path.includes('/config')) {
    return json({
      watchFolders: [], provider: '', model: '', autoSummarize: false,
      maxImportBytes: 0, inbox: '', home: '', available: false, route: null,
    })
  }
  if (path.includes('/papers')) {
    return json({
      papers: [p1, p2],
      folders: [],
      unfiled: 2,
      tags: [],
      counts: { all: 2, todo: 0, reading: 2, done: 0, recent: 2 },
      trash: [],
    })
  }
  return json({})
}

let captured = null
window.__ModuleLoader__ = {
  load({ factory }) {
    captured = {
      module: factory((name) => {
        if (name === 'react') return React
        if (name === 'react/jsx-runtime') return jsxRuntime
        throw new Error(`unexpected require: ${name}`)
      }),
    }
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
const root = createRoot(container)
root.render(React.createElement(main, { size: 18 }))
const flush = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms))
const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const byTitle = (selector, title) => [...container.querySelectorAll(selector)]
  .find((element) => element.getAttribute('title') === title)

await flush(320)

const tabIds = () => [...container.querySelectorAll('.pr-tab[data-tab-id]')]
  .map((element) => element.dataset.tabId)
const activeTab = () => container.querySelector('.pr-tab[data-tab-id][data-on]')?.dataset.tabId
const zoomText = () => container.querySelector('.pr-zoom-pct')?.textContent
const pageLabel = () => {
  const value = container.querySelector('.pr-page-input')?.value ?? ''
  const range = container.querySelector('.pr-page-range')?.textContent ?? ''
  const total = container.querySelector('.pr-zoom-page')?.textContent ?? ''
  return `${value}${range} ${total}`.trim()
}

assert.equal(tabIds().length, 0, 'a fresh workspace starts with no paper tabs')
assert(container.querySelector('.pr-tab[data-tab-home]'), 'the library is a fixed first tab')
assert(container.querySelector('.pr-nav .pr-resizer'), 'the main nav exposes a width divider')
container.querySelector('.pr-nav .pr-resizer').dispatchEvent(
  new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
)
await flush(80)
assert.equal(container.querySelector('.pr-nav')?.style.width, '232px', 'ArrowRight widens the nav')

// Open the first paper from the library grid.
click([...container.querySelectorAll('.pr-nav-item')].find((item) => item.textContent.includes('文献库')))
await flush(140)
assert(container.querySelector('.pr-folders .pr-resizer'), 'the folder rail exposes a width divider')
click(byTitle('.pr-seg button', '卡片视图'))
await flush(140)
click(container.querySelector('.pr-card'))
await flush(320)
assert.deepEqual(tabIds(), ['p1'], 'opening a paper adds one tab')
assert.equal(activeTab(), 'p1', 'the new tab becomes active')
assert(container.querySelector('.pr-reader'), 'the reader renders under the tab bar')
assert(container.querySelector('.pr-reader-toolbar'), 'the reader has a toolbar under the tab strip')
assert(!container.querySelector('.pr-stage-wrap .pr-zoom'), 'zoom is no longer a floating pill over the stage')
assert.equal(zoomText(), '100%')

// Zoom is per tab. The controls now live in the toolbar.
click(byTitle('.pr-zoom button', '放大'))
await flush(140)
assert.equal(zoomText(), '110%', 'zoom updates the active tab')

// The toolbar page box is editable and jumps to the typed page.
const pageInput = container.querySelector('.pr-page-input')
assert(pageInput, 'the toolbar exposes a page box')
assert.equal(pageInput?.value, '1', 'the page box starts on the current page')
const typePage = async (value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(pageInput, String(value))
  pageInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  await flush(40)
  pageInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flush(220)
}
await typePage(4)
assert.equal(pageLabel(), '4 / 6', `typing a page jumps there, got ${pageLabel()}`)
await typePage(99)
assert.equal(pageLabel(), '6 / 6', `an out-of-range page clamps to the last page, got ${pageLabel()}`)
await typePage(1)
assert.equal(pageLabel(), '1 / 6', 'the page box can jump back')

// Back to the library: the tab stays open.
click(container.querySelector('.pr-tb-back'))
await flush(200)
assert(container.querySelector('.pr-nav'), 'back returns to the library shell')
assert.deepEqual(tabIds(), ['p1'], 'the opened paper remains in the tab bar')
assert(!activeTab(), 'no paper tab is active on the library')

// Open a second paper.
click([...container.querySelectorAll('.pr-card')][1])
await flush(320)
assert.deepEqual(tabIds(), ['p1', 'p2'], 'the second paper is appended as a tab')
assert.equal(activeTab(), 'p2')
assert.equal(zoomText(), '100%', 'a new tab starts at 100%')

// p2 has no bookmarks, so title mode falls back to one row per page (first line).
click(container.querySelector('.pr-rail-mode button[title="标题"]'))
await flush(260)
const fallbackTitles = [...container.querySelectorAll('.pr-title-row')].map((row) => row.textContent)
assert.equal(fallbackTitles.length, 6, `fallback lists every page, got ${fallbackTitles.join(' | ')}`)
assert(fallbackTitles[0].includes('p1-w0'), 'fallback title is the page first line')
assert(!container.querySelector('.pr-title-num'), 'title rows no longer carry a page-number column')

// Switching tabs restores each tab's own state.
click(container.querySelector('.pr-tab[data-tab-id="p1"]'))
await flush(320)
assert.equal(activeTab(), 'p1')
assert.equal(zoomText(), '110%', 'the first tab kept its zoom')

// Rail: preview ↔ title (outline from the PDF).
assert(container.querySelector('.pr-rail[data-mode="title"]'), 'the rail mode is a workspace preference')
await flush(120)
assert(container.querySelector('.pr-rail[data-mode="title"]'), 'the rail switches to title mode')
assert.equal(container.querySelector('.pr-rail')?.style.width, '212px', 'title mode keeps its own default width')
const titles = [...container.querySelectorAll('.pr-title-row')].map((row) => row.textContent)
assert.equal(titles.length, 2, `outline entries render as rows, got ${titles.join(' | ')}`)
assert(titles[0].includes('Introduction'), 'outline rows carry the entry title')
assert(titles[1].includes('Methods'))
click(container.querySelector('.pr-rail-mode button[title="预览图"]'))
await flush(140)
assert(container.querySelector('.pr-rail[data-mode="preview"]'))

// The left rail collapses from the reader toolbar and leaves no floating tab.
const railElement = () => container.querySelector('.pr-rail')
const railToggle = () => container.querySelector('.pr-reader-toolbar .pr-rail-toggle')
assert.equal(railElement()?.style.width, '120px', 'preview mode starts at the default width')
assert(railToggle(), 'the toolbar hosts the rail toggle')
assert.equal(railToggle()?.getAttribute('aria-expanded'), 'true', 'the rail toggle starts expanded')
click(railToggle())
await flush(320)
assert.equal(railElement()?.dataset.collapsed, 'true', 'the rail records its collapsed state')
assert.equal(railElement()?.style.width, '0px', 'collapsing leaves no width behind')
assert.equal(railToggle()?.getAttribute('aria-expanded'), 'false', 'the toolbar toggle reports the collapsed rail')
assert(!container.querySelector('.pr-rail-restore'), 'no floating restore tab is left over the paper')
click(railToggle())
await flush(320)
assert(!railElement()?.hasAttribute('data-collapsed'), 'the rail expands again')
assert.equal(railElement()?.style.width, '120px', 'expanding restores the remembered width')
assert.equal(railToggle()?.getAttribute('aria-expanded'), 'true', 'the toolbar toggle reports the expanded rail')

// The view switch lives in the toolbar's left zone, split from the collapse
// toggle by a divider, and picking a view reopens a collapsed rail.
const modeButtons = () => [...container.querySelectorAll('.pr-rt-left .pr-rail-mode button')]
assert.equal(modeButtons().length, 2, 'both rail views are switched from the toolbar')
assert(container.querySelector('.pr-rt-left > .pr-tool-sep'), 'a divider splits the toggle from the view switch')
assert(!container.querySelector('.pr-rail-head'), 'the rail no longer draws its own header')
click(railToggle())
await flush(320)
assert.equal(railElement()?.dataset.collapsed, 'true', 'the rail is collapsed before picking a view')
click(modeButtons()[1])
await flush(320)
assert(!railElement()?.hasAttribute('data-collapsed'), 'picking a rail view reopens a collapsed rail')
assert(container.querySelector('.pr-rail[data-mode="title"]'), 'and applies the chosen view')
click(modeButtons()[0])
await flush(320)
assert(container.querySelector('.pr-rail[data-mode="preview"]'), 'switching back to preview works')

// Keyboard resizing commits and persists the new width.
container.querySelector('.pr-rail .pr-resizer').dispatchEvent(
  new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
)
await flush(80)
assert.equal(railElement()?.style.width, '128px', 'ArrowRight widens a right-edge pane')
const layoutPrefs = JSON.parse(window.localStorage.getItem('paperreader.layout.v1') ?? 'null')
assert.equal(layoutPrefs?.railPreview, 128, 'the resized width is persisted')

// Spread: two pages side by side, 1–2 pairing.
click(byTitle('.pr-layout-seg button', '双面阅读'))
await flush(260)
assert.equal(container.querySelectorAll('.pr-pdfpage').length, 2, 'spread renders two pages')
assert.equal(pageLabel(), '1–2 / 6', `spread page label, got ${pageLabel()}`)
assert.equal(container.querySelector('.pr-spread')?.dataset.mode, 'spread')
assert.equal(container.querySelectorAll('.pr-pdfpage')[0].dataset.page, '1')
assert.equal(container.querySelectorAll('.pr-pdfpage')[1].dataset.page, '2')

// Next page turn moves by a whole spread.
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
await flush(260)
assert.equal(pageLabel(), '3–4 / 6', `spread steps two pages, got ${pageLabel()}`)

// Continuous: every page gets a slot, pages render near the viewport.
click(byTitle('.pr-layout-seg button', '连续阅读'))
await flush(320)
assert.equal(container.querySelectorAll('.pr-page-slot').length, 6, 'continuous stacks every page')
assert(container.querySelectorAll('.pr-pdfpage').length >= 1, 'continuous renders the visible pages')
assert.equal(container.querySelector('.pr-continuous') !== null, true)

// Layout is per tab too: p2 was never switched away from single.
click(container.querySelector('.pr-tab[data-tab-id="p2"]'))
await flush(320)
assert(container.querySelector('.pr-spread[data-mode="single"]'), 'the second tab keeps single layout')
assert.equal(container.querySelectorAll('.pr-pdfpage').length, 1)
click(container.querySelector('.pr-tab[data-tab-id="p1"]'))
await flush(320)
assert(container.querySelector('.pr-continuous'), 'the first tab kept continuous layout')

// Closing the active tab activates the neighbour.
click(container.querySelector('.pr-tab[data-tab-id="p1"] .pr-tab-close'))
// AnimatePresence keeps the exiting tab in the DOM for the 160ms shrink; jsdom
// advances motion frames on timers, so give the exit a little more room.
await flush(700)
assert.deepEqual(tabIds(), ['p2'], 'closing a tab removes it')
assert.equal(activeTab(), 'p2', 'the remaining tab takes over')
assert(container.querySelector('.pr-spread[data-mode="single"]'), 'the remaining tab keeps its own layout')

await flush(320)
const saved = JSON.parse(window.localStorage.getItem('paperreader.workspace.v1') ?? 'null')
assert(saved, 'the workspace is persisted')
assert.deepEqual(saved.tabs.map((tab) => tab.paperId), ['p2'])
assert.equal(saved.rail, 'preview')

// Reloading the panel restores the open tab and its active state.
root.unmount()
await flush(60)
const container2 = document.createElement('div')
document.body.appendChild(container2)
const root2 = createRoot(container2)
root2.render(React.createElement(main, { size: 18 }))
await flush(360)
assert.equal(container2.querySelector('.pr-tab[data-tab-id][data-on]')?.dataset.tabId, 'p2',
  'the active tab survives a reload')
assert(container2.querySelector('.pr-reader'), 'the reader reopens on the restored tab')
root2.unmount()

console.log('all workspace checks passed')
