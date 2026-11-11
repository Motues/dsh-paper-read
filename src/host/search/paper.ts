/**
 * In-paper full-text search over the parsed page blocks.
 *
 * Cross-library retrieval runs BM25 over chunks; a reader's find box wants
 * exact substring hits in reading order instead. This scans `pages.json`
 * directly and keeps every hit's block bbox so the page can flash the matched
 * paragraph. Pure and synchronous: the route owns the store read.
 */

import type { PageText, PaperSearchHit } from '../../shared/domain.js'

/** Context kept on each side of the match inside the snippet. */
const QUOTE_PAD = 56

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function searchPaperText(
  pages: PageText[],
  query: string,
  limit = 50,
): { hits: PaperSearchHit[]; total: number } {
  const needle = normalize(query).toLowerCase()
  if (!needle) return { hits: [], total: 0 }

  const hits: PaperSearchHit[] = []
  let total = 0
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    for (const block of page.blocks ?? []) {
      const text = normalize(block.text)
      if (!text) continue
      const lower = text.toLowerCase()
      let from = 0
      for (;;) {
        const index = lower.indexOf(needle, from)
        if (index < 0) break
        total += 1
        if (hits.length < limit) {
          const start = Math.max(0, index - QUOTE_PAD)
          const end = Math.min(text.length, index + needle.length + QUOTE_PAD)
          const prefix = start > 0 ? '…' : ''
          const suffix = end < text.length ? '…' : ''
          hits.push({
            page: page.page,
            blockId: block.id,
            bbox: block.bbox,
            quote: `${prefix}${text.slice(start, end)}${suffix}`,
            quoteStart: prefix.length + (index - start),
            quoteLength: needle.length,
          })
        }
        from = index + Math.max(1, needle.length)
      }
    }
  }
  return { hits, total }
}
