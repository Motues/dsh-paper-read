import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Paper } from '../../types.js'
import {
  IconBack,
  IconClose,
  IconLibrary,
  IconPlus,
} from '../../components/ui.js'
import type { ReaderTab } from './tabs.js'

/**
 * The workspace chrome: back to the library and the open-paper tabs. Reader
 * controls (layout, read state, AI panel) live in the reader's own toolbar
 * below this row, so this strip stays one stable height across papers.
 */
export function TopBar({
  tabs,
  activeId,
  papers,
  homeActive,
  onBack,
  onLibrary,
  onActivate,
  onClose,
}: {
  tabs: ReaderTab[]
  activeId: string | null
  papers: Paper[]
  homeActive: boolean
  onBack: () => void
  onLibrary: () => void
  onActivate: (paperId: string) => void
  onClose: (paperId: string) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const byId = useMemo(() => {
    const map = new Map<string, Paper>()
    for (const paper of papers) map.set(paper.id, paper)
    return map
  }, [papers])

  const reading = activeId !== null

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const target = activeId
      ? Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'))
        .find((node) => node.dataset.tabId === activeId)
      : strip.querySelector<HTMLElement>('[data-tab-home]')
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

  return (
    <header className="pr-topbar">
      <button
        type="button"
        className="pr-tb-back"
        onClick={onBack}
        disabled={!reading}
        title="返回上一页"
        aria-label="返回上一页"
      >
        <IconBack size={15} />
      </button>

      <div className="pr-tabs" ref={stripRef} role="tablist" aria-label="打开的论文">
        <button
          type="button"
          role="tab"
          className="pr-tab"
          data-tab-home
          data-on={homeActive || undefined}
          aria-selected={homeActive}
          onClick={onLibrary}
          title="文献库"
        >
          <IconLibrary size={13} />
          <span className="pr-tab-title">文献库</span>
        </button>

        <AnimatePresence initial={false}>
          {tabs.map((tab) => {
            const paper = byId.get(tab.paperId)
            const title = paper?.title || '未命名论文'
            const meta = paper
              ? [paper.authorLine, [paper.venue, paper.year].filter(Boolean).join(' · ')]
                .filter(Boolean)
                .join('\n')
              : '这篇论文已不在库中'
            const active = activeId === tab.paperId
            return (
              <motion.div
                key={tab.paperId}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                className="pr-tab"
                data-tab-id={tab.paperId}
                data-on={active || undefined}
                title={meta ? `${title}\n${meta}` : title}
                exit={{
                  opacity: 0,
                  width: 0,
                  minWidth: 0,
                  maxWidth: 0,
                  paddingLeft: 0,
                  paddingRight: 0,
                  marginLeft: 0,
                  marginRight: 0,
                  borderLeftWidth: 0,
                  borderRightWidth: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0)',
                  borderColor: 'rgba(0, 0, 0, 0)',
                }}
                transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
                onClick={() => onActivate(tab.paperId)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault()
                    onClose(tab.paperId)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onActivate(tab.paperId)
                  }
                }}
              >
                <i className="pr-tab-dot" data-s={paper?.status ?? 'todo'} aria-hidden />
                <span className="pr-tab-title">{title}</span>
                <button
                  type="button"
                  className="pr-tab-close"
                  title="关闭标签"
                  aria-label={`关闭 ${title}`}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(tab.paperId)
                  }}
                >
                  <IconClose size={10} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>

        <button
          type="button"
          className="pr-tab-add"
          onClick={onLibrary}
          title="打开文献库"
          aria-label="打开文献库"
        >
          <IconPlus size={12} />
        </button>
      </div>
    </header>
  )
}
