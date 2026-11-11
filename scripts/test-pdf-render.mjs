/**
 * Canvas pipeline checks: the reader swaps a finished bitmap into the visible
 * canvas (no white flash), honours aborts, caps the backing store, and shares
 * one scratch bitmap per canvas.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document

const ops = []
dom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const canvas = this
  return {
    canvas,
    clearRect: (...args) => ops.push({ op: 'clearRect', canvas, args }),
    drawImage: (source, ...args) => ops.push({ op: 'drawImage', canvas, source, args }),
  }
}
dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:,'

const pdfStub = `
export const GlobalWorkerOptions = { workerSrc: '' }
export const Util = {
  // pdf.js matrix composition: m1 × m2, both [a, b, c, d, e, f].
  transform: ([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) => [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ],
}
export const getDocument = () => ({ promise: Promise.reject(new Error('stub')) })
`

const result = await build({
  entryPoints: ['src/client/lib/pdf.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  logLevel: 'warning',
  plugins: [{
    name: 'stub-pdfjs',
    setup(build) {
      build.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: 'pdfjs-dist', namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: pdfStub, loader: 'js' }))
    },
  }],
})
const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const { renderPage } = module

/** A page whose render task settles only when the test says so. */
function fakePage(width = 612, height = 792) {
  const page = { width, height, tasks: [], cancels: 0 }
  page.getViewport = ({ scale }) => ({ width: width * scale, height: height * scale, scale })
  page.render = (params) => {
    let settle
    let fail
    const promise = new Promise((resolve, reject) => { settle = resolve; fail = reject })
    const task = { params, promise, settle }
    task.cancel = () => {
      page.cancels += 1
      fail(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' }))
    }
    page.tasks.push(task)
    return task
  }
  return page
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const draws = () => ops.filter((entry) => entry.op === 'drawImage')

// 1. The visible canvas keeps its old bitmap until the new page is finished,
//    then receives the finished copy in one blit.
{
  const canvas = document.createElement('canvas')
  canvas.width = 10
  canvas.height = 10
  const page = fakePage()
  ops.length = 0

  const job = renderPage(page, canvas, { rasterScale: 1, cssWidth: 612, cssHeight: 792 })
  await tick(5)
  assert.equal(page.tasks.length, 1, 'render task starts')
  assert.equal(canvas.width, 10, 'visible bitmap untouched while painting')
  assert.equal(canvas.height, 10, 'visible bitmap untouched while painting')
  assert.equal(draws().length, 0, 'nothing blitted before the page is ready')

  page.tasks[0].settle()
  await job
  assert.equal(canvas.width, 612, 'visible bitmap sized once ready')
  assert.equal(canvas.height, 792, 'visible bitmap sized once ready')
  assert.equal(draws().length, 1, 'one blit per page')
  assert.notEqual(draws()[0].source, canvas, 'blit comes from the scratch bitmap')
  assert.equal(canvas.style.width, '612px')
  assert.equal(canvas.style.height, '792px')
}

// 2. A stale render (another zoom step, another page) never touches the canvas.
{
  const canvas = document.createElement('canvas')
  canvas.width = 10
  canvas.height = 10
  const page = fakePage()
  ops.length = 0

  const controller = new AbortController()
  const job = renderPage(page, canvas, {
    rasterScale: 1,
    cssWidth: 612,
    cssHeight: 792,
    signal: controller.signal,
  })
  await tick(5)
  controller.abort()
  await job
  assert.equal(page.cancels, 1, 'pdf.js render is cancelled')
  assert.equal(canvas.width, 10, 'cancelled render leaves the old page alone')
  assert.equal(draws().length, 0, 'cancelled render never blits')
}

// 3. The backing store stays under 10 MP no matter how far the reader zooms.
{
  const canvas = document.createElement('canvas')
  const page = fakePage()
  const job = renderPage(page, canvas, { rasterScale: 8, cssWidth: 612, cssHeight: 792 })
  await tick(5)
  page.tasks[0].settle()
  await job
  assert(canvas.width * canvas.height <= 10_000_000, `capped at 10MP, got ${canvas.width}x${canvas.height}`)
  assert(canvas.width * canvas.height > 9_000_000, 'still uses the whole budget')
}

// 4. Thumbnails paint in place (a placeholder is showing anyway) and never
//    allocate a second bitmap.
{
  const canvas = document.createElement('canvas')
  const page = fakePage()
  ops.length = 0
  const job = renderPage(page, canvas, {
    rasterScale: 0.2,
    cssWidth: 112,
    cssHeight: 145,
    direct: true,
  })
  await tick(5)
  assert.equal(canvas.width, Math.floor(612 * 0.2), 'direct paint sizes the canvas up front')
  page.tasks[0].settle()
  await job
  assert.equal(draws().length, 0, 'direct paint does not copy a bitmap')
}

// 5. Two renders on the same canvas never overlap (pdf.js allows one task).
{
  const canvas = document.createElement('canvas')
  const page = fakePage()
  const first = renderPage(page, canvas, { rasterScale: 1, cssWidth: 612, cssHeight: 792 })
  const second = renderPage(page, canvas, { rasterScale: 1, cssWidth: 612, cssHeight: 792 })
  await tick(5)
  assert.equal(page.tasks.length, 1, 'second render waits for the first')
  page.tasks[0].settle()
  await tick(5)
  assert.equal(page.tasks.length, 2, 'queued render starts afterwards')
  page.tasks[1].settle()
  await Promise.all([first, second])
}

// 6. textSpans keeps PDF-point geometry: zoom only multiplies the viewport.
{
  const { textSpans } = module
  const content = {
    items: [
      { str: 'hello', transform: [10, 0, 0, 10, 100, 200], width: 30 },
      { str: '   ', transform: [10, 0, 0, 10, 130, 200], width: 9 },
    ],
  }
  const spans = textSpans(content, { scale: 2, transform: [2, 0, 0, 2, 0, 0] })
  assert.equal(spans.length, 2)
  assert.equal(spans[0].text, 'hello')
  assert.equal(spans[0].left, 200, 'position scales with the viewport')
  assert.equal(spans[0].top, 380, 'top is the glyph baseline minus the em height')
  assert.equal(spans[0].width, 60, 'item width scales with the viewport')
  assert.equal(spans[0].fontSize, 20)
  assert.equal(spans[1].text, '   ', 'blank items keep their text for word spacing')
}

console.log('all pdf render checks passed')
