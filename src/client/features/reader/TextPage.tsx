import { memo, useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import type { PageText } from '../../types.js'
import type { FindMark } from './find.js'

const CACHE_LIMIT = 24
const textPages = new Map<string, PageText>()

function cacheKey(paperId: string, page: number): string {
  return `${paperId}#${page}`
}

function remember(key: string, value: PageText): void {
  textPages.set(key, value)
  while (textPages.size > CACHE_LIMIT) {
    const oldest = textPages.keys().next().value
    if (oldest === undefined) break
    textPages.delete(oldest)
  }
}

/**
 * One page of the parsed-text fallback (no PDF, or the PDF failed to load).
 * Rendering it as a page-level component keeps continuous mode honest: text
 * pages stack and scroll exactly like PDF pages, just without a canvas.
 */
function TextPageView({
  paperId,
  pageNumber,
  find = null,
  width = null,
}: {
  paperId: string
  pageNumber: number
  find?: FindMark | null
  /** Fixed CSS width, so a bilingual column can match the PDF page beside it. */
  width?: number | null
}) {
  const key = cacheKey(paperId, pageNumber)
  const [text, setText] = useState<PageText | null>(() => textPages.get(key) ?? null)

  useEffect(() => {
    if (text) return undefined
    let cancelled = false
    void api.page(paperId, pageNumber).then((next) => {
      if (cancelled) return
      remember(key, next)
      setText(next)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key, paperId, pageNumber, text])

  return (
    <div
      className="pr-text-paper"
      data-page={pageNumber}
      style={width && width > 0 ? { width, maxWidth: '100%' } : undefined}
    >
      {text ? (
        text.blocks.length > 0 ? (
          text.blocks.map((block) => {
            const hit = find?.blockId === block.id
            return (
              <p
                key={hit ? `${block.id}-${find?.token}` : block.id}
                className={block.kind === 'title' ? 'pr-text-title' : 'pr-text-para'}
                data-find-mark={hit || undefined}
              >
                {block.text}
              </p>
            )
          })
        ) : (
          <div className="pr-empty-state">这一页没有可显示的文本。</div>
        )
      ) : (
        <div className="pr-empty-state">载入中…</div>
      )}
    </div>
  )
}

export const TextPage = memo(TextPageView)
