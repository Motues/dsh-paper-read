import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { RailMode } from '../workspace/tabs.js'
import { PaneResizer } from '../../components/PaneResizer.js'
import { usePaneSize } from '../../lib/pane-size.js'
import { PageThumb, ThumbMarks } from './PageThumb.js'
import { loadPageTitle, outlineOf, pageTitle, type OutlineEntry } from './outline.js'

interface PageRailProps {
  mode: RailMode
  collapsed: boolean
  doc: any
  textMode: boolean
  total: number
  page: number
  marksByPage: Map<number, string[]>
  onSelect: (page: number) => void
}

/**
 * The reader's left rail. Two views share one scroll container: page previews
 * (thumbnails, lazily rasterized) and titles (the PDF outline when it has one,
 * otherwise each page's first text line). Both the view switch and the collapse
 * toggle live in the reader toolbar, so this rail renders no chrome of its own.
 */
export function PageRail({
  mode,
  collapsed,
  doc,
  textMode,
  total,
  page,
  marksByPage,
  onSelect,
}: PageRailProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const previewPane = usePaneSize('railPreview')
  const titlePane = usePaneSize('railTitle')
  const pane = mode === 'title' ? titlePane : previewPane

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [page, mode])

  const pages = useMemo(
    () => Array.from({ length: Math.max(0, Math.min(total, 500)) }, (_, index) => index + 1),
    [total],
  )

  return (
    <aside
      className="pr-rail"
      data-mode={mode}
      data-collapsed={collapsed || undefined}
      ref={pane.ref}
      style={{ width: collapsed ? 0 : pane.width }}
    >
      <div className="pr-rail-inner" ref={pane.innerRef} style={{ width: pane.width }}>
        <div className="pr-rail-body pr-thumbs" ref={bodyRef}>
          {mode === 'preview' ? (
            doc && !textMode ? (
              pages.slice(0, 200).map((n) => (
                <PageThumb
                  key={n}
                  doc={doc}
                  pageNumber={n}
                  active={n === page}
                  marks={marksByPage.get(n) ?? []}
                  onSelect={onSelect}
                />
              ))
            ) : (
              pages.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="pr-thumb"
                  data-on={n === page || undefined}
                  onClick={() => onSelect(n)}
                  title={`第 ${n} 页`}
                >
                  <ThumbMarks marks={marksByPage.get(n) ?? []} />
                  <span className="pr-thumb-num">{n}</span>
                </button>
              ))
            )
          ) : (
            <TitleList
              doc={doc}
              textMode={textMode}
              total={total}
              page={page}
              activeRef={activeRef}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>

      {collapsed ? null : <PaneResizer label="调整左栏宽度" {...pane.handle} />}
    </aside>
  )
}

function TitleList({
  doc,
  textMode,
  total,
  page,
  activeRef,
  onSelect,
}: {
  doc: any
  textMode: boolean
  total: number
  page: number
  activeRef: MutableRefObject<HTMLButtonElement | null>
  onSelect: (page: number) => void
}) {
  const [outline, setOutline] = useState<OutlineEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!doc || textMode) {
      setOutline([])
      return undefined
    }
    setOutline(null)
    void outlineOf(doc).then((entries) => {
      if (!cancelled) setOutline(entries)
    })
    return () => {
      cancelled = true
    }
  }, [doc, textMode])

  const activeOutlineId = useMemo(() => {
    if (!outline || outline.length === 0) return null
    let id: string | null = null
    for (const entry of outline) {
      if (entry.page <= page) id = entry.id
      else break
    }
    return id
  }, [outline, page])

  if (outline === null) {
    return <div className="pr-title-empty">读取目录…</div>
  }

  if (outline.length > 0) {
    return (
      <div className="pr-title-list">
        {outline.map((entry) => {
          const active = entry.id === activeOutlineId
          return (
            <button
              key={entry.id}
              ref={active ? activeRef : undefined}
              type="button"
              className="pr-title-row"
              data-on={active || undefined}
              data-depth={Math.min(entry.depth, 3)}
              title={entry.title}
              onClick={() => onSelect(entry.page)}
            >
              <span className="pr-title-text">{entry.title}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const pages = Array.from({ length: Math.max(0, Math.min(total, 500)) }, (_, index) => index + 1)
  return (
    <div className="pr-title-list">
      {pages.map((n) => (
        <TitleRow
          key={n}
          doc={textMode ? null : doc}
          pageNumber={n}
          active={n === page}
          activeRef={n === page ? activeRef : undefined}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function TitleRow({
  doc,
  pageNumber,
  active,
  activeRef,
  onSelect,
}: {
  doc: any
  pageNumber: number
  active: boolean
  activeRef?: MutableRefObject<HTMLButtonElement | null>
  onSelect: (page: number) => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [title, setTitle] = useState<string | null>(() => (doc ? pageTitle(doc, pageNumber) : null))

  useEffect(() => {
    if (!doc || title !== null) return undefined
    let cancelled = false
    const load = () => {
      void loadPageTitle(doc, pageNumber).then((next) => {
        if (!cancelled) setTitle(next)
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        cancelled = true
      }
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      load()
    }, { rootMargin: '240px 0px' })
    if (ref.current) observer.observe(ref.current)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, pageNumber, title])

  const label = title && title.length > 0 ? title : `第 ${pageNumber} 页`
  return (
    <button
      ref={(node) => {
        ref.current = node
        if (activeRef) activeRef.current = node
      }}
      type="button"
      className="pr-title-row"
      data-on={active || undefined}
      title={label}
      onClick={() => onSelect(pageNumber)}
    >
      <span className="pr-title-text" data-placeholder={!title || undefined}>{label}</span>
    </button>
  )
}
