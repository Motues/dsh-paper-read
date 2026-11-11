/** Best-effort metadata from the extracted pages, before any model sees them. */

import type { Block, PageText } from '../../shared/domain.js'

const DOI = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i
const ARXIV = /arxiv[:\s]*([0-9]{4}\.[0-9]{4,5})(v\d+)?/i
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i
const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/

const VENUE = /(journal|transactions|proceedings|conference|letters|nature|science|reviews|symposium|workshop)/i

export interface MetadataHints {
  name?: string
  fallbackTitle?: string
  year?: number
}

export interface DerivedMetadata {
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  doi?: string
  arxivId?: string
}

export interface MergeableMetadata {
  title: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  doi?: string
  arxivId?: string
}

function bodySize(blocks: Block[]): number {
  const weighted = blocks
    .filter((block) => block.text.length > 60)
    .map((block) => block.size ?? 0)
    .sort((a, b) => a - b)
  if (weighted.length === 0) return 10
  return weighted[Math.floor(weighted.length / 2)]
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9\u3400-\u9fff]+/, '')
    .trim()
}

function plausibleAuthor(text: string): boolean {
  const value = text.trim()
  if (value.length < 2 || value.length > 160) return false
  if (/@|universit|institute|laborator|department|school|abstract|keywords|received|accepted/i.test(value)) return false
  return /[A-Za-z\u3400-\u9fff]/.test(value)
}

const NAME = /^[\p{Lu}\u3400-\u9fff][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){0,3}$/u

/** Heuristic: is this line a list of people rather than a sentence? */
function looksLikeNames(text: string): boolean {
  const tokens = text.replace(/[\d*†‡§¶]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return false
  const capitalized = tokens.filter((token) => /^\p{Lu}/u.test(token) || /^[\u3400-\u9fff]/.test(token)).length
  return capitalized / tokens.length >= 0.7
}

export function authorsFromBlock(text: string): string[] {
  const cleaned = text.replace(/^(authors?|by)\s*[:：]?\s*/i, '').trim()
  if (!looksLikeNames(cleaned)) return []
  let names: string[]
  if (/[,;·]|\band\b/i.test(cleaned)) {
    names = cleaned.split(/\s*(?:,|;|·|\band\b)\s*/i)
  } else if (/\s{2,}/.test(cleaned)) {
    names = cleaned.split(/\s{2,}/)
  } else {
    const tokens = cleaned.split(/\s+/)
    names = tokens.length >= 4 && tokens.length % 2 === 0
      ? tokens.reduce<string[]>((out, token, index) => {
        if (index % 2 === 0) out.push(token)
        else out[out.length - 1] += ` ${token}`
        return out
      }, [])
      : [cleaned]
  }
  return names
    .map((name) => name.replace(/[\d*†‡§¶]/g, '').replace(/\s+/g, ' ').trim())
    .filter((name) => NAME.test(name) && name.length >= 2 && name.length <= 48)
    .slice(0, 10)
}

export function deriveMetadata(pages: PageText[], hints: MetadataHints = {}): DerivedMetadata {
  const first = pages[0]
  const sourceBlocks = first?.blocks ?? []
  const blocks = [...sourceBlocks].sort((a, b) => a.bbox[1] - b.bbox[1])
  const size = bodySize(sourceBlocks)
  const pageHeight = first?.height || 800

  const candidates = blocks.filter(
    (block) => block.bbox[1] < pageHeight * 0.5 && (block.size ?? 0) >= size * 1.12 && block.text.length >= 4,
  )
  let title = ''
  if (candidates.length > 0) {
    const tallest = Math.max(...candidates.map((block) => block.size ?? 0))
    const group = candidates.filter((block) => (block.size ?? 0) >= tallest * 0.92)
    const top = group[0]
    const joined = group
      .filter((block) => block.bbox[1] - (top.bbox[1] + top.bbox[3]) < pageHeight * 0.2)
      .map((block) => block.text)
      .join(' ')
    title = cleanTitle(joined || top.text)
  }
  if (title.length < 6 || /^(contents|abstract|keywords)/i.test(title)) title = ''

  let authors: string[] = []
  if (title) {
    const titleBlock = candidates.find((block) => title.includes(block.text.slice(0, 12)))
    const titleBottom = titleBlock ? titleBlock.bbox[1] + titleBlock.bbox[3] : 0
    const authorBlocks = blocks.filter((block) => {
      const top = block.bbox[1]
      return top >= titleBottom - 2 && top < titleBottom + pageHeight * 0.16 && plausibleAuthor(block.text)
        && (block.size ?? 0) <= size * 1.35 && block.text.length < 200
    })
    for (const block of authorBlocks) {
      const found = authorsFromBlock(block.text)
      if (found.length > 0) {
        authors = found
        break
      }
    }
  }

  const head = pages.slice(0, 2).map((page) => page.blocks.map((block) => block.text).join('\n')).join('\n')
  // Years inside the abstract are usually citations; prefer the header or the
  // footer ("Journal, 2026; 20:e71234").
  const footer = blocks
    .filter((block) => block.bbox[1] > pageHeight * 0.9)
    .map((block) => block.text)
    .join(' ')
  const headBand = blocks
    .filter((block) => block.bbox[1] < pageHeight * 0.3)
    .map((block) => block.text)
    .join(' ')

  const abstractBlock = blocks.findIndex((block) => /^(abstract|摘要)\b/i.test(block.text.trim()))
  let abstract = ''
  if (abstractBlock >= 0) {
    const found = blocks[abstractBlock]
    let body = found.text.replace(/^(abstract|摘要)[\s:：-]*/i, '').trim()
    for (let index = abstractBlock + 1; index < Math.min(blocks.length, abstractBlock + 5); index += 1) {
      const next = blocks[index]
      if (/^(introduction\b|\d+\.?\s*(introduction|keywords)\b|keywords|index terms|关键词)/i.test(next.text.trim())) break
      if ((next.size ?? 0) > size * 1.2) break
      body += ` ${next.text}`
      if (body.length > 900) break
    }
    abstract = body.replace(/\s+/g, ' ').trim().slice(0, 1200)
  }

  const yearMatch = footer.match(YEAR) ?? headBand.match(YEAR) ?? head.match(YEAR)
  const doiMatch = head.match(DOI)
  const arxivMatch = head.match(ARXIV) ?? hints.name?.match(ARXIV_URL) ?? head.match(ARXIV_URL)
  const venueLine = blocks.find(
    (block) => block.bbox[1] < pageHeight * 0.3 && block.text.length < 120 && VENUE.test(block.text)
      && !/arxiv/i.test(block.text) && block.text !== title,
  )

  return {
    title: title || hints.fallbackTitle || '未命名论文',
    authors,
    year: yearMatch ? Number(yearMatch[1]) : hints.year,
    venue: venueLine ? cleanTitle(venueLine.text).slice(0, 90) : undefined,
    abstract: abstract || undefined,
    doi: doiMatch ? doiMatch[0].replace(/[.,;]$/, '') : undefined,
    arxivId: arxivMatch ? arxivMatch[1] : undefined,
  }
}

/** Refine the model's metadata guess with what the PDF actually says. */
export function mergeMetadata<T extends MergeableMetadata>(
  base: T,
  refined: Partial<MergeableMetadata> = {},
): T {
  const merged = { ...base }
  const authors = Array.isArray(refined.authors) ? refined.authors : []
  if (refined.title && (!base.title || base.title === '未命名论文')) {
    merged.title = refined.title.slice(0, 240)
  }
  if (authors.length > 0 && base.authors.length === 0) {
    merged.authors = authors.map((name) => String(name).slice(0, 60)).slice(0, 12)
  }
  if (refined.year && !base.year) merged.year = Number(refined.year) || undefined
  if (refined.venue && !base.venue) merged.venue = refined.venue.slice(0, 90)
  if (refined.abstract && (!base.abstract || base.abstract.length < 80)) {
    merged.abstract = refined.abstract.slice(0, 1200)
  }
  return merged
}
