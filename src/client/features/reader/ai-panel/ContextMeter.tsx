import { useRef, useState } from 'react'
import { IconCompress } from '../../../components/ui.js'
import type { ChatContextUsage } from '../../../types.js'
import { formatTokens, useDismiss } from './shared.js'

/**
 * Composer context occupancy, after DSH's `ContextMeter`: a 14px ring plus the
 * percentage, opening a small panel that owns manual compaction.
 */
export function ContextMeter({
  usage,
  busy,
  compacting,
  onCompact,
}: {
  usage: ChatContextUsage | null
  busy: boolean
  compacting: boolean
  onCompact: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const close = () => setOpen(false)
  useDismiss(open, rootRef, close)

  const percent = usage?.percent ?? 0
  const radius = 5.5
  const circumference = 2 * Math.PI * radius
  const label = usage ? (percent === 0 && usage.tokens > 0 ? '<1%' : `${percent}%`) : '—'
  const title = usage
    ? `上下文占用 ${percent}%（约 ${usage.tokens.toLocaleString()} / ${usage.window.toLocaleString()} tokens）`
    : '上下文还没有开始统计'

  return (
    <span className="pr-meter" ref={rootRef}>
      <button
        type="button"
        className="pr-meter-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle className="pr-meter-track" cx="7" cy="7" r={radius} />
          {percent > 0 ? (
            <circle
              className="pr-meter-fill"
              cx="7"
              cy="7"
              r={radius}
              strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
              transform="rotate(-90 7 7)"
            />
          ) : null}
        </svg>
        <span>{label}</span>
      </button>
      {open ? (
        <div className="pr-meter-panel" role="dialog" aria-label="上下文占用">
          <div className="pr-meter-head">
            <span className="pr-meter-label">上下文已用</span>
            <span className="pr-meter-pct">{label}</span>
            <span className="pr-meter-figs">
              {usage ? `~${formatTokens(usage.tokens)} / ${formatTokens(usage.window)}` : ''}
            </span>
          </div>
          <div className="pr-meter-bar">
            <span style={{ width: `${usage ? Math.max(percent, 1) : 0}%` }} />
          </div>
          <div className="pr-meter-note">
            {usage
              ? (usage.compacted ? '较早的对话已压成一段摘要。' : '论文固定资料 + 每轮检索片段。')
              : '提一个问题后开始统计。'}
          </div>
          <div className="pr-meter-actions">
            <button
              type="button"
              className="pr-meter-compact"
              disabled={busy || compacting || !usage}
              title={usage ? '把较早的对话压成一段摘要，释放上下文' : '对话还没有开始'}
              onClick={onCompact}
            >
              <IconCompress size={12} />
              {compacting ? '压缩中…' : '压缩上下文'}
            </button>
          </div>
        </div>
      ) : null}
    </span>
  )
}
