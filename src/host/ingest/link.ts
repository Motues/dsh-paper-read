/** Resolve what the user pasted into metadata + PDF bytes when available. */

import type { ReferenceEntry } from '../../shared/domain.js'
import {
  LinkError,
  cleanDoi,
  normalizeLink,
  type NormalizedLink,
} from './identifiers.js'
import {
  enrichMetadata,
  type HtmlMetadata,
  type Metadata,
} from './metadata.js'

export { LinkError, normalizeLink }
export type { NormalizedLink }

const HTML_TIMEOUT_MS = 20_000
const PDF_TIMEOUT_MS = 30_000
const UA = 'Mozilla/5.0 (compatible; PaperReader/0.1; +https://arxiv.org)'

export type LinkMetadata = Metadata

export interface ResolvedLink {
  url: string
  finalUrl: string
  pdfUrl?: string
  bytes?: Uint8Array
  meta: LinkMetadata
  pdfUnavailable?: 'auth' | 'missing'
  sources: string[]
}

interface ResolveOptions {
  maxBytes?: number
}

interface PdfAttempt {
  bytes?: Uint8Array
  url?: string
  authRequired: boolean
}

export async function resolveLink(input: string, options: ResolveOptions = {}): Promise<ResolvedLink> {
  const normalized = normalizeLink(input)
  const maxBytes = options.maxBytes ?? 80 * 1024 * 1024

  if (normalized.kind === 'url') {
    return resolveUrl(normalized, maxBytes)
  }
  return resolveIdentifier(normalized, maxBytes)
}

async function resolveIdentifier(normalized: NormalizedLink, maxBytes: number): Promise<ResolvedLink> {
  const enriched = await enrichMetadata({
    doi: normalized.doi,
    arxivId: normalized.arxivId,
    pmid: normalized.pmid,
  })

  let meta = enriched.meta
  let sources = enriched.sources
  let candidates = enriched.pdfUrls

  // A DOI with no OA PDF may still expose citation_pdf_url on its landing page.
  let authSeen = false
  if (normalized.kind === 'doi' && normalized.doi && candidates.length === 0) {
    const landing = await fetchLanding(`https://doi.org/${normalized.doi}`)
    if (landing) {
      authSeen = landing.authRequired
      if (landing.html) {
        const htmlMeta = metadataFromHtml(landing.html, normalized)
        meta = mergeLinkMeta(meta, htmlMeta)
        sources = [...new Set([...sources, '页面元数据'])]
        const pagePdf = pdfUrlFrom(landing.html, landing.finalUrl)
        if (pagePdf) candidates = [pagePdf]
      }
    }
  }

  const pdf = await tryPdfCandidates(candidates, maxBytes)
  if (pdf.bytes) {
    return {
      url: normalized.url,
      finalUrl: pdf.url ?? normalized.url,
      pdfUrl: pdf.url,
      bytes: pdf.bytes,
      meta,
      sources,
    }
  }

  if (!meta.title) {
    throw new LinkError('没有找到这篇论文的元数据，请检查标识符', 'LINK_NOT_FOUND')
  }

  return {
    url: normalized.url,
    finalUrl: normalized.url,
    meta,
    pdfUnavailable: pdf.authRequired || authSeen ? 'auth' : 'missing',
    sources,
  }
}

async function resolveUrl(normalized: NormalizedLink, maxBytes: number): Promise<ResolvedLink> {
  const response = await fetchHtml(normalized.url)

  if (!response) {
    // A link that cannot be reached can still be enriched from an identifier in it.
    if (normalized.doi || normalized.arxivId || normalized.pmid) {
      return resolveIdentifier(normalized, maxBytes)
    }
    throw new LinkError('链接抓取失败', 'LINK_FETCH')
  }

  if (response.status === 401 || response.status === 403) {
    if (normalized.doi || normalized.arxivId || normalized.pmid) {
      const resolved = await resolveIdentifier(normalized, maxBytes)
      if (!resolved.bytes) resolved.pdfUnavailable = 'auth'
      return resolved
    }
    return basicAuthRecord(normalized, '链接需要登录或订阅')
  }
  if (!response.ok) {
    if (normalized.doi || normalized.arxivId || normalized.pmid) {
      const resolved = await resolveIdentifier(normalized, maxBytes)
      if (!resolved.bytes && (response.status === 401 || response.status === 403)) {
        resolved.pdfUnavailable = 'auth'
      }
      return resolved
    }
    throw new LinkError(`链接返回 ${response.status}`, 'LINK_STATUS')
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/pdf')) {
    const bytes = await readResponseBytes(response, maxBytes)
    if (!bytes) throw new LinkError(`PDF 超过 ${Math.round(maxBytes / 1024 / 1024)} MB`, 'LINK_TOO_LARGE')
    const enriched = normalized.doi || normalized.arxivId || normalized.pmid
      ? await enrichMetadata({
        doi: normalized.doi,
        arxivId: normalized.arxivId,
        pmid: normalized.pmid,
      })
      : null
    return {
      url: normalized.url,
      finalUrl: response.url || normalized.url,
      pdfUrl: response.url || normalized.url,
      bytes,
      meta: enriched?.meta ?? {
        authors: [],
        references: [],
        doi: normalized.doi,
        arxivId: normalized.arxivId,
        pmid: normalized.pmid,
      },
      sources: enriched?.sources ?? [],
    }
  }

  const html = await response.text()
  const finalUrl = response.url || normalized.url
  const htmlMeta = metadataFromHtml(html, normalized)
  const pagePdf = pdfUrlFrom(html, finalUrl)
  const enriched = await enrichMetadata({
    doi: normalized.doi ?? htmlMeta.doi,
    arxivId: normalized.arxivId ?? htmlMeta.arxivId,
    pmid: normalized.pmid ?? htmlMeta.pmid,
    htmlMeta,
    finalUrl,
  })
  const meta = mergeLinkMeta(enriched.meta, htmlMeta)
  const candidates = dedupeStrings([pagePdf ?? '', ...enriched.pdfUrls])
  const pdf = await tryPdfCandidates(candidates, maxBytes)
  if (pdf.bytes) {
    return {
      url: normalized.url,
      finalUrl: pdf.url ?? finalUrl,
      pdfUrl: pdf.url,
      bytes: pdf.bytes,
      meta,
      sources: enriched.sources,
    }
  }

  if (!meta.title) meta.title = titleFromUrl(finalUrl)
  if (!meta.title && !meta.abstract) {
    if (isAuthWall(finalUrl, html)) return basicAuthRecord(normalized, '该链接需要登录或订阅')
    throw new LinkError('页面上没有可用的论文信息', 'LINK_NO_METADATA')
  }

  return {
    url: normalized.url,
    finalUrl,
    meta,
    pdfUnavailable: pdf.authRequired || isAuthWall(finalUrl, html) ? 'auth' : 'missing',
    sources: enriched.sources,
  }
}

function basicAuthRecord(normalized: NormalizedLink, reason: string): ResolvedLink {
  const title = titleFromUrl(normalized.url)
  return {
    url: normalized.url,
    finalUrl: normalized.url,
    meta: {
      title,
      authors: [],
      references: [],
      doi: normalized.doi,
      arxivId: normalized.arxivId,
      pmid: normalized.pmid,
    },
    pdfUnavailable: 'auth',
    sources: [reason],
  }
}

function titleFromUrl(value: string): string {
  try {
    const url = new URL(value)
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
      .replace(/\.pdf$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim()
    if (last.length >= 4) return last.slice(0, 200)
    return url.hostname
  } catch {
    return '未命名论文'
  }
}

async function fetchHtml(url: string): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTML_TIMEOUT_MS)
  try {
    return await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
      signal: controller.signal,
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchLanding(url: string): Promise<{ html?: string; finalUrl: string; authRequired: boolean } | null> {
  const response = await fetchHtml(url)
  if (!response) return null
  if (response.status === 401 || response.status === 403) {
    return { finalUrl: response.url || url, authRequired: true }
  }
  if (!response.ok) return { finalUrl: response.url || url, authRequired: false }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/pdf')) return { finalUrl: response.url || url, authRequired: false }
  const html = await response.text()
  return {
    html,
    finalUrl: response.url || url,
    authRequired: isAuthWall(response.url || url, html),
  }
}

async function tryPdfCandidates(candidates: string[], maxBytes: number): Promise<PdfAttempt> {
  let authRequired = false
  for (const candidate of dedupeStrings(candidates)) {
    const result = await fetchPdf(candidate, maxBytes)
    if (result.bytes) return result
    if (result.authRequired) authRequired = true
  }
  return { authRequired }
}

async function fetchPdf(url: string, maxBytes: number): Promise<PdfAttempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'application/pdf' },
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) return { authRequired: true }
    if (!response.ok) return { authRequired: false }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/html')) {
      const html = await response.text()
      return { authRequired: isAuthWall(response.url || url, html) }
    }

    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > maxBytes) return { authRequired: false }
    const bytes = await readResponseBytes(response, maxBytes)
    if (!bytes) return { authRequired: false }
    if (!isPdf(bytes)) return { authRequired: isAuthWall(response.url || url, '') }
    return { bytes, url: response.url || url, authRequired: false }
  } catch {
    return { authRequired: false }
  } finally {
    clearTimeout(timer)
  }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length > maxBytes ? null : bytes
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

// ── HTML citation metadata ───────────────────────────────────────────────────

const META = (html: string, name: string): string | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property|itemprop)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property|itemprop)=["']${escaped}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const found = html.match(pattern)
    if (found) return decodeHtml(found[1])
  }
  return undefined
}

const META_ALL = (html: string, name: string): string[] => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property|itemprop)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      'gi',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property|itemprop)=["']${escaped}["']`,
      'gi',
    ),
  ]
  const values: string[] = []
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) values.push(decodeHtml(match[1]))
  }
  return values
}

function decodeHtml(text: string): string {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .trim()
}

export function metadataFromHtml(html: string, normalized: NormalizedLink): HtmlMetadata {
  const authors = META_ALL(html, 'citation_author')
  if (authors.length === 0) authors.push(...META_ALL(html, 'dc.creator'))
  if (authors.length === 0) {
    const joined = META(html, 'citation_authors')
    if (joined) authors.push(...joined.split(/\s*[;,]\s*/).filter(Boolean))
  }

  const date = META(html, 'citation_date')
    ?? META(html, 'citation_publication_date')
    ?? META(html, 'citation_year')
    ?? META(html, 'dc.date')
    ?? META(html, 'article:published_time')
    ?? META(html, 'og:updated_time')
  const yearMatch = String(date ?? '').match(/((?:19|20)\d{2})/)

  const identifier = META(html, 'citation_doi') ?? META(html, 'dc.identifier')
  const title = META(html, 'citation_title')
    ?? META(html, 'citation_article_title')
    ?? META(html, 'dc.title')
    ?? META(html, 'og:title')
    ?? META(html, 'twitter:title')
    ?? titleFromHtml(html)
  const abstract = META(html, 'citation_abstract')
    ?? META(html, 'dc.description')
    ?? META(html, 'description')
    ?? META(html, 'og:description')

  const references: ReferenceEntry[] = META_ALL(html, 'citation_reference').map((raw) => ({ raw }))
  const uniqueAuthors = [...new Set(authors.map((name) => name.trim()).filter(Boolean))]

  return {
    title,
    authors: uniqueAuthors.slice(0, 30),
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    venue: META(html, 'citation_journal_title')
      ?? META(html, 'citation_conference_title')
      ?? META(html, 'citation_inbook_title')
      ?? META(html, 'prism.publicationName')
      ?? META(html, 'dc.source'),
    abstract: abstract ? abstract.slice(0, 2400) : undefined,
    doi: cleanDoi(identifier ?? '') ?? cleanDoi(normalized.url) ?? normalized.doi,
    arxivId: META(html, 'citation_arxiv_id') ?? normalized.arxivId,
    pmid: META(html, 'citation_pmid') ?? normalized.pmid,
    references,
  }
}

function titleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return undefined
  const title = decodeHtml(match[1].replace(/<[^>]*>/g, ' '))
  return title.replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/, '').trim() || undefined
}

function pdfUrlFrom(html: string, baseUrl: string): string | undefined {
  const direct = META(html, 'citation_pdf_url')
    ?? META(html, 'og:pdf')
    ?? html.match(/<link[^>]+type=["']application\/pdf["'][^>]+href=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+\.pdf[^"']*)["'][^>]*>/i)?.[1]
  if (direct) {
    try {
      return new URL(direct, baseUrl).toString()
    } catch {
      return direct
    }
  }
  const arxiv = META(html, 'citation_arxiv_id')
    ?? baseUrl.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+?)(?:\.pdf)?(?:[?#]|$)/)?.[1]
  if (arxiv) return `https://arxiv.org/pdf/${arxiv.replace(/v\d+$/i, '')}`
  return undefined
}

function mergeLinkMeta(primary: Metadata, secondary: HtmlMetadata): Metadata {
  return {
    title: primary.title || secondary.title,
    authors: primary.authors.length > 0 ? primary.authors : secondary.authors ?? [],
    year: primary.year ?? secondary.year,
    venue: primary.venue || secondary.venue,
    abstract: primary.abstract || secondary.abstract,
    doi: primary.doi || secondary.doi,
    arxivId: primary.arxivId || secondary.arxivId,
    pmid: primary.pmid || secondary.pmid,
    references: primary.references.length > 0 ? primary.references : secondary.references ?? [],
  }
}

function isAuthWall(url: string, html: string): boolean {
  const target = `${url} ${html.slice(0, 120_000)}`
  if (/(?:\/(?:login|signin|sign-in|auth|sso|shibboleth|access|subscribe|purchase)(?:\/|\?|$))/i.test(url)) {
    return true
  }
  return /(?:login required|institutional access|access denied|access through your institution|purchase this article|subscribe to (?:read|access)|buy article|paywall|authentication required|captcha|sign in to (?:continue|download|read|access)|log in to (?:continue|download|read|access)|需要登录|请登录|登录后(?:继续|下载|阅读)|订阅后|订阅以|需订阅|购买本文|购买全文|机构访问)/i
    .test(target)
}
