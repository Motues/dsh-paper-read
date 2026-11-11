/**
 * Shared PDF caches for the reading workspace.
 *
 * Switching tabs unmounts the reader, and with it every page proxy, glyph table
 * and outline it had resolved. Re-downloading and re-parsing the same document
 * on every tab switch is exactly the latency the tab bar is meant to remove, so
 * the expensive parts are cached here instead:
 *
 *   - whole documents, LRU 4 (a tab switch hits the cache; eviction destroys)
 *   - page objects and their text content, both keyed by document
 *
 * Everything is a `WeakMap` on the document object: when an evicted document is
 * garbage collected its caches go with it.
 */

import { loadDocument } from './pdf.js'

const MAX_DOCUMENTS = 4

const documents = new Map<string, { proxy: any; used: number }>()
const pending = new Map<string, Promise<any>>()
let clock = 0

/** One document per paper+mtime key; concurrent callers share the load. */
export async function acquireDocument(key: string, url: string): Promise<any> {
  const hit = documents.get(key)
  if (hit) {
    hit.used = ++clock
    return hit.proxy
  }
  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  const job = loadDocument(url)
    .then((proxy) => {
      documents.set(key, { proxy, used: ++clock })
      evictDocuments()
      return proxy
    })
    .finally(() => {
      pending.delete(key)
    })
  pending.set(key, job)
  return job
}

/**
 * Called when the reader unmounts. The document is *kept*: the next tab switch
 * back should be instant. The LRU bound is what keeps memory finite.
 */
export function releaseDocument(): void {
  evictDocuments()
}

function evictDocuments(): void {
  while (documents.size > MAX_DOCUMENTS) {
    let oldestKey: string | null = null
    let oldestUse = Number.POSITIVE_INFINITY
    for (const [key, entry] of documents) {
      if (entry.used < oldestUse) {
        oldestUse = entry.used
        oldestKey = key
      }
    }
    if (!oldestKey) return
    const entry = documents.get(oldestKey)
    documents.delete(oldestKey)
    destroyQuietly(entry?.proxy)
  }
}

/** Forget one paper's document (used after its PDF is replaced). */
export function dropDocument(key: string): void {
  const entry = documents.get(key)
  if (!entry) return
  documents.delete(key)
  destroyQuietly(entry.proxy)
}

function destroyQuietly(proxy: any): void {
  try {
    const result = proxy?.destroy?.()
    if (result && typeof result.catch === 'function') void result.catch(() => {})
  } catch {
    /* the document may already be gone */
  }
}

const pageCache = new WeakMap<object, Map<number, Promise<any>>>()

export function cachedPage(doc: any, pageNumber: number): Promise<any> {
  let pages = pageCache.get(doc)
  if (!pages) {
    pages = new Map()
    pageCache.set(doc, pages)
  }
  const hit = pages.get(pageNumber)
  if (hit) return hit
  const job = doc.getPage(pageNumber)
  pages.set(pageNumber, job)
  void job.catch(() => {
    pages?.delete(pageNumber)
  })
  return job
}

const TEXT_LIMIT = 16
const textCache = new WeakMap<object, { pages: Map<number, Promise<any>>; order: number[] }>()

export function cachedText(doc: any, pageNumber: number): Promise<any> {
  let entry = textCache.get(doc)
  if (!entry) {
    entry = { pages: new Map(), order: [] }
    textCache.set(doc, entry)
  }
  const hit = entry.pages.get(pageNumber)
  if (hit) return hit
  const job = cachedPage(doc, pageNumber).then((proxy: any) => proxy.getTextContent())
  entry.pages.set(pageNumber, job)
  entry.order.push(pageNumber)
  while (entry.order.length > TEXT_LIMIT) {
    const oldest = entry.order.shift()
    if (oldest === undefined) break
    entry.pages.delete(oldest)
  }
  void job.catch(() => {
    entry?.pages.delete(pageNumber)
  })
  return job
}
