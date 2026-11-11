import { IconChevronDown, IconChevronRight, IconFile, IconSearch, RichText } from '../../../components/ui.js'
import type { ChatMessage } from '../../../types.js'

/**
 * One injected-context block, collapsed by default.
 *
 * Mirrors DSH's transcript disclosure: a 24px row with a leading icon that turns
 * into a chevron on hover, `title · summary` in tertiary ink, and the body in a
 * muted inset below.
 */
export function InjectedBlock({
  message,
  open,
  onToggle,
}: {
  message: ChatMessage
  open: boolean
  onToggle: () => void
}) {
  const digest = message.injected === 'digest'
  const pages = message.pages ?? []
  const chars = message.text.length.toLocaleString()
  const summary = digest
    ? `${chars} 字 · 每篇只注入一次`
    : `${pages.length > 0 ? `第 ${pages.join('、')} 页` : '相关页'} · ${chars} 字`
  return (
    <div className="pr-inj" data-open={open || undefined}>
      <button type="button" className="pr-inj-head" aria-expanded={open} onClick={onToggle}>
        <span className="pr-inj-lead" aria-hidden>
          <span className="pr-inj-icon">{digest ? <IconFile size={12} /> : <IconSearch size={12} />}</span>
          <span className="pr-inj-chev">
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </span>
        </span>
        <span className="pr-inj-title">{digest ? '论文固定资料' : '检索片段'}</span>
        <span className="pr-inj-sep" aria-hidden />
        <span className="pr-inj-sum">{summary}</span>
      </button>
      {open ? (
        <div className="pr-inj-body">
          <RichText text={message.text} />
        </div>
      ) : null}
    </div>
  )
}
