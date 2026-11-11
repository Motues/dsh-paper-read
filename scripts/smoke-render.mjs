/**
 * Render smoke test: loads the built bundle in jsdom with a stubbed fetch and
 * walks the new home shell (recent → library → reader → relations → settings).
 */
import { readFileSync } from 'node:fs'
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
// jsdom lacks rAF; the dialog's autofocus/selection handling schedules one.
globalThis.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id)

const paper = {
  id: 'p1',
  title: 'Advances in Bias Drift',
  authors: ['Jun Wang'],
  authorLine: 'Jun Wang',
  year: 2026,
  venue: 'LPR',
  tags: ['偏置漂移'],
  folder: 'f1',
  status: 'reading',
  progress: 40,
  source: 'pdf',
  pageCount: 21,
  addedAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  tldr: '把偏置漂移的成因与抑制手段系统化。',
  hasFullText: true,
  hasSummary: true,
  lastReadAt: new Date(Date.now() - 3_600_000).toISOString(),
  lastReadPage: 7,
}

const folders = [
  { id: 'f1', name: '精读', parentId: null, count: 1, createdAt: '2026-11-04T00:00:00Z' },
  { id: 'f2', name: '子文件夹', parentId: 'f1', count: 0, createdAt: '2026-11-04T00:00:00Z' },
]

const trashPaper = (id, title, folder) => ({
  ...paper,
  id,
  title,
  folder,
  deletedAt: new Date(Date.now() - 86_400_000).toISOString(),
})

const trash = [
  trashPaper('t1', 'Recycle Me', 'f1'),
  trashPaper('t2', 'Purge Me', null),
  trashPaper('t3', 'Empty Me', null),
]

const library = {
  papers: [paper],
  folders,
  trash,
  unfiled: 0,
  tags: [{ tag: '偏置漂移', count: 1 }],
  counts: { all: 1, todo: 0, reading: 1, done: 0, recent: 1, trash: 3 },
}

const detail = {
  ...paper,
  abstract: '摘要内容：$E=mc^2$ 与 $$\\int_0^1 x^2 dx$$',
  doi: '10.1038/nature14539',
  pmid: '26017442',
  references: [
    { title: '参考文献一', authors: ['Alice Smith'], year: 2020, venue: 'Test Journal', doi: '10.1000/ref.1' },
    { title: '参考文献二', authors: ['Bob Jones'], year: 2021 },
  ],
  hasFullText: false,
  pdfUnavailable: 'auth',
  fileUrl: null,
  summary: {
    paperId: 'p1',
    tldr: '把偏置漂移的成因与抑制手段系统化。$\\sigma^2$',
    problem: '问题',
    method: '方法',
    findings: ['结论一'],
    limitations: [],
    reusable: [],
    related: [],
    model: 'stub/stub-1',
    createdAt: '2026-11-04T00:00:00Z',
  },
  annotations: [
    {
      id: 'a1',
      paperId: 'p1',
      page: 1,
      rects: [[10, 10, 20, 20]],
      quote: '一段被高亮的原文',
      prefix: '',
      suffix: '',
      color: 'yellow',
      createdAt: '2026-11-04T00:00:00Z',
      updatedAt: '2026-11-04T00:00:00Z',
    },
  ],
  notes: [],
  lastRead: { page: 7, scrollTop: 0, at: paper.lastReadAt },
}

/** The conversation now comes from its own endpoint, not from the detail payload. */
const chat = {
  sessionId: 'pr-p1',
  messages: [
    { id: 'm0', role: 'user', text: '【论文固定资料】题目：深度残差学习\n摘要：很深的网络更难训练。', injected: 'digest' },
    { id: 'm0b', role: 'user', text: '【检索片段】第 7 页：偏置漂移来自批量统计。', injected: 'retrieval', pages: [7] },
    { id: 'm1', role: 'user', text: '这篇论文解决了什么问题？', mode: 'ask', page: 7 },
    { id: 'm2', role: 'assistant', text: '它把偏置漂移的成因系统化了。第 7 页。$\\alpha+\\beta$' },
  ],
  context: { tokens: 1200, window: 8000, percent: 15, compacted: false },
  route: { provider: 'stub', model: 'stub-1' },
}

const pageText = {
  page: 7,
  width: 612,
  height: 792,
  blocks: [
    { id: 'b1', bbox: [50, 50, 300, 20], text: '7 Methods', kind: 'title' },
    { id: 'b2', bbox: [50, 80, 500, 40], text: '正文第一段。', kind: 'para' },
  ],
}

const translationDocument = {
  paperId: 'p1',
  title: '深度残差学习',
  authors: ['Kaiming He'],
  targetLang: 'zh',
  model: 'stub',
  referencePages: [],
  pages: [{
    page: pageText,
    status: 'done',
    blocks: { b1: '7 方法', b2: '正文第一段（译）。' },
    order: ['b1', 'b2'],
    skipped: {},
    visuals: [],
  }],
}

const config = {
  watchFolders: ['C:/Papers'],
  provider: '',
  model: '',
  autoSummarize: true,
  aiEnabled: true,
  maxImportBytes: 83886080,
  paperSessionInSidebar: true,
  experimentalFullTextTranslation: true,
  experimentalTaskCenter: false,
  libraryDefaultView: 'list',
  recentLimit: 20,
  sessionsAvailable: true,
  inbox: 'C:/inbox',
  home: 'C:/Users/x/.dsh/paperreader',
  available: true,
  route: { provider: 'stub', model: 'stub-1' },
}

/** The graph payload the new relation page reads. */
const relationGraph = {
  generatedAt: '2026-11-06T00:00:00Z',
  nodes: [
    {
      id: 'p1',
      title: 'Advances in Bias Drift',
      year: 2026,
      venue: 'LPR',
      tldr: '把偏置漂移的成因与抑制手段系统化。',
      tags: ['偏置漂移'],
      cluster: 'c1',
      degree: 1,
      weight: 0.8,
      isolated: false,
      hasProfile: true,
    },
    {
      id: 'p2',
      title: 'Bias Drift in Memristive Arrays',
      year: 2023,
      venue: 'IEEE',
      tldr: '忆阻阵列的漂移模型。',
      tags: [],
      cluster: 'c1',
      degree: 1,
      weight: 0.8,
      isolated: false,
      hasProfile: true,
    },
  ],
  edges: [
    {
      id: 'p1->p2:cites',
      from: 'p1',
      to: 'p2',
      kind: 'cites',
      reason: '本文引用了它的漂移模型',
      confidence: 0.8,
      status: 'confirmed',
      direction: 'a2b',
      signals: { ref: 0.4, concept: 0.5, lexical: 0.3 },
      evidence: { sharedConcepts: ['漂移模型'], sharedRefs: ['A drift model'] },
      origin: 'auto',
    },
  ],
  clusters: [
    { id: 'c1', label: '薄膜铌酸锂', paperIds: ['p1', 'p2'], color: 0, aiNamed: true },
  ],
  stats: { papers: 2, edges: 1, confirmed: 1, suggested: 0, isolated: 0, coverage: 1, ai: true },
}

let calls = []
const moveBodies = []
const feedbackBodies = []

globalThis.fetch = async (url, init) => {
  const path = String(url)
  calls.push(`${init?.method ?? 'GET'} ${path}`)
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  if (path.includes('/papers/t1/restore')) return json(trash[0])
  if (path.includes('/trash')) return json({ ok: true, removed: ['t1', 't2', 't3'], count: 3 })
  if (path.includes('/papers/p1/pages/')) return json(pageText)
  if (path.includes('/papers/p1/search')) {
    const raw = /[?&]q=([^&]*)/.exec(path)?.[1] ?? ''
    const query = decodeURIComponent(raw)
    if (query === '漂移') {
      return json({
        query,
        total: 2,
        hits: [
          { page: 3, blockId: 'b2', bbox: [72, 100, 300, 20], quote: '这里的漂移模型给出了解释。', quoteStart: 3, quoteLength: 2 },
          { page: 5, blockId: 'b5', bbox: [72, 200, 300, 20], quote: '第二处漂移的说明。', quoteStart: 3, quoteLength: 2 },
        ],
      })
    }
    return json({ query, total: 0, hits: [] })
  }
  if (path.includes('/papers/p1/annotations')) return json({ annotations: detail.annotations })
  if (path.includes('/papers/p1/summarize')) return json({ summary: detail.summary, edges: [] })
  if (path.includes('/papers/p1/summary')) return json({ summary: detail.summary })
  if (path.includes('/papers/p1/chat')) return json(chat)
  if (path.includes('/papers/p1/conversations')) {
    return json({
      paperId: 'p1',
      activeId: 'pr-p1',
      conversations: [
        { id: 'pr-p1', title: '当前对话', active: true, archived: false, messageCount: 2 },
        { id: 'pr-p1-old', title: '旧对话', active: false, archived: false, messageCount: 4 },
      ],
    })
  }
  if (path.includes('/papers/p1/translation/document')) {
    return json(translationDocument)
  }
  if (path.includes('/papers/p1/translation/pages/')) {
    return json({ page: pageText, status: 'done', blocks: {} })
  }
  if (path.includes('/papers/p1/translation')) {
    return json({
      available: true,
      targetLang: 'zh',
      model: 'stub',
      totalPages: 1,
      donePages: 0,
      failedPages: 0,
      running: false,
      pages: {},
    })
  }
  if (path.includes('/papers/p1/compact')) return json({ removed: 2, freedTokens: 120 })
  if (path.includes('/papers/p1/models')) {
    return json({
      available: true,
      options: [
        {
          provider: 'stub',
          providerName: 'Stub',
          model: 'stub-1',
          name: 'Stub 1',
          efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }],
          defaultEffort: 'low',
        },
        { provider: 'stub', providerName: 'Stub', model: 'stub-2', name: 'Stub 2', efforts: [] },
      ],
      current: { provider: 'stub', model: 'stub-1' },
    })
  }
  if (path.includes('/papers/p1/reset')) return json({ sessionId: 'pr-p1-abc12345', retired: 'pr-p1' })
  if (path.includes('/papers/p1/model')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    return json({ provider: body.provider ?? 'stub', model: body.model ?? 'stub-2' })
  }
  if (path.includes('/papers/p1')) return json(detail)
  if (path.includes('/relations/graph')) return json(relationGraph)
  if (path.includes('/relations/insights/')) return json({ insight: null })
  if (path.includes('/relations/rebuild')) return json({ jobId: 'job-r1' })
  if (path.includes('/relations/feedback')) {
    feedbackBodies.push(init?.body ? JSON.parse(String(init.body)) : null)
    return json({ ok: true, edge: null })
  }
  if (path.includes('/relations/p1')) {
    return json({
      paperId: 'p1',
      edges: [{
        id: 'e1',
        paperId: 'p2',
        title: 'Bias Drift in Memristive Arrays',
        year: 2023,
        kind: 'cites',
        reason: '本文引用了它的漂移模型',
        direction: 'out',
        origin: 'auto',
        confidence: 0.8,
      }],
    })
  }
  if (path.includes('/relations')) return json({ edges: [] })
  if (path.includes('/folders/') && path.includes('/move')) {
    moveBodies.push(init?.body ? JSON.parse(String(init.body)) : null)
    return json({ folders, unfiled: 0, trash: 3 })
  }
  if (path.includes('/folders')) return json({ folders, unfiled: 0 })
  if (path.includes('/models')) {
    return json({
      available: true,
      providers: [{ id: 'stub', name: 'Stub', models: [{ id: 'stub-1', name: 'Stub 1' }] }],
      default: { provider: 'stub', model: 'stub-1' },
      current: null,
    })
  }
  if (path.includes('/config')) {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (body && String(init?.method ?? 'GET').toUpperCase() !== 'GET') Object.assign(config, body)
    return json(config)
  }
  if (path.includes('/tasks')) {
    return json({
      tasks: [{
        id: 'translation:p1',
        kind: 'translation',
        title: 'Advances in Bias Drift',
        detail: '第 3 页',
        state: 'running',
        paperId: 'p1',
        startedAt: new Date().toISOString(),
        cancelable: true,
      }],
      history: [{
        id: 'summary:p1',
        kind: 'summary',
        title: 'Advances in Bias Drift',
        detail: '完成',
        state: 'done',
        paperId: 'p1',
        startedAt: new Date(Date.now() - 120_000).toISOString(),
        finishedAt: new Date(Date.now() - 60_000).toISOString(),
        usage: { input: 900, output: 300, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1200, calls: 2 },
        models: ['stub/stub-1'],
      }],
      total: 1,
      counts: [{ kind: 'summary', count: 1 }],
      firstAt: '2026-11-08',
      lastAt: '2026-11-08',
    })
  }
  if (path.includes('/usage')) {
    const day = {
      date: '2026-11-01',
      input: 1_000_000,
      output: 234_567,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 1_234_567,
      calls: 1_234,
    }
    return json({
      from: '2026-10-01',
      to: '2026-11-08',
      total: { input: 1_000_000, output: 234_567, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1_234_567, calls: 1_234 },
      days: [day],
      models: [],
      sources: [{ source: 'chat', input: 1_000_000, output: 234_567, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1_234_567, calls: 1_234 }],
      firstAt: '2026-11-01',
      lastAt: '2026-11-01',
    })
  }
  if (path.includes('/scan')) return json({ scanned: 0, added: 0, jobs: [] })
  if (path.includes('/maintenance')) return json({ papers: 1, chunks: 3, notes: 0 })
  if (path.includes('/papers')) return json(library)
  return json({})
}

let captured = null
window.__ModuleLoader__ = {
  load({ id, factory }) {
    captured = {
      id,
      module: factory((name) => {
        if (name === 'react') return React
        if (name === 'react/jsx-runtime') return jsxRuntime
        throw new Error(`unexpected require: ${name}`)
      }),
    }
  },
}

new window.Function(readFileSync('dist/client/client.js', 'utf8')).call(window)
if (!captured) throw new Error('bundle did not register')
console.log('bundle id', captured.id, 'exports', Object.keys(captured.module))

const slots = []
const ctx = {
  slots: {
    inject(name, factory) {
      slots.push({ name, result: factory() })
    },
    register(options, component) {
      return { options, component }
    },
  },
  effect(fn) {
    if (typeof fn === 'function') fn()
  },
  on() {
    return () => {}
  },
  theme: { getTheme: () => ({ active: { colorScheme: 'light' } }) },
  uiWorkspace: { pickDirectory: async () => 'D:/Picked' },
  get(name) {
    if (name === 'uiWorkspace') return ctx.uiWorkspace
    return undefined
  },
}

captured.module.apply(ctx)
const main = slots.find((slot) => slot.name === 'main')?.result?.component
if (!main) throw new Error('no main slot')

const { createRoot } = await import('react-dom/client')
const container = document.getElementById('app')
const root = createRoot(container)
const flush = async (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))
const click = (element) => element?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const typeInto = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const navItem = (label) => [...container.querySelectorAll('.pr-nav-item')]
  .find((button) => button.textContent?.includes(label))
const byText = (selector, text) => [...container.querySelectorAll(selector)]
  .find((element) => element.textContent?.includes(text))

let failures = 0
const assert = (name, condition, detailText = '') => {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name} ${detailText}`)
  }
}

root.render(React.createElement(main, { size: 18 }))
await flush(220)

const html = () => container.innerHTML

assert('nav has four modules', ['最近阅读', '文献库', '关联', '系统设置'].every((label) => Boolean(navItem(label))))
assert('nav sits on the left', container.querySelector('.pr-shell')?.firstElementChild?.className?.includes('pr-nav'))
const sidebar = container.querySelector('.pr-nav')
assert('import button sits at the top of the sidebar', sidebar?.firstElementChild?.classList.contains('pr-nav-import'))
assert('divider separates import from the tabs', sidebar?.children[1]?.classList.contains('pr-nav-sep'))
assert('nav exposes a width divider', Boolean(sidebar?.querySelector('.pr-resizer[role="separator"]')))
assert('sidebar status hint removed', !container.querySelector('.pr-nav-hint'))
assert('only the current nav tab is active', container.querySelectorAll('.pr-nav-item[data-on]').length === 1)
assert('recent is the default view', html().includes('按最后一次打开时间排序'))
assert('recent header swaps the library button for search',
  Boolean(container.querySelector('.pr-page-head .pr-search input[placeholder="搜索最近阅读…"]'))
  && !byText('.pr-page-head .pr-btn', '去文献库'))
assert('recent header carries a view toggle',
  Boolean(container.querySelector('.pr-page-head .pr-seg [title="卡片视图"]')))
assert('recent defaults to the configured list view',
  Boolean(container.querySelector('.pr-list')) && !container.querySelector('.pr-grid'))
assert('recent table exposes the library columns',
  ['标题', '作者', '时间', '出版物', '状态']
    .every((label) => Boolean(byText('.pr-list-head-cell', label))))
assert('recent heading states the configured limit', html().includes('最多 20 篇'))
click(container.querySelector('.pr-seg [title="卡片视图"]'))
await flush(80)
// One shared card: status row → title → authors → folder/tags + progress footer.
const recentCard = container.querySelector('.pr-card')
assert('recent card shows status in the top row',
  recentCard?.querySelector('.pr-card-top .pr-card-state-label')?.textContent === '在读')
assert('recent card puts 时间 · 出版物 on the top right',
  recentCard?.querySelector('.pr-card-meta')?.textContent === '2026 · LPR')
assert('recent card drops the tldr block', !recentCard?.querySelector('.pr-tldr'))
assert('recent card drops the page readout', !recentCard?.textContent?.includes('第 7 页'))
assert('recent card shows folder tag', recentCard?.querySelector('.pr-tag[data-group]')?.textContent === '精读')
assert('recent card footer pairs the progress bar with the last-read time',
  Boolean(recentCard?.querySelector('.pr-card-read .pr-bar'))
  && recentCard?.querySelector('.pr-card-time')?.textContent === '1 小时前')
assert('nav badge counts', Boolean(navItem('文献库')?.textContent?.includes('1')))

const recentSearch = container.querySelector('.pr-page-head .pr-search input')
const setRecentQuery = (value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(recentSearch, value)
  recentSearch.dispatchEvent(new window.Event('input', { bubbles: true }))
}
setRecentQuery('不存在的关键词')
await flush(80)
assert('recent search filters the list in place',
  container.querySelectorAll('.pr-card').length === 0 && html().includes('没有匹配的论文'))
setRecentQuery('')
await flush(80)
assert('clearing recent search restores the cards', container.querySelectorAll('.pr-card').length === 1)
click(container.querySelector('.pr-seg [title="列表视图"]'))
await flush(80)
assert('recent switches back to the table', Boolean(container.querySelector('.pr-list')))

click(navItem('文献库'))
await flush()
assert('active nav tab follows the current page',
  navItem('文献库')?.getAttribute('data-on') === 'true'
  && !navItem('最近阅读')?.hasAttribute('data-on'))
assert('library heading', html().includes('文献库') && html().includes('个文件夹'))
assert('title sits in the folder column', Boolean(container.querySelector('.pr-folders .pr-lib-head h1')))
assert('folder rail exposes a width divider', Boolean(container.querySelector('.pr-folders .pr-resizer[role="separator"]')))
assert('folder rail lists the special rows',
  ['全部', '未分类', '回收站'].every((label) => Boolean(byText('.pr-folder-row', label)))
  && Boolean(byText('.pr-tree-name', '精读')))
assert('trash sits under 未分类 and carries its count',
  byText('.pr-folder-row', '回收站')?.querySelector('.pr-count')?.textContent === '3')
assert('folder rows expose more + import actions',
  Boolean(container.querySelector('[data-folder-more]'))
  && Boolean(container.querySelector('.pr-tree-actions button[title^="导入论文到"]')))
assert('folder section header exposes search / new folder / collapse-all',
  Boolean(container.querySelector('.pr-rail-section .pr-rail-search-toggle[title="搜索"]'))
  && ['新建文件夹', '全部折叠'].every((title) => Boolean(container.querySelector(`.pr-rail-section .pr-rail-actions [title="${title}"]`))))
const folderTitle = container.querySelector('.pr-rail-section .pr-rail-title')
const tagTitle = container.querySelector('.pr-rail-tags-title')
assert('folder and tag section titles stay compact',
  window.getComputedStyle(folderTitle).fontSize === '13.5px'
  && window.getComputedStyle(tagTitle).fontSize === '13.5px')
assert('folder section is separated from the shortcuts by a rule',
  /\.pr-rail-section\s*\{[^}]*border-top:\s*1px solid var\(--pr-line\)/.test(
    document.getElementById('paperreader-styles')?.textContent ?? '',
  ))
assert('folder rail drops the duplicate bottom new-folder row',
  !container.querySelector('.pr-folders > .pr-folder-row[data-ghost]'))
const tagRow = container.querySelector('.pr-tag-row')
assert('tag rail lists every tag with its count',
  Boolean(byText('.pr-tag-row', '#偏置漂移'))
  && Boolean(container.querySelector('.pr-rail-tags .pr-tag-row .pr-count')))
assert('inline tag chips above the list are gone', !container.querySelector('.pr-chips-inline'))
click(tagRow)
await flush(120)
assert('tag rail marks the active filter', tagRow?.getAttribute('data-on') === 'true')
assert('tag rail offers a clear action', Boolean(container.querySelector('.pr-rail-tags-clear')))
click(container.querySelector('.pr-rail-tags-clear'))
await flush(120)
assert('clearing the tag filter restores every row', !container.querySelector('.pr-tag-row[data-on]'))
assert('folder rows swap the folder glyph for a hover arrow, not a separate twist',
  Boolean(container.querySelector('.pr-tree-row[data-branch] .pr-tree-arrow'))
  && !container.querySelector('.pr-tree-twist'))
assert('folder rows can be dragged', container.querySelector('.pr-tree-row')?.getAttribute('draggable') === 'true')
click(container.querySelector('.pr-rail-section .pr-rail-search-toggle'))
await flush()
assert('folder search expands in place',
  Boolean(container.querySelector('.pr-rail-section .pr-rail-search[data-open] input')))
container.querySelector('.pr-rail-search-input')
  ?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await flush()
assert('folder search closes again', !container.querySelector('.pr-rail-section .pr-rail-search[data-open]'))
click(container.querySelector('.pr-rail-section .pr-rail-search-toggle'))
await flush()
document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
await flush()
assert('folder search closes on an outside click',
  !container.querySelector('.pr-rail-section .pr-rail-search[data-open]'))
assert('status filter sits in the content toolbar', Boolean(byText('.pr-lib-toolbar .pr-seg button', '待读')))
assert('search field present', Boolean(container.querySelector('.pr-lib-toolbar .pr-search input')))
const libToolbarKids = [...(container.querySelector('.pr-lib-toolbar')?.children ?? [])]
assert('library view toggle sits beside the search field',
  libToolbarKids[libToolbarKids.length - 2]?.getAttribute('aria-label') === '视图密度'
  && libToolbarKids[libToolbarKids.length - 1]?.classList.contains('pr-search'))
assert('library defaults to the list view', Boolean(container.querySelector('.pr-list')) && !container.querySelector('.pr-grid'))
assert('list shows every column header',
  ['标题', '作者', '时间', '出版物', '状态'].every((label) => Boolean(byText('.pr-list-head-cell', label))))
assert('list row renders one cell per column', container.querySelectorAll('.pr-row .pr-list-cell').length === 5)
// Regression: the relations panel's header rule used to override this grid with
// `display: flex`, bunching every label at the left edge of the table.
assert('list header shares the row grid instead of collapsing to the left',
  window.getComputedStyle(container.querySelector('.pr-list-head')).display === 'grid',
  window.getComputedStyle(container.querySelector('.pr-list-head')).display)

assert('library exposes author / year / venue filters',
  container.querySelectorAll('.pr-lib-filter-row .pr-lib-filter .pr-select-trigger').length === 3)
assert('library search placeholder names the new fields',
  container.querySelector('.pr-lib-toolbar .pr-search input')?.getAttribute('placeholder')?.includes('摘要'))

// Nested folders: clicking a folder selects it and reveals its children.
const rootBranch = container.querySelector('.pr-tree-branch')
const childrenWrap = rootBranch?.querySelector('.pr-tree-children')
assert('subfolder starts collapsed',
  Boolean(childrenWrap) && !childrenWrap.hasAttribute('data-open')
  && childrenWrap.getAttribute('aria-hidden') === 'true'
  && rootBranch.querySelectorAll('.pr-tree-row').length === 2)
click(container.querySelector('.pr-tree-main'))
await flush()
assert('folder click expands its children',
  Boolean(childrenWrap?.hasAttribute('data-open')) && !childrenWrap?.hasAttribute('aria-hidden')
  && html().includes('子文件夹'))
assert('the selected folder offers its subfolders as chips',
  Boolean(container.querySelector('.pr-subfolders .pr-chip')))

// Drag a folder: HTML5 drag events are synthesized with a minimal dataTransfer.
const dragData = { effectAllowed: '', dropEffect: '', setData() {}, getData: () => '' }
const dragEvent = (type, extra = {}) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dragData })
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value })
  return event
}
{
  const rows = [...container.querySelectorAll('.pr-tree-row')]
  const source = rows[1]
  const target = rows[0]
  source?.dispatchEvent(dragEvent('dragstart'))
  await flush()
  target?.dispatchEvent(dragEvent('dragover', { clientY: 0 }))
  await flush()
  target?.dispatchEvent(dragEvent('drop', { clientY: 0 }))
  await flush(200)
  source?.dispatchEvent(dragEvent('dragend'))
  await flush()
}
assert('dragging a folder posts its new parent and anchor',
  calls.some((call) => call.startsWith('POST /api/paperreader/folders/f2/move')))
assert('drop in the middle of a row resolves to that folder as parent',
  JSON.stringify(moveBodies.at(-1)) === JSON.stringify({ parentId: 'f1', beforeId: null }))
{
  const rows = [...container.querySelectorAll('.pr-tree-row')]
  const source = rows[1]
  const target = rows[0]
  target.getBoundingClientRect = () => ({ top: 0, height: 32, bottom: 32, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} })
  source?.dispatchEvent(dragEvent('dragstart'))
  await flush()
  target?.dispatchEvent(dragEvent('dragover', { clientY: 2 }))
  await flush()
  target?.dispatchEvent(dragEvent('drop', { clientY: 2 }))
  await flush(200)
  source?.dispatchEvent(dragEvent('dragend'))
  await flush()
}
assert('drop on the top quarter resolves to ordering before the target',
  JSON.stringify(moveBodies.at(-1)) === JSON.stringify({ parentId: null, beforeId: 'f1' }))

// Folder "more" menu.
click(container.querySelector('[data-folder-more]'))
await flush()
assert('folder menu offers rename / subfolder / delete',
  ['重命名', '新建子文件夹', '删除文件夹'].every((label) => Boolean(byText('.pr-menu-item', label))))
click(byText('.pr-menu-item', '新建子文件夹'))
await flush()
assert('subfolder creation happens inline', Boolean(container.querySelector('.pr-tree-create input')))
container.querySelector('.pr-tree-create input')
  ?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await flush()

// Recycle bin: restore, purge (two-step) and empty (two-step).
click(byText('.pr-folder-row', '全部'))
await flush()
click(byText('.pr-folder-row', '回收站'))
await flush()
assert('trash view opens', Boolean(container.querySelector('.pr-trash')) && html().includes('Recycle Me'))
assert('trash hides the status filters', !container.querySelector('.pr-lib-toolbar .pr-seg'))
assert('trash keeps the search field', Boolean(container.querySelector('.pr-lib-toolbar .pr-search input')))
click(byText('.pr-trash-row button', '还原'))
await flush(240)
assert('restore calls the host', calls.some((call) => call.startsWith('POST /api/paperreader/papers/t1/restore')))

const purgeRow = () => [...container.querySelectorAll('.pr-trash-row')]
  .find((row) => row.textContent?.includes('Purge Me'))
click([...purgeRow().querySelectorAll('button')].find((button) => button.textContent?.includes('彻底删除')))
await flush()
assert('purge asks for a second click', purgeRow()?.textContent?.includes('确认彻底删除'))
click([...purgeRow().querySelectorAll('button')].find((button) => button.textContent?.includes('确认彻底删除')))
await flush(240)
assert('purge is permanent',
  calls.some((call) => call.startsWith('DELETE /api/paperreader/papers/t2?permanent=1')))

const emptyButton = () => container.querySelector('.pr-trash-head .pr-btn')
click(emptyButton())
await flush()
assert('empty-trash asks for a second click', emptyButton()?.textContent?.includes('再点一次清空'))
click(emptyButton())
await flush(240)
assert('empty-trash calls the host', calls.some((call) => call.startsWith('DELETE /api/paperreader/trash')))

click(byText('.pr-folder-row', '全部'))
await flush()

click(container.querySelector('.pr-seg [title="卡片视图"]'))
await flush()
assert('card grid renders after toggling', Boolean(container.querySelector('.pr-grid')))
const gridCard = container.querySelector('.pr-grid .pr-card')
assert('library card reuses the recent card layout',
  gridCard?.querySelector('.pr-card-state-label')?.textContent === '在读'
  && gridCard?.querySelector('.pr-card-meta')?.textContent === '2026 · LPR'
  && Boolean(gridCard?.querySelector('.pr-card-foot .pr-card-read .pr-bar')))
assert('library card also drops the tldr block', !container.querySelector('.pr-grid .pr-tldr'))
click(container.querySelector('.pr-seg [title="列表视图"]'))
await flush()

// organize dialog
const more = container.querySelector('.pr-row-action')
click(more)
await flush()
assert('organize dialog opens', html().includes('整理论文') && html().includes('放进文件夹'))
assert('paper title is its own bold row', container.querySelector('.pr-dlg-title')?.textContent?.includes('Advances in Bias Drift'))
const folderTrigger = container.querySelector('.pr-dialog .pr-select-trigger')
assert('folder picker is a dropdown', Boolean(folderTrigger))
click(folderTrigger)
await flush()
assert('folder dropdown supports search', Boolean(container.querySelector('.pr-dialog .pr-select-search input')))
assert('folder dropdown lists options', container.querySelectorAll('.pr-select-option').length >= 2)
const pickerRows = [...container.querySelectorAll('.pr-select-option')]
const parentPick = pickerRows.find((row) => row.textContent?.includes('精读'))
const childPick = pickerRows.find((row) => row.textContent?.includes('子文件夹'))
assert('folder picker indents child folders',
  Number.parseInt(parentPick?.style.paddingLeft ?? '0', 10) < Number.parseInt(childPick?.style.paddingLeft ?? '0', 10))
click(childPick)
await flush()
assert('selected folder shows its full path in the trigger',
  container.querySelector('.pr-dialog .pr-select-trigger .pr-select-value')?.textContent === '精读 / 子文件夹')
click(container.querySelector('.pr-dialog .pr-select-trigger'))
await flush()
const unfiledPick = [...container.querySelectorAll('.pr-select-option')]
  .find((row) => row.textContent?.includes('未分类'))
click(unfiledPick)
await flush()
assert('moving a paper updates unfiled and folder counts immediately',
  byText('.pr-folder-row', '未分类')?.querySelector('.pr-count')?.textContent === '1'
  && [...container.querySelectorAll('.pr-tree-row')]
    .find((row) => row.textContent?.includes('精读'))?.querySelector('.pr-count')?.textContent === '0'
  && [...container.querySelectorAll('.pr-tree-row')]
    .find((row) => row.textContent?.includes('子文件夹'))?.querySelector('.pr-count')?.textContent === '0')
const footerButtons = [...container.querySelectorAll('.pr-dlg-foot .pr-btn')]
const removeButton = footerButtons.find((button) => button.textContent?.includes('移入回收站'))
const doneButton = footerButtons.find((button) => button.textContent?.includes('完成'))
assert('remove button moves the paper to the recycle bin',
  Boolean(removeButton?.hasAttribute('data-danger') && removeButton?.hasAttribute('data-solid')))
assert('done button is the blue primary button', Boolean(doneButton?.hasAttribute('data-primary')))
assert('recycle-bin hint shares the action row',
  Boolean(container.querySelector('.pr-dlg-foot .pr-dlg-foot-note'))
  && !container.querySelector('.pr-dlg-body .pr-dlg-note'))
assert('organize footer keeps the dialog body width and bottom spacing',
  window.getComputedStyle(container.querySelector('.pr-dlg-foot[data-inline]')).paddingLeft === '0px'
  && window.getComputedStyle(container.querySelector('.pr-dlg-foot[data-inline]')).paddingRight === '0px'
  && window.getComputedStyle(container.querySelector('.pr-dlg-foot[data-inline]')).paddingBottom === '16px')
const closeOrganize = byText('.pr-btn', '完成')
click(closeOrganize)
await flush()

// open the reader from the list row
click(container.querySelector('.pr-row'))
await flush(260)
assert('reader opens', Boolean(container.querySelector('.pr-ai-toggle')) && html().includes('对话'))
assert('reader toolbar splits into left/center/right zones',
  Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-left'))
  && Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-center'))
  && Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-right')))
assert('reader toolbar hosts the rail toggle',
  Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-left .pr-rail-toggle')))
assert('reader toolbar hosts the page box',
  Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-center .pr-page-input')))
assert('reader toolbar hides zoom for the text fallback',
  Boolean(container.querySelector('.pr-text-paper'))
  && !container.querySelector('.pr-reader-toolbar .pr-rt-center .pr-zoom'))
assert('reader toolbar moves the layout switch to the centre',
  Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-center .pr-layout-seg'))
  && !container.querySelector('.pr-reader-toolbar .pr-rt-right .pr-layout-seg'))
assert('reader toolbar separates the layout switch with a hairline',
  container.querySelector('.pr-reader-toolbar .pr-rt-center')?.lastElementChild?.classList.contains('pr-layout-seg')
  && Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-center .pr-tool-sep')))
assert('reader toolbar hosts find, read and panel actions',
  Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-right .pr-reader-search'))
  && Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-right .pr-read-toggle'))
  && Boolean(container.querySelector('.pr-reader-toolbar .pr-rt-right .pr-ai-toggle')))
assert('top bar no longer carries reader actions',
  !container.querySelector('.pr-topbar .pr-ai-toggle')
  && !container.querySelector('.pr-topbar .pr-read-toggle'))
assert('no floating zoom pill over the stage', !container.querySelector('.pr-stage-wrap .pr-zoom'))
assert('AI toggle is an icon-only button',
  container.querySelector('.pr-ai-toggle')?.textContent?.trim() === ''
  && Boolean(container.querySelector('.pr-ai-toggle svg'))
  && container.querySelector('.pr-ai-toggle')?.getAttribute('aria-label') === '收起右栏')

// Find-in-paper: the icon grows into a field and lists hits for this paper.
assert('find starts as a single collapsed icon', !container.querySelector('.pr-reader-search[data-open]'))
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
await flush(60)
assert('search shortcut opens in-paper find', Boolean(container.querySelector('.pr-reader-search[data-open]')))
assert('search shortcut focuses the find field',
  document.activeElement === container.querySelector('.pr-reader-search-input'))
click(container.querySelector('.pr-reader-search-toggle'))
await flush()
assert('search shortcut leaves a closable find box', !container.querySelector('.pr-reader-search[data-open]'))
click(container.querySelector('.pr-reader-search-toggle'))
await flush()
assert('find expands into a search field',
  Boolean(container.querySelector('.pr-reader-search[data-open] .pr-reader-search-input')))
typeInto(container.querySelector('.pr-reader-search-input'), '漂移')
await flush(320)
assert('find lists in-paper hits',
  container.querySelectorAll('.pr-reader-find-row').length === 2
  && container.querySelector('.pr-reader-find-head')?.textContent?.includes('共 2 处'))
assert('find tags each hit with its page',
  container.querySelector('.pr-reader-find-row .pr-reader-find-page')?.textContent?.includes('第 3 页'))
click(container.querySelector('.pr-reader-find-row'))
await flush(220)
assert('picking a hit jumps to its page',
  container.querySelector('.pr-page-input')?.value === '3')
assert('picking a hit marks the matched paragraph',
  container.querySelector('.pr-text-paper p[data-find-mark]')?.textContent === '正文第一段。')
click(container.querySelector('.pr-reader-search-clear'))
await flush()
assert('clearing the query clears the hit list', !container.querySelector('.pr-reader-find'))
assert('summary regenerate button removed', !html().includes('重新生成导读'))
assert('AI panel has no header row of its own', !container.querySelector('.pr-panel-head'))
assert('AI panel starts open', Boolean(container.querySelector('.pr-panel[data-open]')))
const readToggle = container.querySelector('.pr-read-toggle')
assert('read status is a circle/check toggle', Boolean(readToggle) && !readToggle.hasAttribute('data-done'))
click(readToggle)
await flush()
assert('read toggle switches to the done state', Boolean(container.querySelector('.pr-read-toggle[data-done]')))
assert('read toggle title says done', container.querySelector('.pr-read-toggle')?.getAttribute('title')?.includes('已读'))
click(container.querySelector('.pr-read-toggle'))
await flush()
assert('read toggle switches back to unread', !container.querySelector('.pr-read-toggle[data-done]'))
assert('reader falls back to text', html().includes('正文第一段') || html().includes('7 Methods'))
assert('auth-only reader prompts an upload', html().includes('请自行下载 PDF 后上传') && html().includes('上传 PDF'))

// AI panel: tabs come first, the model lives in the composer's picker.
assert('the model picker still names the live model',
  container.querySelector('.pr-model-btn .pr-model-name')?.textContent?.trim() === 'stub-1')
assert('transcript rendered', html().includes('它把偏置漂移的成因系统化了'))
const injected = container.querySelectorAll('.pr-inj')
assert('both injected blocks are listed', injected.length === 2, `n=${injected.length}`)
assert('injected blocks start collapsed', !container.querySelector('.pr-inj-body'))
assert('injected row names what was injected',
  html().includes('论文固定资料') && html().includes('检索片段') && html().includes('第 7 页'))
click(container.querySelectorAll('.pr-inj-head')[1])
await flush()
assert('clicking a collapsed block expands it',
  Boolean(container.querySelector('.pr-inj[data-open] .pr-inj-body'))
  && html().includes('偏置漂移来自批量统计'))
click(container.querySelectorAll('.pr-inj-head')[1])
await flush()
assert('clicking it again collapses it', !container.querySelector('.pr-inj-body'))

assert('context meter is a ring in the composer bar', Boolean(container.querySelector('.pr-composer-bar .pr-meter-btn svg circle.pr-meter-fill')))
assert('compact action lives in the meter panel, not the bar', !html().includes('上下文：论文固定资料'))
click(container.querySelector('.pr-meter-btn'))
await flush()
assert('meter panel opens with the compaction action',
  Boolean(container.querySelector('.pr-meter-panel'))
  && container.querySelector('.pr-meter-compact')?.textContent?.includes('压缩'))
click(container.querySelector('.pr-meter-btn'))
await flush()

const panelCss = [...document.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n')
assert('send is a circular paper-plane button',
  container.querySelector('.pr-send svg') !== null
  && /\.pr-send\s*\{[^}]*border-radius:\s*50%/.test(panelCss))
// Scrollbars: the rail and the transcript share one buttonless, rounded bar.
assert('scrollbars drop the step buttons and keep a rounded thumb',
  /\.pr-thumbs::-webkit-scrollbar-button,\s*\.pr-root \[data-scroll\]::-webkit-scrollbar-button[^{]*\{[^}]*display:\s*none/.test(panelCss)
  && /\.pr-thumbs::-webkit-scrollbar-thumb,\s*\.pr-root \[data-scroll\]::-webkit-scrollbar-thumb[^{]*\{[^}]*border-radius:\s*99px/.test(panelCss)
  && /\.pr-thumbs::-webkit-scrollbar\s*\{\s*width:\s*6px/.test(panelCss),
  'scrollbar rules missing')
// The wallpaper/glass themes make --dsw-alias-bg-base transparent, so a popover
// that trusts it disappears. Both menus must paint a solid base of their own.
assert('popovers paint an opaque surface',
  /\.pr-meter-panel\s*\{[^}]*background-color:\s*var\(--pr-popover-base\)/.test(panelCss)
  && /\.pr-model-menu\s*\{[^}]*background-color:\s*var\(--pr-popover-base\)/.test(panelCss)
  && /--pr-popover-base:\s*#ffffff/.test(panelCss)
  && /\.pr-root\[data-scheme="dark"\][^}]*--pr-popover-base:\s*#1e1f22/.test(panelCss))
assert('model switch sits next to the meter', Boolean(container.querySelector('.pr-composer-bar .pr-model-btn')))
assert('model switch names the live route',
  container.querySelector('.pr-model-btn')?.textContent?.includes('stub-1'))

click(container.querySelector('.pr-model-btn'))
await flush(160)
const menuCells = [...container.querySelectorAll('.pr-model-menu .pr-cell')]
assert('model menu opens on a two-row root pane',
  menuCells.length === 2
  && menuCells[0].textContent.includes('模型')
  && menuCells[1].textContent.includes('思考强度'),
  menuCells.map((cell) => cell.textContent).join(' | '))
assert('root pane shows the live value on each row',
  menuCells[0].textContent.includes('stub-1') && menuCells[1].textContent.includes('低'),
  menuCells.map((cell) => cell.textContent).join(' | '))

click(menuCells[1])
await flush(160)
assert('drilling into 思考强度 lists the ladder and checks the effective effort',
  html().includes('高')
  && container.querySelector('.pr-option[aria-checked="true"]')?.textContent?.includes('低'),
  container.querySelector('.pr-option[aria-checked="true"]')?.textContent ?? '')

click(container.querySelector('.pr-cell-back'))
await flush(140)
click(container.querySelectorAll('.pr-model-menu .pr-cell')[0])
await flush(160)
assert('model list groups each provider under a heading',
  container.querySelector('.pr-menu-group-label')?.textContent?.trim() === 'Stub'
  && html().includes('Stub 1') && html().includes('Stub 2'))

click(byText('.pr-option', 'Stub 2'))
await flush(160)
assert('picking a model switches it and closes the menu',
  !container.querySelector('.pr-model-menu')
  && container.querySelector('.pr-model-btn')?.textContent?.includes('stub-2'),
  container.querySelector('.pr-model-btn')?.textContent ?? '')

// A new conversation: one click from the conversation bar, no confirmation.
const newChat = container.querySelector('.pr-chat-icon[aria-label="新建对话"]')
assert('conversation bar offers a new-chat action', Boolean(newChat))
click(newChat)
await flush(240)
assert('the new-conversation action posts a fresh session',
  calls.some((line) => line === 'POST /api/paperreader/papers/p1/conversations'))
assert('the transcript is empty afterwards',
  !container.querySelector('.pr-inj') && html().includes('我在读《'))

const guideTab = byText('.pr-panel-tab', '导读')
click(guideTab)
await flush()
assert('guide tab renders the structured digest',
  Boolean(container.querySelector('.pr-guide'))
  && html().includes('要解决的问题')
  && html().includes('主要结论'))
assert('guide offers regeneration', html().includes('重新生成'))
assert('guide renders inline formulas with KaTeX', Boolean(container.querySelector('.pr-guide-tldr .katex')))
click(byText('.pr-guide .pr-btn', '修改'))
await flush()
assert('guide edit form opens', Boolean(container.querySelector('.pr-guide-form')))
click(byText('.pr-guide-form .pr-btn', '取消'))
await flush()

const infoTab = byText('.pr-panel-tab', '文献信息')
click(infoTab)
await flush()
assert('info tab shows abstract', html().includes('摘要内容'))
assert('info tab renders abstract formulas', Boolean(container.querySelector('.pr-info-abstract .katex')))
assert('info tab shows references', html().includes('参考文献一') && html().includes('参考文献二'))
assert('info tab shows identifiers', html().includes('10.1038/nature14539') && html().includes('26017442'))

click(container.querySelector('.pr-ai-toggle'))
await flush()
const closedPanel = container.querySelector('.pr-panel')
assert('AI toggle closes the panel without leaving a rail',
  !closedPanel?.hasAttribute('data-open') && closedPanel?.style.width === '0px')
// The panel stays mounted (drafts survive) but is hidden and inert.
assert('closed panel is removed from the accessibility tree and focus order',
  closedPanel?.getAttribute('aria-hidden') === 'true')
click(container.querySelector('.pr-ai-toggle'))
await flush()
assert('AI toggle reopens the panel', Boolean(container.querySelector('.pr-panel[data-open]')))

const notesTab = byText('.pr-panel-tab', '批注')
click(notesTab)
await flush()
assert('annotation listed', html().includes('一段被高亮的原文'))
assert('annotation jump is a locate action', html().includes('定位'))
assert('annotated page is marked in the thumbnail rail', Boolean(container.querySelector('.pr-thumb-marks')))
assert('批注 tab drops the count badge', !container.querySelector('.pr-tab-count'))
assert('the notes page no longer buries relations at the bottom',
  !container.querySelector('.pr-notes .pr-rel-mini'))

const tabLabels = [...container.querySelectorAll('.pr-panel-tab')].map((tab) => tab.textContent.trim())
assert('tab order is 对话 / 导读 / 批注 / 关联 / 文献信息',
  tabLabels[0] === '对话'
  && tabLabels[1] === '导读'
  && tabLabels[2].startsWith('批注')
  && tabLabels[3].startsWith('关联')
  && tabLabels[4] === '文献信息',
  tabLabels.join(' | '))

click(byText('.pr-panel-tab', '关联'))
await flush()
assert('关联 is its own page',
  Boolean(container.querySelector('.pr-rels')) && !container.querySelector('.pr-notes'))
assert('关联 lists the edge with its kind, direction and reason',
  html().includes('Bias Drift in Memristive Arrays')
  && html().includes('1 条关联')
  && html().includes('本文引用它')
  && container.querySelector('.pr-rel-mini .pr-tag')?.textContent?.includes('引用'),
  html().slice(0, 0))
assert('关联 tab drops the count badge', !container.querySelector('.pr-tab-count'))

assert('back arrow is enabled while reading', !container.querySelector('.pr-tb-back')?.disabled)

// Full-text translation and conversation history live in the reader toolbar.
click(container.querySelector('.pr-translate-toggle'))
await flush(140)
assert('translation menu opens from the toolbar', Boolean(container.querySelector('.pr-translate-menu')))
assert('translation menu offers side-by-side and translation-only views',
  Boolean(byText('.pr-translate-views button', '左右对照'))
  && Boolean(byText('.pr-translate-views button', '仅译文')))
assert('translation menu offers a reflow view',
  Boolean(byText('.pr-translate-views button', '重排')))
click(byText('.pr-translate-views button', '左右对照'))
await flush(240)
assert('side-by-side view pairs the original with the translated page',
  Boolean(container.querySelector('.pr-bipage'))
  && Boolean(container.querySelector('.pr-transpage')))
click(container.querySelector('.pr-translate-toggle'))
await flush(80)
click(byText('.pr-translate-views button', '重排'))
await flush(300)
assert('reflow view renders one continuous sheet',
  Boolean(container.querySelector('.pr-reflow-sheet'))
  && html().includes('深度残差学习'))
click(container.querySelector('.pr-translate-toggle'))
await flush(80)
click(byText('.pr-translate-views button', '左右对照'))
await flush(220)
assert('picking a translation view starts a run',
  calls.some((line) => line === 'POST /api/paperreader/papers/p1/translation'))
assert('translation progress is not printed beside the toolbar icon',
  !container.querySelector('.pr-translate-toggle .pr-translate-count'))

click(byText('.pr-panel-tab', '对话'))
await flush(120)
assert('conversation bar shows the active title',
  container.querySelector('.pr-chat-title')?.textContent === '当前对话')
const historyButton = container.querySelector('.pr-chat-icon[aria-label="历史对话"]')
assert('conversation bar has a history action', Boolean(historyButton))
click(historyButton)
await flush(160)
assert('history switches the panel into the manager',
  Boolean(container.querySelector('.pr-history')) && html().includes('旧对话'))
assert('the manager offers rename and archive for every transcript',
  container.querySelectorAll('.pr-history .pr-conv-mini').length >= 4)
const backToChat = container.querySelector('.pr-chat-icon[aria-label="返回对话"]')
assert('history view offers a back action', Boolean(backToChat))
click(backToChat)
await flush(140)
assert('back returns to the transcript', !container.querySelector('.pr-history'))

click(container.querySelector('.pr-tb-back'))
await flush(200)
assert('back to shell', Boolean(container.querySelector('.pr-nav')))
assert('the opened paper stays as a tab', Boolean(container.querySelector('.pr-tab[data-tab-id]')))

// import dialog: folder batch + identifier/link mode
click(container.querySelector('.pr-nav-import'))
await flush()
assert('import dialog opens', html().includes('把 PDF 或文件夹拖到这里'))
assert('folder picker is offered', Boolean(container.querySelector('input[webkitdirectory]')) && html().includes('选择文件夹'))
click(byText('.pr-dlg-tabs button', '标识符 / 链接'))
await flush()
assert('identifier mode offers PMID', html().includes('PMID: 26017442'))
assert('identifier mode offers DOI', html().includes('10.1038/nature14539'))
click(container.querySelector('.pr-dlg-head button[title="关闭"]'))
await flush()
assert('import dialog closes', !html().includes('把 PDF 或文件夹拖到这里'))

click(navItem('关联'))
await flush(200)
assert('relations page', html().includes('关联图谱'))

// First visit: the guide opens by itself, then lives behind the header button.
assert('first visit opens the guide', Boolean(container.querySelector('.pr-guide')))
assert('guide explains what the layout encodes', html().includes('位置表示关联强度'))
click(container.querySelector('.pr-guide-start'))
await flush(140)
assert('guide closes after reading', !container.querySelector('.pr-guide'))
assert('guide entry stays in the header', Boolean(container.querySelector('.pr-help')))
click(container.querySelector('.pr-help'))
await flush(140)
assert('guide reopens from the header', Boolean(container.querySelector('.pr-guide')))
click(container.querySelector('.pr-guide .pr-dlg-head button[title="关闭"]'))
await flush(140)
assert('guide closes from its own header', !container.querySelector('.pr-guide'))

assert('relation kinds are filterable', ['引用', '基于', '同方法', '同问题', '应用', '相反'].every((label) => html().includes(label)))
assert('graph renders every node', container.querySelectorAll('.pr-gnode').length === 2, String(container.querySelectorAll('.pr-gnode').length))
assert('cluster chip comes from the payload', html().includes('薄膜铌酸锂'))
assert('overview shows coverage', html().includes('全库概览') && html().includes('覆盖率'))
assert('overview lists the confirmed pair', html().includes('本文引用了它的漂移模型'))

click(byText('.pr-viewtoggle button', '列表'))
await flush(140)
assert('list mode renders papers', container.querySelectorAll('.pr-paper-row').length === 2)
click(container.querySelector('.pr-paper-row'))
await flush(140)
assert('selecting a paper focuses the inspector', html().includes('Advances in Bias Drift'))
assert('focused relation shows its reason', html().includes('本文引用了它的漂移模型'))

const setValue = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
setValue(container.querySelector('.pr-rel-search input'), 'tag:偏置漂移')
await flush(140)
assert('tag: prefix filters the list', container.querySelectorAll('.pr-paper-row').length === 1,
  String(container.querySelectorAll('.pr-paper-row').length))
click(container.querySelector('.pr-search-clear'))
await flush(120)
click(byText('.pr-viewtoggle button', '图谱'))
await flush(120)
assert('back to graph mode', Boolean(container.querySelector('.pr-graph-svg')))

click(navItem('系统设置'))
await flush(200)
assert('settings page', html().includes('存储') && html().includes('论文存放文件夹'))
const settingsNavItems = () => [...container.querySelectorAll('.pr-settings-nav-item')]
const settingsSection = () => container.querySelector('.pr-settings-section')
assert('settings uses an internal category rail',
  settingsNavItems().length === 7
  && settingsNavItems()[0]?.getAttribute('data-on') === 'true')
assert('system settings entry uses a cog icon',
  navItem('系统设置')?.querySelectorAll('svg circle').length === 2)
assert('settings rail is grouped and labelled',
  [...container.querySelectorAll('.pr-settings-nav-title')].map((node) => node.textContent).join('|') === '通用|数据'
  && settingsNavItems().map((button) => button.textContent?.trim()).join('|')
    === '存储|模型|界面|实验性功能|对话|用量|维护')
assert('settings section renders a flat heading',
  settingsSection()?.querySelector('.pr-settings-section-head h2')?.textContent === '存储')
assert('settings title matches every other page title',
  window.getComputedStyle(container.querySelector('.pr-settings-heading h1')).fontSize === '17px'
  && !container.querySelector('.pr-settings-heading p'))
assert('settings uses flat rows instead of cards',
  Boolean(container.querySelector('.pr-setting')) && !container.querySelector('.pr-card-panel'))
const settingsButtons = [...container.querySelectorAll('.pr-settings-page .pr-btn')]
const settingsInput = container.querySelector('.pr-settings-folder-add input')
assert('settings buttons and inputs share a 32px control height',
  settingsButtons.length > 0
  && settingsButtons.every((button) => window.getComputedStyle(button).height === '32px')
  && window.getComputedStyle(settingsInput).height === '32px')
click(settingsNavItems().find((button) => button.textContent?.includes('模型')))
await flush(140)
assert('internal rail switches the settings category',
  settingsNavItems().find((button) => button.textContent?.includes('模型'))?.getAttribute('data-on') === 'true'
  && settingsSection()?.querySelector('.pr-settings-section-head h2')?.textContent === '模型')
const modelSelect = container.querySelector('.pr-settings-select .pr-select-trigger')
assert('model setting is first on the model page',
  settingsSection()?.querySelector('.pr-setting .pr-setting-text b')?.textContent === '启用 AI 功能')
assert('model picker present', Boolean(modelSelect))
assert('model picker defaults to DSH', Boolean(modelSelect?.textContent?.includes('跟随 DSH 默认')))
click(modelSelect)
await flush(60)
assert('model picker lists configured models',
  [...container.querySelectorAll('.pr-select-option')].some((option) => option.textContent?.includes('stub-1')))
assert('model picker is grouped by provider',
  [...container.querySelectorAll('.pr-select-group')].some((group) => group.textContent?.includes('Stub')))
modelSelect.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await flush(40)
assert('settings select uses the flat shell and chevron',
  Boolean(container.querySelector('.pr-settings-select .pr-select-trigger'))
  && Boolean(container.querySelector('.pr-settings-select .pr-select-chevron')))
assert('settings controls share a 32px height',
  window.getComputedStyle(modelSelect).height === '32px'
  && [...container.querySelectorAll('.pr-settings-page .pr-btn')]
    .every((button) => window.getComputedStyle(button).height === '32px'))
const settingsSwitch = container.querySelector('.pr-settings-page .pr-switch')
assert('settings toggles are pill switches',
  window.getComputedStyle(settingsSwitch).width === '38px'
  && window.getComputedStyle(settingsSwitch).height === '22px')
click(settingsNavItems().find((button) => button.textContent?.includes('界面')))
await flush(140)
assert('interface section owns the default library view',
  settingsSection()?.querySelector('.pr-settings-section-head h2')?.textContent === '界面'
  && Boolean(container.querySelector('.pr-settings-select .pr-select-trigger[aria-label="默认视图"]')))
assert('interface section owns the recent limit',
  container.querySelector('.pr-settings-select .pr-select-trigger[aria-label="最近阅读展示数量"]')?.textContent?.includes('20 篇'))
click(settingsNavItems().find((button) => button.textContent?.includes('实验性功能')))
await flush(140)
assert('experimental section lists the feature switches',
  settingsSection()?.querySelector('.pr-settings-section-head h2')?.textContent === '实验性功能'
  && settingsSection()?.querySelectorAll('.pr-switch').length === 3)

// Enabling the experiment must add the sidebar page and render the host tasks.
settingsSection().querySelectorAll('.pr-switch')[2].click()
await flush(160)
assert('task center switch adds the sidebar page', Boolean(navItem('任务列表')))
click(navItem('任务列表'))
await flush(220)
assert('task page lists active tasks',
  container.querySelector('.pr-tasks-page .pr-task-row[data-active]')?.textContent?.includes('Advances in Bias Drift'))
assert('task row shows its progress detail',
  container.querySelector('.pr-task-sub')?.textContent?.includes('第 3 页'))
assert('task history shows token spend and model',
  container.querySelector('.pr-task-row[data-state="done"] .pr-task-cost-cell')?.textContent?.includes('1.2k tokens')
  && container.querySelector('.pr-task-row[data-state="done"] .pr-task-models')?.textContent?.includes('stub/stub-1'))
assert('task filters are custom selects',
  container.querySelectorAll('.pr-tasks-toolbar .pr-select-trigger').length === 3)
click(navItem('系统设置'))
await flush(160)
click(settingsNavItems().find((button) => button.textContent?.includes('实验性功能')))
await flush(140)
settingsSection().querySelectorAll('.pr-switch')[2].click()
await flush(160)
assert('task center switch removes the sidebar page', !navItem('任务列表'))
click(settingsNavItems().find((button) => button.textContent?.includes('存储')))
await flush(140)
assert('settings shows data dir', html().includes('paperreader'))
assert('storage section keeps folders and the import limit',
  Boolean(container.querySelector('.pr-settings-folder-add input'))
  && Boolean(container.querySelector('.pr-settings-number input')))
click(settingsNavItems().find((button) => button.textContent?.includes('用量')))
await flush(140)
assert('usage section renders the token matrix',
  settingsSection()?.querySelector('.pr-settings-section-head h2')?.textContent === '用量'
  && Boolean(container.querySelector('.pr-usage')))
assert('usage totals use K/M units instead of Chinese unit words',
  container.querySelector('.pr-usage-total-value')?.textContent?.includes('1.2 M'))
assert('usage call counts keep thousands separators',
  settingsSection()?.textContent?.includes('1,234 次调用'))
assert('usage flags an unreported cache write instead of a fake zero',
  [...container.querySelectorAll('.pr-usage-stats > div')]
    .some((row) => row.textContent?.includes('缓存写入') && row.textContent?.includes('—'))
  && Boolean(container.querySelector('.pr-usage-caption')))
click(settingsNavItems().find((button) => button.textContent?.includes('维护')))
await flush(140)
assert('internal rail switches to maintenance',
  settingsNavItems().find((button) => button.textContent?.includes('维护'))?.getAttribute('data-on') === 'true'
  && settingsSection()?.textContent?.includes('重建检索索引'))
click(settingsNavItems().find((button) => button.textContent?.includes('存储')))
await flush(140)
assert('internal rail returns to the storage category',
  settingsNavItems()[0]?.getAttribute('data-on') === 'true'
  && settingsSection()?.textContent?.includes('论文存放文件夹'))

const setNativeValue = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const exactButton = (text) => [...container.querySelectorAll('button')]
  .find((button) => button.textContent?.trim() === text)

click(exactButton('添加文件夹'))
await flush(220)
assert('folder picker adds the picked path', html().includes('D:/Picked'))
assert('folder picker saves immediately', calls.some((call) => call.startsWith('POST /api/paperreader/config')))

const manualInput = container.querySelector('.pr-settings-folder-add input')
setNativeValue(manualInput, 'D:/Typed')
click(exactButton('添加'))
await flush(220)
assert('manual folder add works', html().includes('D:/Typed'))

// The fixed library tab is a library entry, not a generic "back".
click(container.querySelector('.pr-tab[data-tab-home]'))
await flush(160)
assert('top bar library tab always opens the library',
  Boolean(container.querySelector('.pr-folders')) && html().includes('个文件夹'))
assert('back arrow is disabled away from the reader',
  Boolean(container.querySelector('.pr-tb-back')?.disabled))

// Theme plumbing. Three rungs, contract first:
//   1 --pr-accent-host  mirrored from the theme snapshot, so whichever token a
//                       colour plugin set is the one we follow
//   2 --we-accent       the desktop appearance plugin's private body variable
//                       (its own token remaps are scoped to host anchors)
//   3 state-business-primary  the stock host accent (blue)
// brand-primary alone is the monochrome contrast colour and button-info-fill is
// a frozen static alias — either one leaves the plugin on the old colour.
const sheet = document.getElementById('paperreader-styles')?.textContent ?? ''
assert('KaTeX stylesheet link is installed', Boolean(document.getElementById('paperreader-katex')))
assert('nav icons inherit the label colour', sheet.includes('.pr-nav-item svg { color: currentColor; }'))
assert('active nav no longer recolours the icon', !sheet.includes('.pr-nav-item[data-on] svg'))
assert('thumbnail rail renders page previews', sheet.includes('.pr-thumb-canvas'))
assert('thumbnail rail removes scrollbar arrows', sheet.includes('.pr-thumbs::-webkit-scrollbar-button'))
assert('thumbnail rail keeps its own scroll container',
  /\.pr-rail-inner\s*\{[^}]*flex:\s*1 1 auto/.test(sheet)
  && /\.pr-thumbs\s*\{[^}]*overflow-y:\s*auto/.test(sheet))
assert('AI panel keeps its own scroll container',
  /\.pr-panel-inner\s*\{[^}]*flex:\s*1 1 auto/.test(sheet))
assert('reading stage hides its scrollbar', sheet.includes('.pr-stage::-webkit-scrollbar'))
assert('selection uses a merged overlay', sheet.includes('.pr-sel-layer') && sheet.includes('.pr-textlayer span::selection { background: transparent; }'))
assert('highlight colour controls are square', sheet.includes('.pr-toolbar .pr-swatch') && sheet.includes('width: 16px; height: 16px'))
assert('composer supports a quoted selection', sheet.includes('.pr-composer-quote'))
assert('info abstract uses the panel font', sheet.includes('.pr-info-abstract { margin: 0; font-family: inherit;'))
assert('PDF page paints an all-around shadow', sheet.includes('0 0 0 1px color-mix(in srgb, var(--pr-line-strong) 42%') && sheet.includes('0 12px 32px'))
assert('PDF zoom scales a fixed-geometry layer',
  sheet.includes('.pr-pdfpage-stage') && sheet.includes('transform-origin: 0 0'))
assert('dark reading wrapper drops its shadow', sheet.includes('.pr-root[data-scheme="dark"] .pr-sheet[data-pdf] { box-shadow: none; }'))
assert('reading stage leaves room for the page shadow', sheet.includes('padding: 24px 26px 36px'))
assert('annotation focus ring is styled', sheet.includes('.pr-anno-ring') && sheet.includes('pr-anno-pulse'))
assert('read toggle styles its done state', sheet.includes('.pr-read-toggle[data-done]'))
assert('left rail draws a divider against the paper',
  /\.pr-rail\s*\{[^}]*border-right:\s*1px solid var\(--pr-line\)/.test(sheet)
  && /\.pr-rail\[data-collapsed\]\s*\{[^}]*border-right-color:\s*transparent/.test(sheet))
assert('translation bubble scrolls inside the viewport', sheet.includes('overscroll-behavior: contain') && sheet.includes('overflow-wrap: anywhere'))
assert('accent chain prefers the snapshot mirror', sheet.includes('--pr-accent: var(--pr-accent-host, var(--we-accent,'))
assert('accent falls back to the plugin variable', sheet.includes('var(--we-accent, var(--dsw-alias-state-business-primary, #4176e6))'))
assert('accent falls back to the host accent token', sheet.includes('var(--dsw-alias-state-business-primary, #4176e6)'))
assert('ink follows the accent luminance', sheet.includes('--pr-on-accent: var(--pr-ink-host, var(--we-accent-ink, #fff))'))
assert('no fill uses the monochrome brand token', !/background:\s*var\(--dsw-alias-brand-primary/.test(sheet))
assert('no fill uses the frozen info token', !/var\(--dsw-alias-button-info-fill/.test(sheet))
assert('primary button paints the accent', sheet.includes('.pr-btn[data-primary] { background: var(--pr-accent-solid, #4176e6)'))
assert('stock theme emits no inline accent override', !html().includes('--pr-accent-host'))

const themed = (tokens) => ({ theme: { getTheme: () => ({ active: { colorScheme: 'dark', tokens } }) } })
assert('snapshot accent is used when a plugin set brand-primary',
  captured.module.readAccentToken(themed({ '--dsw-alias-brand-primary': '#F1717F' })) === '#F1717F')
assert('snapshot accent prefers brand-primary',
  captured.module.readAccentToken(themed({ '--dsw-alias-state-business-primary': '#123456', '--dsw-alias-brand-primary': '#F1717F' })) === '#F1717F')
assert('snapshot accent falls through to state-business-primary',
  captured.module.readAccentToken(themed({ '--dsw-alias-state-business-primary': '#123456' })) === '#123456')
assert('snapshot accent keeps var() expressions resolvable',
  captured.module.readAccentToken(themed({ '--dsw-alias-brand-primary': 'var(--dsw-static-deepseek-450)' })) === 'var(--dsw-static-deepseek-450)')
assert('stock (empty) token map means no override', captured.module.readAccentToken(themed({})) === null)
assert('initial/sentinel tokens are ignored', captured.module.readAccentToken(themed({ '--dsw-alias-brand-primary': 'initial' })) === null)
assert('missing theme service is tolerated', captured.module.readAccentToken(undefined) === null)
assert('ink on a pink accent is white', captured.module.accentInk('#F1717F') === '#ffffff')
assert('ink on a dark accent is white', captured.module.accentInk('#123456') === '#ffffff')
assert('ink on a light accent is near-black', captured.module.accentInk('#ffffff') === '#0f1115')
assert('ink on yellow is near-black', captured.module.accentInk('#ffd400') === '#0f1115')

console.log(failures === 0 ? '\nall render checks passed' : `\n${failures} render check(s) failed`)
console.log('request log:', [...new Set(calls)].slice(0, 12).join('\n  '))
process.exitCode = failures === 0 ? 0 : 1
