/**
 * Lazy upgrade of `pages.json` after the geometry format changes.
 *
 * Translation is typeset into the original paragraph boxes, so it needs the
 * per-line boxes and leading that v1 extraction threw away. Rather than
 * migrating the whole library on startup, a paper is re-parsed the first time
 * its geometry is actually needed. Translations survive: the cache is keyed by
 * source-text hash, not by block id.
 */

import fs from 'node:fs/promises'
import type { PageText, PaperRecord } from '../../shared/domain.js'
import type { Store } from '../library/store.js'
import { extractPages, PAGE_VERSION } from './extract.js'

const inFlight = new Map<string, Promise<PageText[] | null>>()

export function pagesAreCurrent(paper: PaperRecord): boolean {
  return (paper.parseVersion ?? 0) >= PAGE_VERSION
}

/**
 * Return the parsed pages, re-extracting them once when they predate the
 * current geometry format. A paper without a PDF, or one whose file has moved,
 * keeps whatever it had: a failed upgrade must not lose readable text.
 */
export async function ensurePageGeometry(
  store: Store,
  paper: PaperRecord,
  log: (message: string, error?: unknown) => void,
): Promise<PageText[] | null> {
  const stored = await store.readPages(paper.id)
  if (pagesAreCurrent(paper) || !paper.filePath || paper.pdfUnavailable) return stored
  if (!stored || stored.length === 0) return stored

  const running = inFlight.get(paper.id)
  if (running) return running

  const job = (async (): Promise<PageText[] | null> => {
    try {
      const bytes = await fs.readFile(paper.filePath as string)
      const result = await extractPages(new Uint8Array(bytes))
      await store.writePages(paper.id, result.pages)
      await store.updatePaper(paper.id, {
        parseVersion: PAGE_VERSION,
        pageCount: result.pageCount,
      })
      return result.pages
    } catch (error) {
      log('page geometry refresh failed', error)
      return stored
    }
  })().finally(() => {
    inFlight.delete(paper.id)
  })

  inFlight.set(paper.id, job)
  return job
}
