import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { IconClose, IconSearch } from '../../components/ui.js'
import type { PaperSearchHit } from '../../types.js'

const DEBOUNCE_MS = 200

/**
 * Find-in-paper for the reader toolbar. Collapsed it is one magnifier button;
 * open it grows into a text field (same 180ms morph as the folder-rail search)
 * and drops a hit list under the toolbar. The reader owns the jump: picking a
 * hit only reports it, so this component stays about searching.
 */
export function ReaderSearch({
  paperId,
  onPick,
  openSignal = 0,
}: {
  paperId: string
  onPick: (hit: PaperSearchHit) => void
  /** Bumped by the reader toolbar's owner when Ctrl/⌘+F targets find-in-paper. */
  openSignal?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PaperSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [noText, setNoText] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // A remount (switching papers) must not replay the last shortcut signal.
  const handledOpenSignal = useRef(openSignal)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setHits([])
    setTotal(0)
    setNoText(false)
    setError(null)
    setSearched(false)
    setBusy(false)
    setActive(0)
  }, [])

  const close = useCallback(() => {
    reset()
    inputRef.current?.blur()
    setOpen(false)
    setQuery('')
  }, [reset])

  // A different paper starts with a closed box: no hits from the last one.
  useEffect(() => {
    close()
  }, [paperId, close])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // The shell's search shortcut targets whichever search the current page owns.
  // A bump opens this box and selects any existing query so the next keystroke
  // replaces it, matching the library and relation searches.
  useEffect(() => {
    if (openSignal <= 0 || openSignal === handledOpenSignal.current) return undefined
    handledOpenSignal.current = openSignal
    setOpen(true)
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [openSignal])

  // Any click outside (including on the paper) puts the box away and clears it.
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [close, open])

  // Debounced host query; a newer keystroke aborts the in-flight request.
  useEffect(() => {
    const text = query.trim()
    if (!open || text.length === 0) {
      reset()
      return undefined
    }
    setBusy(true)
    setError(null)
    const timer = window.setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      api.paperSearch(paperId, text, { signal: controller.signal })
        .then((payload) => {
          if (controller.signal.aborted) return
          setHits(payload.hits)
          setTotal(payload.total)
          setNoText(Boolean(payload.noText))
          setSearched(true)
          setActive(0)
        })
        .catch((next) => {
          if (controller.signal.aborted) return
          setHits([])
          setTotal(0)
          setNoText(false)
          setSearched(true)
          setError((next as Error).message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [open, paperId, query, reset])

  // Keep the keyboard-selected row visible inside the list, not the page.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>('[data-active]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [active, hits, open])

  const changeQuery = (next: string) => {
    setQuery(next)
    setHits([])
    setTotal(0)
    setNoText(false)
    setError(null)
    setSearched(false)
    setActive(0)
  }

  const pick = (hit: PaperSearchHit | undefined) => {
    if (!hit) return
    onPick(hit)
  }

  const summary = busy
    ? '搜索中…'
    : error
      ? error
      : noText
        ? '这篇论文没有可检索的全文'
        : total > 0
          ? `共 ${total} 处`
          : searched
            ? '未找到匹配内容'
            : ''

  return (
    <div
      className="pr-reader-search-wrap"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        close()
      }}
    >
      <div
        className="pr-reader-search"
        data-open={open || undefined}
        role="search"
        aria-label="搜索本文全文"
        onClick={() => {
          if (!open) setOpen(true)
        }}
      >
        <button
          type="button"
          className="pr-reader-search-toggle"
          title={open ? '关闭搜索' : '搜索本文'}
          aria-label={open ? '关闭搜索' : '搜索本文'}
          aria-expanded={open}
          onClick={() => {
            if (open) close()
            else setOpen(true)
          }}
        >
          <IconSearch size={15} />
        </button>
        <input
          ref={inputRef}
          className="pr-reader-search-input"
          value={query}
          type="search"
          placeholder="搜索本文全文…"
          aria-label="搜索本文全文"
          tabIndex={open ? 0 : -1}
          aria-hidden={open ? undefined : true}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (hits.length === 0) return
              event.preventDefault()
              setActive((current) => (
                event.key === 'ArrowDown'
                  ? (current + 1) % hits.length
                  : (current - 1 + hits.length) % hits.length
              ))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              pick(hits[Math.min(active, hits.length - 1)])
            }
          }}
        />
        <button
          type="button"
          className="pr-reader-search-clear"
          title="清空"
          aria-label="清空搜索"
          data-show={open && query ? '' : undefined}
          tabIndex={open && query ? 0 : -1}
          aria-hidden={open && query ? undefined : true}
          onClick={() => {
            changeQuery('')
            inputRef.current?.focus()
          }}
        >
          <IconClose size={11} />
        </button>
      </div>

      {open && query.trim().length > 0 ? (
        <div className="pr-reader-find" role="listbox" aria-label="全文搜索结果" ref={listRef}>
          {summary ? <div className="pr-reader-find-head" data-error={error || undefined}>{summary}</div> : null}
          {hits.map((hit, index) => (
            <button
              key={`${hit.page}-${hit.blockId}-${hit.quoteStart}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className="pr-reader-find-row"
              data-active={index === active || undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(hit)}
            >
              <span className="pr-reader-find-page">第 {hit.page} 页</span>
              <span className="pr-reader-find-quote">
                {hit.quote.slice(0, hit.quoteStart)}
                <mark>{hit.quote.slice(hit.quoteStart, hit.quoteStart + hit.quoteLength)}</mark>
                {hit.quote.slice(hit.quoteStart + hit.quoteLength)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
