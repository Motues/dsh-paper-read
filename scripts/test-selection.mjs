import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const result = await build({
  entryPoints: ['src/client/features/reader/selection.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  logLevel: 'warning',
})
const code = result.outputFiles[0].text
const selection = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const clean = selection.cleanSelectionText

assert.equal(clean('  the   materials\n constituting  '), 'the materials constituting')
assert.equal(clean('H+ , Na+ , and K+ .'), 'H+, Na+, and K+.')
assert.equal(clean('see ( Fig. 2 )'), 'see (Fig. 2)')
assert.equal(clean('zero\u200bwidth\u200dtext\ufeff'), 'zerowidthtext')
assert.equal(clean('line one\nline two'), 'line one line two')

// Blank text items belong to the copied text, never to a highlight box: the
// wide line-ending spacers some PDFs emit must not stretch a rectangle.
const trim = selection.trimWhitespaceBounds
assert.deepEqual(trim('  the materials  '), [2, 15])
assert.deepEqual(trim('word'), [0, 4])
assert.equal(trim('   \n '), null)

const ink = selection.inkRect([10, 20, 30, 18])
assert.deepEqual(ink, [10, 23.96, 30, 18.36])
// The band reaches past the baseline so p/g/y descenders stay covered.
assert(ink[1] + ink[3] >= 20 + 18 * 1.2, 'highlight covers descenders')
assert(ink[1] >= 20 + 18 * 0.2, 'highlight does not start above ascenders')

// Search hits are located by flattening the text layer: case and whitespace do
// not matter, and a hyphen that only exists because a word wrapped is dropped.
const compact = selection.compactText
assert.equal(compact([{ text: 'A cen', top: 0 }, { text: 'tral goal', top: 0 }]).text, 'acentralgoal')
const wrapped = compact([{ text: 'trans-', top: 0 }, { text: 'former', top: 12 }])
assert.equal(wrapped.text, 'transformer')
assert.equal(wrapped.layer[5], 1, 'the wrapped word maps back to its own span')
assert.equal(wrapped.offset[5], 0)
assert.equal(compact([{ text: 'state-', top: 0 }, { text: 'Of', top: 12 }]).text, 'state-of')
assert.equal(compact([{ text: 'state-', top: 0 }, { text: 'of', top: 0 }]).text, 'state-of')
assert.equal(selection.compactNeedle('  Central\tGoal '), 'centralgoal')

// Long translations must stay inside the viewport and scroll internally.
const low = selection.placeBubble({ right: 1200, top: 780 }, { w: 1200, h: 800 })
assert(low.top >= 72)
assert(low.top + low.maxHeight <= 800 - 18)
assert(low.left + 316 <= 1200 - 20)
const high = selection.placeBubble({ right: 0, top: 100 }, { w: 1200, h: 800 })
assert(high.top >= 72)
assert(high.maxHeight <= 460)
assert(high.top + high.maxHeight <= 800 - 18)
const short = selection.placeBubble({ right: 500, top: 350 }, { w: 700, h: 400 })
assert(short.top + short.maxHeight <= 400 - 18)
assert(short.left + 316 <= 700 - 20)

// Older highlights stored a 23px line box plus an 18px text box for every
// word. Keep the dominant text height, drop the duplicates, merge overlaps.
const merged = selection.mergeStoredRects([
  [10, 20, 30, 18], [10, 17, 30, 23],
  [40, 20, 22, 18], [40, 17, 22, 23],
  [80, 20, 18, 18], [80, 17, 18, 23],
])
assert.deepEqual(merged, [[10, 20, 52, 18], [80, 20, 18, 18]])

const columns = selection.mergeStoredRects([
  [10, 20, 20, 18],
  [50, 20, 20, 18],
])
assert.equal(columns.length, 2)
assert.deepEqual(columns, [[10, 20, 20, 18], [50, 20, 20, 18]])

const lines = selection.mergeStoredRects([
  [10, 20, 20, 18],
  [10, 45, 30, 18],
])
assert.deepEqual(lines, [[10, 20, 20, 18], [10, 45, 30, 18]])

// ── readSelection geometry (jsdom with a fake proportional text layer) ──────
// The blank item some PDFs put at the end of a line is 100pt+ wide. It belongs
// to the copied text, never to the highlight box; a fragment's own trailing
// blanks are trimmed the same way.
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  globalThis.document = dom.window.document
  globalThis.Node = dom.window.Node
  globalThis.DOMRect = dom.window.DOMRect ?? class {
    constructor(x, y, width, height) {
      Object.assign(this, { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height })
    }
  }

  const page = document.createElement('div')
  page.className = 'pr-pdfpage'
  const layer = document.createElement('div')
  layer.className = 'pr-textlayer'
  page.appendChild(layer)
  document.body.appendChild(page)

  // Two lines: the first ends with a blank item as wide as the column, the
  // second has trailing blanks inside its own text node.
  const specs = [
    { text: 'The end of the paragraph', left: 20, top: 40, width: 152, height: 13 },
    { text: ' ', left: 172, top: 40, width: 169, height: 13 },
    { text: 'word   ', left: 20, top: 60, width: 60, height: 13 },
  ]
  const spans = specs.map((spec) => {
    const span = document.createElement('span')
    span.textContent = spec.text
    span.getBoundingClientRect = () => ({
      left: spec.left,
      top: spec.top,
      right: spec.left + spec.width,
      bottom: spec.top + spec.height,
      width: spec.width,
      height: spec.height,
    })
    layer.appendChild(span)
    return span
  })

  const indexOf = (node) => spans.findIndex((span) => span.contains(node))
  const partial = (spanIndex, from, to) => {
    const spec = specs[spanIndex]
    const length = spec.text.length
    const ratio = (value) => (length > 0 ? value / length : 0)
    return {
      left: spec.left + spec.width * ratio(from),
      right: spec.left + spec.width * ratio(to),
      top: spec.top,
      bottom: spec.top + spec.height,
      height: spec.height,
    }
  }
  dom.window.Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const first = indexOf(this.startContainer)
    const last = indexOf(this.endContainer)
    const boxes = []
    for (let index = first; index <= last; index += 1) {
      const from = index === first ? this.startOffset : 0
      const to = index === last ? this.endOffset : specs[index].text.length
      if (to > from) boxes.push(partial(index, from, to))
    }
    const left = Math.min(...boxes.map((box) => box.left))
    const right = Math.max(...boxes.map((box) => box.right))
    const top = Math.min(...boxes.map((box) => box.top))
    const bottom = Math.max(...boxes.map((box) => box.bottom))
    return { left, right, top, bottom, width: right - left, height: bottom - top }
  }

  const range = document.createRange()
  range.setStart(spans[0].firstChild, 0)
  range.setEnd(spans[1].firstChild, 1)
  const first = selection.readSelection(range, page, 1)
  assert(first, 'a selection across a line with a blank item still yields a box')
  assert.deepEqual(first.rects, [[20, 40, 152, 13]], 'the wide blank item is not highlighted')
  assert.equal(first.quote, 'The end of the paragraph')

  const trimmed = document.createRange()
  trimmed.setStart(spans[2].firstChild, 0)
  trimmed.setEnd(spans[2].firstChild, specs[2].text.length)
  const second = selection.readSelection(trimmed, page, 1)
  assert(second)
  assert.equal(second.rects.length, 1)
  assert.equal(second.rects[0][2], 34.29, 'trailing blanks inside a span are trimmed')
  assert.equal(second.quote, 'word')

  // A search hit is located by its matched characters, not by the block bbox.
  const located = selection.locateTextInPage(page, 'paragraph', [20, 40, 152, 13], 1)
  assert(located, 'the hit resolves against the text layer')
  assert.deepEqual(located, [[115, 40, 57, 13]])
  assert.equal(selection.locateTextInPage(page, 'not on this page', [20, 40, 152, 13], 1), null)
}

console.log('all selection checks passed')
