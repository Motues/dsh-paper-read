/**
 * Translation planning: reading order, and which blocks must stay in the
 * source language.
 *
 * The PDF extractor is deliberately local (it knows nothing about translation),
 * so its block order is only "roughly top to bottom". Two-column pages therefore
 * need a column-aware order before they can be reflowed, and the reference list
 * needs a document-level cut: a heading applies to the rest of the page and to
 * every following page until an appendix starts.
 *
 * Everything here is pure; the translation service only caches the result.
 */

import type {
  Block,
  PageText,
  TranslationSkip,
  VisualRegion,
} from '../../shared/domain.js'

export interface PagePlan {
  page: number
  /** Every block id on the page, in reading order. */
  order: string[]
  /** Blocks that must not be translated, with the reason. */
  skipped: Record<string, TranslationSkip>
  /** Visual regions detected on this page (may be empty). */
  visuals: VisualRegion[]
}

export interface DocumentPlan {
  pages: Map<number, PagePlan>
  /** Pages that carry at least one reference block. */
  referencePages: number[]
}

const REFERENCE_HEADING = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(references|bibliography|literature cited|works cited|参考文献|參考文獻)\b/i
const APPENDIX_HEADING = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(appendix|appendices|supplementary|supporting information|extended data|additional information|附录)\b/i
const LETTER_HEADING = /^[A-Z](?:\s*[.):]\s*|\s+)[A-Z0-9]/
const REFERENCE_ENTRY = /^(?:\[\d{1,3}\]|\d{1,3}\.\s)/
const ABSTRACT_HEADING = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(abstract|摘要)\b/i
const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:\/|of)\s*\d+)?$/i

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const URL = /https?:\/\//i
const DOI = /\b10\.\d{4,9}\//i
const ARXIV = /\barxiv\s*[:.]?\s*\d{4}\.\d{4,5}/i
const LICENSE = /(©|copyright|all rights reserved|permission to make digital|isbn\s|proceedings of|conference on|published in|accepted (?:at|to|by)|under review|preprint|provided proper attribution|hereby grant|scholarly works|license|equal contribution|listing order|work performed while at)/i

function textOf(block: Block): string {
  return block.text.replace(/\s+/g, ' ').trim()
}

function left(block: Block): number {
  return block.bbox[0]
}

function top(block: Block): number {
  return block.bbox[1]
}

function bottom(block: Block): number {
  return block.bbox[1] + Math.max(0, block.bbox[3])
}

function byTop(a: Block, b: Block): number {
  return top(a) - top(b) || left(a) - left(b)
}

function cjkRatio(text: string): number {
  let cjk = 0
  let visible = 0
  for (const char of text) {
    if (/\s/.test(char)) continue
    visible += 1
    if (/[\u3400-\u9fff]/.test(char)) cjk += 1
  }
  return visible === 0 ? 0 : cjk / visible
}

/**
 * Split the page at the widest gap between block *left edges*.
 *
 * Left edges are much more stable than right edges in extracted PDFs: a line
 * that accidentally absorbed a piece of the opposite column still starts on its
 * own side. Width-based gutters used to classify those lines as "spanning" and
 * then interleave both columns line by line.
 */
function findGutter(blocks: Block[], pageWidth: number): number | null {
  if (blocks.length < 4) return null
  const lefts = [...new Set(blocks.map((block) => Math.round(left(block) * 10) / 10))]
    .sort((a, b) => a - b)
  let best: { width: number; centre: number } | null = null
  for (let index = 0; index < lefts.length - 1; index += 1) {
    const from = lefts[index]
    const to = lefts[index + 1]
    const gap = to - from
    if (gap < 12) continue
    const centre = (from + to) / 2
    if (centre < pageWidth * 0.25 || centre > pageWidth * 0.75) continue
    const onLeft = blocks.filter((block) => left(block) < from + 1).length
    const onRight = blocks.filter((block) => left(block) >= to - 1).length
    if (onLeft < 2 || onRight < 2) continue
    if (!best || gap > best.width) best = { width: gap, centre }
  }
  return best ? best.centre : null
}

/**
 * Column-aware reading order.
 *
 * 1. wide/spanning blocks split the page into horizontal bands;
 * 2. inside a band, a clean gutter splits left/right columns;
 * 3. otherwise blocks fall back to top-to-bottom, left-to-right.
 */
export function readingOrder(blocks: Block[], pageWidth: number, pageNumber = 0): Block[] {
  if (blocks.length <= 1) return [...blocks]
  // Title pages are one logical column even when the author block is laid out
  // in several columns; a gutter there only scrambles the abstract and body.
  if (pageNumber === 1) return [...blocks].sort(byTop)
  // Only a title, a caption or a genuinely full-width element may separate
  // bands. A 60%-wide paragraph on a two-column page is a merged line, not a
  // section break.
  const spanning = blocks
    .filter((block) => (
      block.kind === 'title'
      || block.kind === 'caption'
      || block.bbox[2] >= pageWidth * 0.78
    ))
    .sort(byTop)
  const body = blocks.filter((block) => !spanning.includes(block))
  const gutter = findGutter(body, pageWidth)
  if (!gutter) return [...blocks].sort(byTop)
  const bandOf = (block: Block): number => {
    let band = 0
    for (const span of spanning) {
      if (bottom(span) <= top(block) + 1) band += 1
      else if (top(span) >= bottom(block) - 1) break
    }
    return band
  }
  const columnOf = (block: Block): number => (left(block) < gutter ? 0 : 1)
  return [...blocks].sort((a, b) => {
    const band = bandOf(a) - bandOf(b)
    if (band !== 0) return band
    // Spanning blocks lead their band; then left column before right.
    const spanA = spanning.includes(a) ? -1 : columnOf(a)
    const spanB = spanning.includes(b) ? -1 : columnOf(b)
    if (spanA !== spanB) return spanA - spanB
    return byTop(a, b)
  })
}

function isReferenceHeading(block: Block): boolean {
  return REFERENCE_HEADING.test(textOf(block))
}

function isAppendixHeading(block: Block): boolean {
  const text = textOf(block)
  if (text.length > 160) return false
  // A one-letter section ("A Discussion", "B.1 Forward pass") after the
  // references is an appendix; reference entries are set a size smaller.
  if ((block.size ?? 10) < 10.5) return false
  return APPENDIX_HEADING.test(text) || LETTER_HEADING.test(text)
}

function looksLikeReference(block: Block): boolean {
  const text = textOf(block)
  if (text.length < 20) return false
  if (!REFERENCE_ENTRY.test(text)) return false
  // A body paragraph can start with a citation ("[45] by decomposing ...").
  // A bibliography entry effectively always carries a year, a DOI or a URL.
  return DOI.test(text) || URL.test(text) || /\b(?:19|20)\d{2}\b/.test(text)
}

function overlapRatio(block: Block, region: VisualRegion): number {
  const bx = left(block)
  const by = top(block)
  const bw = Math.max(0, block.bbox[2])
  const bh = Math.max(0, block.bbox[3])
  const rx = region.bbox[0]
  const ry = region.bbox[1]
  const rw = Math.max(0, region.bbox[2])
  const rh = Math.max(0, region.bbox[3])
  const w = Math.min(bx + bw, rx + rw) - Math.max(bx, rx)
  const h = Math.min(by + bh, ry + rh) - Math.max(by, ry)
  if (w <= 0 || h <= 0) return 0
  const area = bw * bh
  return area <= 0 ? 0 : (w * h) / area
}

/**
 * Build one plan for the whole paper.
 *
 * `visuals` is the optional `visuals.json` payload; when it is missing the plan
 * still works, it just cannot keep table/figure-internal text out of the model.
 */
export function planDocument(
  pages: PageText[],
  visuals: Record<string, VisualRegion[]> = {},
): DocumentPlan {
  const pageOf = new Map<string, number>()
  const plans = new Map<number, PagePlan>()

  for (const page of pages) {
    const order = readingOrder(page.blocks, page.width, page.page).map((block) => block.id)
    for (const block of page.blocks) pageOf.set(block.id, page.page)
    plans.set(page.page, {
      page: page.page,
      order,
      skipped: {},
      // Title pages often have decorative rules or a boxed abstract that the
      // vector detector mistakes for a table; never crop or skip page 1 text.
      visuals: page.page === 1 ? [] : visuals[String(page.page)] ?? [],
    })
  }

  const skip = (block: Block, reason: TranslationSkip): void => {
    const plan = plans.get(pageOf.get(block.id) ?? -1)
    if (!plan || plan.skipped[block.id]) return
    plan.skipped[block.id] = reason
  }

  // ── 1. block-level facts ─────────────────────────────────────────────────
  for (const page of pages) {
    const plan = plans.get(page.page)
    if (!plan) continue
    for (const block of page.blocks) {
      if (block.kind === 'equation') plan.skipped[block.id] = 'equation'
      else if (block.kind === 'ref' && looksLikeReference(block)) plan.skipped[block.id] = 'ref'
      if (plan.skipped[block.id]) continue

      for (const region of plan.visuals) {
        if (block.kind === 'caption' || block.kind === 'title') break
        // A long paragraph is prose even if a heuristic region overlaps it;
        // never lose a whole abstract or section to a false table box.
        if (block.kind === 'para' && block.text.length > 280) break
        if (overlapRatio(block, region) >= 0.5) {
          plan.skipped[block.id] = 'visual'
          break
        }
      }
    }
  }

  // ── 2. first-page metadata (authors, affiliations, licence, arXiv stamp) ─
  const first = pages[0]
  if (first) {
    const pageBlocks = [...first.blocks].sort(byTop)
    const titles = pageBlocks.filter((block) => (
      block.kind === 'title'
      && !/(arxiv|doi|https?:|©|copyright|license)/i.test(textOf(block))
    ))
    const title = titles.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
      ?? pageBlocks.filter((block) => block.kind === 'title').sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
      ?? pageBlocks[0]
    const abstract = pageBlocks.find((block) => ABSTRACT_HEADING.test(textOf(block)))
    const firstBody = pageBlocks.find((block) => (
      block.kind === 'para' && textOf(block).length > 260
    ))
    // Only cut the title block when we can see where the body starts. Without
    // an abstract or a long first paragraph, guessing a fraction of the page
    // would swallow real body text on short or unusual first pages.
    if (title && (abstract || firstBody)) {
      const lower = abstract ? top(abstract) : top(firstBody as Block)
      for (const block of pageBlocks) {
        if (block.id === title.id) continue
        if (block.kind === 'title') continue
        if (top(block) <= bottom(title) + 2) continue
        if (top(block) >= lower - 2) continue
        skip(block, 'meta')
      }
    }
    // Footnotes, contribution notes and the small print under the abstract are
    // set in a smaller size than the body; they are metadata even though they
    // sit below the abstract.
    if (abstract) {
      const abstractTop = top(abstract)
      for (const block of pageBlocks) {
        if (top(block) <= abstractTop) continue
        if ((block.size ?? 10) < 9) skip(block, 'meta')
      }
    }
  }

  // ── 3. headers, footers, page numbers, and repeated running heads ────────
  const running = new Map<string, Block[]>()
  for (const page of pages) {
    for (const block of page.blocks) {
      const text = textOf(block)
      if (text.length === 0) continue
      const atTop = top(block) < page.height * 0.055
      const atBottom = bottom(block) > page.height * 0.945
      if (!atTop && !atBottom) continue
      if (text.length > 120) continue
      if (PAGE_NUMBER.test(text) || EMAIL.test(text) || URL.test(text)) {
        skip(block, 'meta')
        continue
      }
      const key = text.toLowerCase()
      const list = running.get(key) ?? []
      list.push(block)
      running.set(key, list)
    }
  }
  for (const list of running.values()) {
    if (list.length >= 3) {
      for (const block of list) skip(block, 'meta')
    }
  }

  // ── 4. reference region: heading → rest of page → following pages ────────
  let referenceStart: { block: Block; page: number } | null = null
  // References often sit before a long appendix (a 38-page paper can put them
  // on page 10), so this is a floor against a table-of-contents heading, not a
  // "second half" rule.
  const minimumPage = pages.length <= 2
    ? 1
    : Math.max(2, Math.min(8, Math.ceil(pages.length * 0.15)))
  for (const page of pages) {
    if (page.page < minimumPage && pages.length > 2) continue
    for (const block of page.blocks) {
      if (isReferenceHeading(block)) referenceStart = { block, page: page.page }
    }
  }
  let appendixStart: { block: Block; page: number } | null = null
  if (referenceStart) {
    for (const page of pages) {
      if (page.page < referenceStart.page) continue
      for (const block of page.blocks) {
        if (page.page === referenceStart.page && top(block) <= top(referenceStart.block) + 10) continue
        if (isAppendixHeading(block)) {
          appendixStart = { block, page: page.page }
          break
        }
      }
      if (appendixStart) break
    }
  }

  if (referenceStart) {
    for (const page of pages) {
      if (page.page < referenceStart.page) continue
      if (appendixStart && page.page > appendixStart.page) continue
      for (const block of page.blocks) {
        if (appendixStart && page.page === appendixStart.page && top(block) >= top(appendixStart.block) - 2) continue
        if (page.page === referenceStart.page) {
          // On a two-column page the reference list continues at the top of the
          // opposite column, above the heading's own y. Keep those entries too.
          if (top(block) < top(referenceStart.block) - 2 && !looksLikeReference(block)) continue
        }
        skip(block, 'ref')
      }
    }
  }

  // ── 5. metadata patterns anywhere (emails, links, identifiers, licence) ──
  for (const page of pages) {
    for (const block of page.blocks) {
      const text = textOf(block)
      if (text.length === 0) continue
      if (text.length <= 240 && (EMAIL.test(text) || URL.test(text) || DOI.test(text) || ARXIV.test(text) || LICENSE.test(text))) {
        skip(block, 'meta')
      }
    }
  }

  // ── 6. already-Chinese blocks (last, so metadata/refs win) ───────────────
  for (const page of pages) {
    const plan = plans.get(page.page)
    if (!plan) continue
    for (const block of page.blocks) {
      if (plan.skipped[block.id]) continue
      if (textOf(block).length >= 10 && cjkRatio(textOf(block)) >= 0.45) {
        plan.skipped[block.id] = 'cjk'
      }
    }
  }

  const referencePages = new Set<number>()
  for (const page of pages) {
    const plan = plans.get(page.page)
    if (!plan) continue
    for (const reason of Object.values(plan.skipped)) {
      if (reason === 'ref') {
        referencePages.add(page.page)
        break
      }
    }
  }

  return { pages: plans, referencePages: [...referencePages].sort((a, b) => a - b) }
}
