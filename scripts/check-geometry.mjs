/**
 * Geometry smoke check against a real paper (manual, not part of `pnpm test`).
 *
 * Usage: node scripts/check-geometry.mjs [path/to/paper.pdf]
 *
 * Verifies that extraction v2 produces sane per-line geometry and that a
 * v1 `pages.json` is re-parsed once by `ensurePageGeometry`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../dist/host/library/store.js'
import { extractPages, PAGE_VERSION } from '../dist/host/pdf/extract.js'
import { ensurePageGeometry } from '../dist/host/pdf/refresh.js'

const pdfPath = path.resolve(process.argv[2]
  ?? '.tmp/libcopy/paperreader/inbox/mw4xgeh5-1706.03762 - Attention Is All You Need.pdf')

const bytes = await fs.readFile(pdfPath)
const { pages } = await extractPages(new Uint8Array(bytes))
console.log(`pages: ${pages.length}`)

let withLines = 0
let blocks = 0
for (const page of pages) {
  for (const block of page.blocks) {
    blocks += 1
    if (block.lines?.length) withLines += 1
    const size = block.size ?? 10
    assert.ok(block.leading && block.leading >= size * 0.9 && block.leading <= size * 2.6,
      `${block.id}: leading ${block.leading} for size ${size}`)
    assert.ok((block.lines?.length ?? 0) >= 1, `${block.id}: no lines`)
    const box = block.lines[0].box
    assert.ok(box[2] > 0 && box[3] > 0, `${block.id}: empty line box`)
    if (block.lines.length > 1) {
      const first = block.lines[0]
      const last = block.lines[block.lines.length - 1]
      assert.ok(last.baseline > first.baseline, `${block.id}: baselines not ordered`)
      assert.ok(last.box[1] + last.box[3] <= block.bbox[1] + block.bbox[3] + 1,
        `${block.id}: lines fall outside the block box`)
    }
  }
}
console.log(`blocks: ${blocks}, with line boxes: ${withLines}`)

const firstBody = pages[0].blocks.find((block) => block.kind === 'para' && (block.lines?.length ?? 0) > 2)
assert.ok(firstBody, 'page 1 has a multi-line paragraph')
console.log('sample:', {
  id: firstBody.id,
  size: firstBody.size,
  leading: firstBody.leading,
  lines: firstBody.lines.length,
  indent: firstBody.indent,
  align: firstBody.align,
})

// A paper parsed by v1 has no lines and no parseVersion: it must be upgraded once.
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreader-geometry-'))
const store = new Store(home)
await store.load()
await store.addPaper({
  id: 'p1',
  title: 'Attention Is All You Need',
  authors: [],
  tags: [],
  folder: null,
  status: 'todo',
  progress: 0,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: 'pdf',
  hasFullText: true,
  hasSummary: false,
  pageCount: pages.length,
  filePath: pdfPath,
  parseVersion: 1,
})
await store.writePages('p1', pages.map((page) => ({
  ...page,
  blocks: page.blocks.map(({ lines: _lines, leading: _leading, indent: _indent, align: _align, ...rest }) => rest),
})))

const upgraded = await ensurePageGeometry(store, store.getPaper('p1'), () => {})
assert.equal(store.getPaper('p1').parseVersion, PAGE_VERSION)
assert.ok(upgraded?.[0]?.blocks[0]?.lines?.length, 'the upgrade must write line boxes')
console.log('re-parse: ok')

await fs.rm(home, { recursive: true, force: true })
console.log('check-geometry: ok')
