/** Normalize what the user typed into a DOI / arXiv ID / PMID / URL. */

export class LinkError extends Error {
  code: string

  constructor(message: string, code = 'LINK_FAILED') {
    super(message)
    this.name = 'LinkError'
    this.code = code
  }
}

export type IdentifierKind = 'doi' | 'arxiv' | 'pmid' | 'url'

export interface NormalizedLink {
  url: string
  kind: IdentifierKind
  doi?: string
  arxivId?: string
  pmid?: string
}

const DOI_IN_TEXT = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i
const ARXIV_NEW = /^(\d{4}\.\d{4,5})(v\d+)?$/i
const ARXIV_OLD = /^([a-z][a-z-]*(?:\.[a-z]{2})?\/\d{7})(v\d+)?$/i
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?(?:[?#]|$)/i
const PMID_PREFIX = /^pmid[\s:：]*(\d{1,9})$/i
const PMID_URL = /(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{1,9})/i
const BARE_PMID = /^(\d{5,9})$/i

export function cleanDoi(value: string): string | undefined {
  const text = String(value ?? '').trim()
    .replace(/^(?:doi[\s:：]*)/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    /* keep the raw value */
  }
  const match = decoded.match(DOI_IN_TEXT)
  if (!match) return undefined
  return match[0].replace(/[.,;]+$/, '')
}

function cleanArxiv(raw: string): string | undefined {
  const text = raw.trim().replace(/^arxiv[\s:：]*/i, '')
  const urlMatch = text.match(ARXIV_URL)
  const value = urlMatch?.[1] ?? text
  const withoutVersion = value.replace(/v\d+$/i, '')
  const modern = withoutVersion.match(ARXIV_NEW)
  if (modern) return modern[1]
  const legacy = withoutVersion.match(ARXIV_OLD)
  if (legacy) return legacy[1]
  return undefined
}

function looksLikeArxiv(raw: string): boolean {
  const text = raw.trim().replace(/^arxiv[\s:：]*/i, '')
  return ARXIV_NEW.test(text) || ARXIV_OLD.test(text) || /arxiv\.org\/(?:abs|pdf)\//i.test(text)
}

/**
 * Accepts the formats researchers actually paste:
 * `10.1038/nature14539`, `doi:...`, `https://doi.org/...`, `arXiv:1706.03762`,
 * `hep-th/9901001`, `PMID: 26017442`, PubMed URLs, and ordinary links.
 */
export function normalizeLink(input: unknown): NormalizedLink {
  const raw = String(input ?? '').trim()
  if (raw === '') throw new LinkError('链接为空', 'LINK_EMPTY')

  // A DOI URL or a publisher URL that contains a DOI.
  const doi = cleanDoi(raw)
  if (doi && (/^doi[\s:：]/i.test(raw) || /^(?:https?:\/\/(?:dx\.)?doi\.org\/)/i.test(raw) || raw === doi)) {
    return { url: `https://doi.org/${doi}`, kind: 'doi', doi }
  }

  const arxivId = looksLikeArxiv(raw) ? cleanArxiv(raw) : undefined
  if (arxivId) {
    return { url: `https://arxiv.org/abs/${arxivId}`, kind: 'arxiv', arxivId }
  }

  const pmidMatch = raw.match(PMID_PREFIX) ?? raw.match(PMID_URL) ?? raw.match(BARE_PMID)
  if (pmidMatch) {
    const pmid = pmidMatch[1]
    return { url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, kind: 'pmid', pmid }
  }

  if (!/^https?:\/\//i.test(raw)) {
    if (doi) return { url: `https://doi.org/${doi}`, kind: 'doi', doi }
    throw new LinkError('只支持 http(s) 链接、DOI、arXiv 编号或 PMID')
  }

  const parsed = new URL(raw)
  return {
    url: parsed.toString(),
    kind: 'url',
    // Keep the URL as the source, but retain identifiers for enrichment.
    doi: doi || undefined,
    arxivId: parsed.hostname.endsWith('arxiv.org') ? cleanArxiv(raw) : undefined,
    pmid: parsed.hostname.endsWith('pubmed.ncbi.nlm.nih.gov')
      ? raw.match(PMID_URL)?.[1] ?? undefined
      : undefined,
  }
}
