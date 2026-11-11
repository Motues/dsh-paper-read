/**
 * References straight out of the PDF.
 *
 * Provider metadata is better when it exists, but arXiv preprints routinely
 * arrive with no provider-side reference list (OpenAlex reports zero references
 * for many of them), which leaves the citation layer empty and the paper
 * isolated. The PDF always carries the list, so we harvest it locally.
 *
 * Only explicit identifiers are harvested — arXiv ids and DOIs. A title
 * heuristic would produce plausible-looking noise; an id either matches a paper
 * in the library or it does not, so a match stays evidence rather than a guess.
 */

import type { PageText, ReferenceEntry } from '../../shared/domain.js'

export interface HarvestedReference extends ReferenceEntry {
  /** Read by `parseReference`; the shared `ReferenceEntry` predates arXiv ids. */
  arxivId?: string
}

const HEADING = /^[ \t]*(references|bibliography|参考文献|參考文獻)[ \t]*$/gim
const ARXIV = /arxiv\s*[:.]?\s*([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/gi
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/gi
const DOI = /10\.\d{4,9}\/[^\s,;)\]}"'<>]+/g
const MARKER = /\[[\dA-Za-z]{1,8}\]\s/g
const MAX_ENTRIES = 160

/**
 * The text after the last "References" heading. The last one wins because a
 * table of contents earlier in the paper also says "References".
 */
function referenceRegion(text: string): string {
  let start = -1
  for (const match of text.matchAll(HEADING)) {
    if (match.index === undefined) continue
    if (text.length - match.index < 120) continue
    start = match.index
  }
  return start >= 0 ? text.slice(start, start + 120_000) : ''
}

/** The reference entry that contains `index`, trimmed to a readable snippet. */
function excerpt(region: string, index: number): string {
  const floor = Math.max(0, index - 600)
  const before = region.slice(floor, index)
  let start = floor
  for (const match of before.matchAll(MARKER)) {
    if (match.index === undefined) continue
    start = floor + match.index
  }
  if (start === floor) {
    const blank = before.lastIndexOf('\n\n')
    if (blank >= 0) start = floor + blank + 2
  }
  const after = region.slice(index, index + 400)
  const stop = after.search(MARKER)
  const end = stop > 0 ? index + stop : index + 240
  return region.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function harvestReferences(pages: PageText[]): HarvestedReference[] {
  if (pages.length === 0) return []
  const text = pages.map((page) => page.blocks.map((block) => block.text).join('\n')).join('\n')
  const region = referenceRegion(text)
  if (region.length < 80) return []

  const entries: HarvestedReference[] = []
  const seen = new Set<string>()
  const add = (index: number, kind: 'arxiv' | 'doi', value: string): void => {
    const id = kind === 'arxiv' ? value : value.replace(/[.,;]+$/, '').toLowerCase()
    if (!id) return
    const key = `${kind}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    const raw = excerpt(region, index)
    entries.push(kind === 'arxiv'
      ? { arxivId: id, url: `https://arxiv.org/abs/${id}`, raw }
      : { doi: id, url: `https://doi.org/${id}`, raw })
  }

  for (const match of region.matchAll(ARXIV)) {
    if (match.index !== undefined && match[1]) add(match.index, 'arxiv', match[1])
  }
  for (const match of region.matchAll(ARXIV_URL)) {
    if (match.index !== undefined && match[1]) add(match.index, 'arxiv', match[1])
  }
  for (const match of region.matchAll(DOI)) {
    if (match.index === undefined) continue
    const doi = match[0].replace(/[.,;]+$/, '')
    // arXiv's own DOI carries the same paper as the arXiv id above.
    const arxiv = doi.match(/^10\.48550\/arxiv\.(.+)$/i)
    if (arxiv) add(match.index, 'arxiv', arxiv[1])
    else add(match.index, 'doi', doi)
  }

  return entries.slice(0, MAX_ENTRIES)
}
