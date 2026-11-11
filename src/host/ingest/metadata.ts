/**
 * Bibliographic metadata lookup.
 *
 * Free, key-less providers only: Crossref (publisher DOIs), OpenAlex
 * (cross-provider graph + OA PDFs), Europe PMC (PMID metadata and references),
 * arXiv (Atom API), DataCite (arXiv DOIs and other DataCite DOIs).
 * Every call is best-effort: a missing provider never fails the import.
 */

import type { ReferenceEntry } from '../../shared/domain.js'
import { cleanDoi } from './identifiers.js'

const TIMEOUT_MS = 12_000
const UA = 'PaperReader/0.1 (paper metadata; +https://arxiv.org)'

export interface Metadata {
  title?: string
  authors: string[]
  year?: number
  venue?: string
  abstract?: string
  doi?: string
  arxivId?: string
  pmid?: string
  references: ReferenceEntry[]
}

export interface HtmlMetadata {
  title?: string
  authors?: string[]
  year?: number
  venue?: string
  abstract?: string
  doi?: string
  arxivId?: string
  pmid?: string
  references?: ReferenceEntry[]
}

export interface EnrichInput {
  doi?: string
  arxivId?: string
  pmid?: string
  htmlMeta?: HtmlMetadata
  finalUrl?: string
}

export interface MetadataResult {
  meta: Metadata
  pdfUrls: string[]
  sources: string[]
}

export async function enrichMetadata(input: EnrichInput = {}): Promise<MetadataResult> {
  const html = input.htmlMeta
  const base: Metadata = {
    title: html?.title,
    authors: html?.authors ?? [],
    year: html?.year,
    venue: html?.venue,
    abstract: html?.abstract,
    doi: html?.doi,
    arxivId: html?.arxivId,
    pmid: html?.pmid,
    references: html?.references ?? [],
  }

  const doi = cleanDoi(input.doi ?? html?.doi ?? '') ?? undefined
  const arxivId = input.arxivId ?? html?.arxivId ?? (doi ? arxivFromDoi(doi) : undefined)
  const pmid = input.pmid ?? html?.pmid

  let primary: MetadataResult | null = null
  let secondary: MetadataResult | null = null

  if (arxivId) {
    const [arxiv, openalex] = await Promise.all([
      fromArxiv(arxivId),
      fromOpenAlex({ arxivId }),
    ])
    primary = arxiv
    secondary = openalex
    if (!primary && doi) primary = await fromDataCite(doi)
  } else if (pmid) {
    const [europePmc, openalex] = await Promise.all([
      fromEuropePmc({ pmid, doi }),
      fromOpenAlex({ pmid }),
    ])
    primary = europePmc
    secondary = openalex
    if (!primary && doi) primary = await fromCrossref(doi)
  } else if (doi) {
    const [crossref, openalex] = await Promise.all([
      fromCrossref(doi),
      fromOpenAlex({ doi }),
    ])
    primary = crossref ?? openalex
    secondary = crossref ? openalex : null
    if (!primary) primary = await fromDataCite(doi)
    // Crossref/OpenAlex often omit abstracts; Europe PMC indexes many DOI
    // records and also carries a reference list.
    if (!primary || !primary.meta.abstract || primary.meta.references.length === 0) {
      const europePmc = await fromEuropePmc({ doi })
      if (europePmc) {
        secondary = secondary
          ? {
            meta: mergePreferred(secondary.meta, europePmc.meta),
            pdfUrls: dedupeStrings([...secondary.pdfUrls, ...europePmc.pdfUrls]),
            sources: [...new Set([...secondary.sources, ...europePmc.sources])],
          }
          : europePmc
      }
    }
  }

  let meta = base
  if (primary) meta = mergePreferred(primary.meta, meta)
  if (secondary) meta = mergePreferred(meta, secondary.meta)
  meta.doi = meta.doi ?? doi
  meta.arxivId = meta.arxivId ?? arxivId
  meta.pmid = meta.pmid ?? pmid
  meta.references = dedupeReferences(meta.references)

  const pdfUrls = dedupeStrings([
    ...(arxivId ? [`https://arxiv.org/pdf/${arxivId}`] : []),
    ...(primary?.pdfUrls ?? []),
    ...(secondary?.pdfUrls ?? []),
  ])

  return {
    meta,
    pdfUrls,
    sources: [...new Set([...(primary?.sources ?? []), ...(secondary?.sources ?? [])])],
  }
}

/** Fill `primary` with whatever `fallback` has, without overriding useful values. */
function mergePreferred(primary: Metadata, fallback: Metadata): Metadata {
  return {
    title: primary.title || fallback.title,
    authors: primary.authors.length > 0 ? primary.authors : fallback.authors,
    year: primary.year ?? fallback.year,
    venue: primary.venue || fallback.venue,
    abstract: primary.abstract || fallback.abstract,
    doi: primary.doi || fallback.doi,
    arxivId: primary.arxivId || fallback.arxivId,
    pmid: primary.pmid || fallback.pmid,
    references: primary.references.length > 0 ? primary.references : fallback.references,
  }
}

function arxivFromDoi(doi: string): string | undefined {
  const match = doi.match(/^10\.48550\/arxiv\.(.+)$/i)
  return match ? match[1].replace(/v\d+$/i, '') : undefined
}

async function request(url: string, accept: string): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept },
      signal: controller.signal,
    })
    return response.ok ? response : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function getJson(url: string): Promise<unknown> {
  const response = await request(url, 'application/json')
  if (!response) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function getText(url: string): Promise<string | null> {
  const response = await request(url, 'application/atom+xml, application/xml, text/xml')
  if (!response) return null
  try {
    return await response.text()
  } catch {
    return null
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}

function dateYear(value: unknown): number | undefined {
  const parts = (value as { 'date-parts'?: unknown } | undefined)?.['date-parts']
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined
  return validYear(parts[0][0])
}

function validYear(value: unknown): number | undefined {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : undefined
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeEntities(text: string): string {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim()
}

function splitAuthors(value: unknown): string[] {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return []
  return text
    .split(/\s*[,;]\s*/)
    .map((name) => cleanText(name))
    .filter((name) => name.length > 0)
    .slice(0, 30)
}

function cleanText(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
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

function dedupeReferences(values: ReferenceEntry[]): ReferenceEntry[] {
  const seen = new Set<string>()
  const out: ReferenceEntry[] = []
  for (const value of values) {
    const title = cleanText(value.title ?? '')
    const raw = cleanText(value.raw ?? '')
    const doi = cleanDoi(value.doi ?? '')
    if (!title && !raw && !doi) continue
    const key = (doi || title || raw).toLowerCase().slice(0, 220)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      title: title ? title.slice(0, 300) : undefined,
      authors: value.authors?.map((name) => cleanText(name)).filter(Boolean).slice(0, 12),
      year: value.year,
      venue: value.venue ? cleanText(value.venue).slice(0, 120) : undefined,
      doi,
      pmid: value.pmid ? String(value.pmid).replace(/\D/g, '') || undefined : undefined,
      url: value.url,
      raw: raw ? raw.slice(0, 600) : undefined,
    })
    if (out.length >= 200) break
  }
  return out
}

// ── Crossref ─────────────────────────────────────────────────────────────────

async function fromCrossref(doi: string): Promise<MetadataResult | null> {
  const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`) as {
    message?: Record<string, any>
  } | null
  const message = data?.message
  if (!message) return null

  const authors = Array.isArray(message.author)
    ? message.author
      .map((author: Record<string, unknown>) => {
        if (typeof author.name === 'string') return cleanText(author.name)
        return cleanText([author.given, author.family].filter((part) => typeof part === 'string').join(' '))
      })
      .filter(Boolean)
      .slice(0, 30)
    : []

  const references = Array.isArray(message.reference)
    ? message.reference.map(crossrefReference)
    : []

  const pdfUrls: string[] = []
  for (const link of Array.isArray(message.link) ? message.link : []) {
    const url = typeof link?.URL === 'string' ? link.URL : ''
    if (url && (/pdf/i.test(String(link?.['content-type'] ?? '')) || /\.pdf(?:$|\?)/i.test(url))) {
      pdfUrls.push(url)
    }
  }

  return {
    meta: {
      title: firstString(message.title),
      authors,
      year: dateYear(message.issued)
        ?? dateYear(message['published-print'])
        ?? dateYear(message['published-online'])
        ?? dateYear(message.created),
      venue: firstString(message['container-title'])
        ?? firstString(message.event?.name)
        ?? firstString(message.publisher),
      abstract: typeof message.abstract === 'string' ? stripMarkup(message.abstract) : undefined,
      doi,
      references: dedupeReferences(references),
    },
    pdfUrls: dedupeStrings(pdfUrls),
    sources: ['Crossref'],
  }
}

function crossrefReference(reference: Record<string, unknown>): ReferenceEntry {
  const title = firstString(reference['article-title']) ?? firstString(reference['volume-title'])
  const doi = cleanDoi(String(reference.DOI ?? ''))
  return {
    title,
    authors: typeof reference.author === 'string' ? splitAuthors(reference.author) : undefined,
    year: validYear(reference.year),
    venue: firstString(reference['journal-title']),
    doi,
    url: doi ? `https://doi.org/${doi}` : undefined,
    raw: typeof reference.unstructured === 'string' ? reference.unstructured : undefined,
  }
}

// ── DataCite (arXiv DOIs and other dataset DOIs) ────────────────────────────

async function fromDataCite(doi: string): Promise<MetadataResult | null> {
  const data = await getJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`) as {
    data?: { attributes?: Record<string, any> }
  } | null
  const attributes = data?.data?.attributes
  if (!attributes) return null
  const authors = Array.isArray(attributes.creators)
    ? attributes.creators
      .map((creator: Record<string, unknown>) => cleanText(String(creator.name ?? '')))
      .filter(Boolean)
      .slice(0, 30)
    : []
  const descriptions = Array.isArray(attributes.descriptions) ? attributes.descriptions : []
  const abstract = descriptions.find(
    (item: Record<string, unknown>) => String(item.descriptionType ?? '').toLowerCase() === 'abstract',
  )?.description
  return {
    meta: {
      title: firstString(attributes.titles?.map?.((item: Record<string, unknown>) => item.title))
        ?? firstString(attributes.titles),
      authors,
      year: validYear(attributes.publicationYear),
      venue: firstString(attributes.publisher),
      abstract: typeof abstract === 'string' ? stripMarkup(abstract) : undefined,
      doi,
      references: [],
    },
    pdfUrls: [],
    sources: ['DataCite'],
  }
}

// ── OpenAlex ─────────────────────────────────────────────────────────────────

async function fromOpenAlex(options: { doi?: string; arxivId?: string; pmid?: string }): Promise<MetadataResult | null> {
  const filter = options.pmid
    ? `pmid:${options.pmid}`
    : options.doi
      ? `doi:${options.doi}`
      : options.arxivId
        ? `doi:10.48550/arXiv.${options.arxivId}`
        : ''
  if (!filter) return null

  const fields = [
    'id', 'doi', 'display_name', 'publication_year', 'authorships', 'primary_location',
    'best_oa_location', 'open_access', 'referenced_works', 'abstract_inverted_index', 'ids',
  ].join(',')
  const data = await getJson(
    `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&select=${fields}&per-page=1`,
  ) as { results?: Array<Record<string, any>> } | null
  const work = data?.results?.[0]
  if (!work) return null

  const authors = Array.isArray(work.authorships)
    ? work.authorships
      .map((authorship: Record<string, any>) => cleanText(String(authorship.author?.display_name ?? '')))
      .filter(Boolean)
      .slice(0, 30)
    : []

  const pdfUrls = dedupeStrings([
    work.best_oa_location?.pdf_url,
    work.primary_location?.pdf_url,
    typeof work.open_access?.oa_url === 'string'
      && /(?:\.pdf(?:$|\?)|\/pdf(?:$|[/?]))/i.test(work.open_access.oa_url)
      ? work.open_access.oa_url
      : '',
  ].filter((url): url is string => typeof url === 'string' && url.length > 0))

  return {
    meta: {
      title: cleanText(String(work.display_name ?? '')) || undefined,
      authors,
      year: validYear(work.publication_year),
      venue: firstString(work.primary_location?.source?.display_name),
      abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
      doi: cleanDoi(String(work.doi ?? '')) ?? options.doi,
      pmid: String(work.ids?.pmid ?? options.pmid ?? '').replace(/\D/g, '') || undefined,
      references: await openAlexReferences(work.referenced_works),
    },
    pdfUrls,
    sources: ['OpenAlex'],
  }
}

function abstractFromInvertedIndex(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const positions: string[] = []
  for (const [word, indexes] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(indexes)) continue
    for (const index of indexes) {
      if (typeof index === 'number' && index >= 0) positions[index] = word
    }
  }
  const text = positions.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 2400) : undefined
}

async function openAlexReferences(value: unknown): Promise<ReferenceEntry[]> {
  if (!Array.isArray(value)) return []
  const ids = value
    .map((id) => String(id).match(/(W\d+)$/)?.[1])
    .filter((id): id is string => Boolean(id))
    .slice(0, 100)
  if (ids.length === 0) return []

  const references: ReferenceEntry[] = []
  for (let index = 0; index < ids.length && references.length < 100; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const data = await getJson(
      `https://api.openalex.org/works?filter=${encodeURIComponent(`openalex_id:${chunk.join('|')}`)}`
      + '&select=id,doi,display_name,publication_year,authorships,primary_location&per-page=50',
    ) as { results?: Array<Record<string, any>> } | null
    if (!data?.results) break
    const byId = new Map(data.results.map((work) => [String(work.id), work]))
    for (const id of chunk) {
      const work = byId.get(`https://openalex.org/${id}`) ?? byId.get(id)
      if (!work) continue
      references.push({
        title: cleanText(String(work.display_name ?? '')) || undefined,
        authors: Array.isArray(work.authorships)
          ? work.authorships
            .map((authorship: Record<string, any>) => cleanText(String(authorship.author?.display_name ?? '')))
            .filter(Boolean)
            .slice(0, 12)
          : undefined,
        year: validYear(work.publication_year),
        venue: firstString(work.primary_location?.source?.display_name),
        doi: cleanDoi(String(work.doi ?? '')) ?? undefined,
        url: typeof work.id === 'string' ? work.id : undefined,
      })
    }
  }
  return references
}

// ── Europe PMC (PMID) ────────────────────────────────────────────────────────

async function fromEuropePmc(options: { pmid?: string; doi?: string }): Promise<MetadataResult | null> {
  const query = options.pmid
    ? `EXT_ID:${options.pmid} AND SRC:MED`
    : options.doi
      ? `DOI:"${options.doi}"`
      : ''
  if (!query) return null
  const data = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}`
    + '&format=json&resultType=core&pageSize=1',
  ) as { resultList?: { result?: Array<Record<string, any>> } } | null
  const record = data?.resultList?.result?.[0]
  if (!record) return null

  const pmid = String(record.pmid ?? options.pmid ?? '').replace(/\D/g, '') || undefined
  const listedAuthors = Array.isArray(record.authorList?.author)
    ? record.authorList.author
      .map((author: Record<string, unknown>) => cleanText(String(author.fullName ?? author.lastName ?? '')))
      .filter(Boolean)
      .slice(0, 30)
    : []
  const authors = listedAuthors.length > 0 ? listedAuthors : splitAuthors(record.authorString)

  return {
    meta: {
      title: cleanText(String(record.title ?? '')) || undefined,
      authors,
      year: validYear(record.pubYear),
      venue: firstString(record.journalInfo?.journal?.title) ?? firstString(record.journalTitle),
      abstract: typeof record.abstractText === 'string' ? stripMarkup(record.abstractText) : undefined,
      doi: cleanDoi(String(record.doi ?? options.doi ?? '')) ?? undefined,
      pmid,
      references: pmid ? await europePmcReferences(pmid) : [],
    },
    pdfUrls: europePmcPdfUrls(record),
    sources: ['Europe PMC'],
  }
}

function europePmcPdfUrls(record: Record<string, any>): string[] {
  const entries = record.fullTextUrlList?.fullTextUrl
  const list = Array.isArray(entries) ? entries : entries ? [entries] : []
  return dedupeStrings(list
    .filter((entry: Record<string, unknown>) => {
      const style = String(entry.documentStyle ?? '').toLowerCase()
      const url = String(entry.url ?? '')
      return style === 'pdf' || /\.pdf(?:$|\?)/i.test(url)
    })
    .map((entry: Record<string, unknown>) => String(entry.url ?? '')))
}

async function europePmcReferences(pmid: string): Promise<ReferenceEntry[]> {
  const data = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/MED/${encodeURIComponent(pmid)}`
    + '/references?format=json&pageSize=1000',
  ) as { referenceList?: { reference?: Array<Record<string, any>> } } | null
  const list = data?.referenceList?.reference
  if (!Array.isArray(list)) return []
  return list.map((reference) => {
    const doi = cleanDoi(String(reference.doi ?? '')) ?? undefined
    const refPmid = String(reference.source ?? '').toUpperCase() === 'MED'
      ? String(reference.id ?? '').replace(/\D/g, '') || undefined
      : undefined
    return {
      title: cleanText(String(reference.title ?? '')) || undefined,
      authors: splitAuthors(reference.authorString),
      year: validYear(reference.pubYear),
      venue: firstString(reference.journalAbbreviation),
      doi,
      pmid: refPmid,
      url: doi ? `https://doi.org/${doi}` : refPmid ? `https://pubmed.ncbi.nlm.nih.gov/${refPmid}/` : undefined,
    }
  })
}

// ── arXiv ────────────────────────────────────────────────────────────────────

async function fromArxiv(arxivId: string): Promise<MetadataResult | null> {
  const xml = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`)
  if (!xml) return null
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1]
  if (!entry) return null

  const title = xmlTag(entry, 'title')
  if (!title) return null
  const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
    .map((match) => cleanText(decodeEntities(match[1])))
    .filter(Boolean)
    .slice(0, 30)
  const published = xmlTag(entry, 'published')
  const doi = cleanDoi(xmlTag(entry, 'arxiv:doi') ?? '') ?? undefined
  const journalRef = xmlTag(entry, 'arxiv:journal_ref')
  const comment = xmlTag(entry, 'arxiv:comment')

  return {
    meta: {
      title,
      authors,
      year: published ? validYear(published.slice(0, 4)) : undefined,
      venue: journalRef ?? (comment && /journal|conference|proceedings/i.test(comment) ? comment : undefined),
      abstract: xmlTag(entry, 'summary'),
      doi,
      arxivId,
      references: [],
    },
    pdfUrls: [`https://arxiv.org/pdf/${arxivId}`],
    sources: ['arXiv'],
  }
}

function xmlTag(xml: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(pattern)
  if (!match) return undefined
  const text = cleanText(decodeEntities(match[1].replace(/<[^>]*>/g, ' ')))
  return text || undefined
}
