/**
 * Document outline + per-page first-line titles for the rail's title mode.
 *
 * The outline is the bookmarks a LaTeX/hyperref PDF carries (section names,
 * appendices, references); it is the best table of contents when present. When
 * a PDF has none, the rail falls back to each page's first text line, resolved
 * lazily as rows scroll into view.
 */

import { cachedPage, cachedText } from '../../lib/doc-cache.js'

export interface OutlineEntry {
  id: string
  title: string
  page: number
  depth: number
}

const outlineCache = new WeakMap<object, Promise<OutlineEntry[]>>()
const titleCache = new WeakMap<object, Map<number, string>>()
const titleJobs = new WeakMap<object, Map<number, Promise<string>>>()

function clip(text: string, limit = 72): string {
  const clean = text.replace(/[\u0000-\u001f\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

async function resolveDest(doc: any, dest: any): Promise<number> {
  try {
    let target = dest
    if (typeof dest === 'string') target = await doc.getDestination(dest)
    if (!Array.isArray(target) || target.length === 0) return 0
    const ref = target[0]
    if (typeof ref === 'number') return ref + 1
    if (ref && typeof doc.getPageIndex === 'function') {
      const index = await doc.getPageIndex(ref)
      return Number.isFinite(index) ? index + 1 : 0
    }
  } catch {
    /* an unresolvable destination just drops this entry */
  }
  return 0
}

async function buildOutline(doc: any): Promise<OutlineEntry[]> {
  const raw = await doc.getOutline()
  if (!Array.isArray(raw) || raw.length === 0) return []
  const entries: OutlineEntry[] = []
  let seq = 0

  const visit = async (items: any[], depth: number): Promise<void> => {
    for (const item of items) {
      const title = typeof item?.title === 'string' ? clip(item.title, 96) : ''
      if (title) {
        const page = await resolveDest(doc, item.dest)
        if (page > 0) {
          entries.push({ id: `o${seq++}`, title, page, depth })
        }
      }
      if (Array.isArray(item?.items) && item.items.length > 0) {
        await visit(item.items, depth + 1)
      }
    }
  }

  await visit(raw, 0)
  return entries
}

export function outlineOf(doc: any): Promise<OutlineEntry[]> {
  if (!doc || typeof doc.getOutline !== 'function') return Promise.resolve([])
  const hit = outlineCache.get(doc)
  if (hit) return hit
  const job = buildOutline(doc).catch(() => [])
  outlineCache.set(doc, job)
  return job
}

/** The expensive half: read a page's first line of text. */
async function readFirstLine(doc: any, pageNumber: number): Promise<string> {
  try {
    await cachedPage(doc, pageNumber)
    const content = await cachedText(doc, pageNumber)
    for (const item of content?.items ?? []) {
      const text = typeof item?.str === 'string' ? item.str.trim() : ''
      if (text.length >= 2) return clip(text)
    }
  } catch {
    /* a page without a text layer simply has no title */
  }
  return ''
}

/** Cached title, or `null` when this page has not been read yet. */
export function pageTitle(doc: any, pageNumber: number): string | null {
  const entry = titleCache.get(doc)
  return entry?.get(pageNumber) ?? null
}

export function loadPageTitle(doc: any, pageNumber: number): Promise<string> {
  const cached = pageTitle(doc, pageNumber)
  if (cached !== null) return Promise.resolve(cached)

  let jobs = titleJobs.get(doc)
  if (!jobs) {
    jobs = new Map()
    titleJobs.set(doc, jobs)
  }
  const running = jobs.get(pageNumber)
  if (running) return running

  const job = readFirstLine(doc, pageNumber).then((title) => {
    let entry = titleCache.get(doc)
    if (!entry) {
      entry = new Map()
      titleCache.set(doc, entry)
    }
    entry.set(pageNumber, title)
    jobs?.delete(pageNumber)
    return title
  })
  jobs.set(pageNumber, job)
  return job
}
