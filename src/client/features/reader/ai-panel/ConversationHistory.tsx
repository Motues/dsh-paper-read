import { useState } from 'react'
import { IconArchive, IconCheck, IconClose, IconHistory, IconPencil, IconRestore } from '../../../components/ui.js'
import type { ChatConversation } from '../../../types.js'
import { conversationTime } from './shared.js'

/**
 * The paper's conversation manager, shown in place of the transcript.
 *
 * Every entry is a real DSH session; switching makes it active again, renaming
 * only changes the display title, and archiving hides it without deleting the
 * log.
 */
export function ConversationHistory({
  conversations = [],
  busy,
  onSelect,
  onRename,
  onArchive,
  onUnarchive,
  onToast,
}: {
  conversations?: ChatConversation[]
  busy: boolean
  onSelect: (sessionId: string) => void
  onRename: (sessionId: string, title: string) => Promise<void>
  onArchive: (sessionId: string) => Promise<void>
  onUnarchive: (sessionId: string) => Promise<void>
  onToast: (message: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)

  const disabled = busy || pending
  const run = (task: () => Promise<void>) => {
    if (disabled) return
    setPending(true)
    task()
      .catch((error) => onToast((error as Error).message))
      .finally(() => setPending(false))
  }
  const visible = conversations.filter((item) => !item.archived)
  const archived = conversations.filter((item) => item.archived)

  const row = (item: ChatConversation) => (
    <div className="pr-conv-item" data-on={item.active || undefined} key={item.id}>
      {editing === item.id ? (
        <form
          className="pr-conv-rename"
          onSubmit={(event) => {
            event.preventDefault()
            if (!draft.trim()) return
            run(async () => {
              await onRename(item.id, draft)
              setEditing(null)
            })
          }}
        >
          <input
            autoFocus
            value={draft}
            maxLength={60}
            aria-label="对话名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(null)
            }}
          />
          <button type="submit" className="pr-conv-mini" title="保存" disabled={disabled}>
            <IconCheck size={12} />
          </button>
          <button
            type="button"
            className="pr-conv-mini"
            title="取消"
            onClick={() => setEditing(null)}
          >
            <IconClose size={12} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="pr-conv-main"
          disabled={item.active || disabled}
          title={item.title}
          onClick={() => {
            if (item.active || disabled) return
            onSelect(item.id)
          }}
        >
          <span className="pr-conv-title">{item.title}</span>
          <span className="pr-conv-meta">
            {item.active
              ? '当前对话'
              : [
                item.messageCount ? `${item.messageCount} 条` : '',
                conversationTime(item.createdAt),
              ].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}
      <span className="pr-conv-actions">
        <button
          type="button"
          className="pr-conv-mini"
          title="重命名"
          disabled={disabled}
          onClick={() => {
            setEditing(item.id)
            setDraft(item.title)
          }}
        >
          <IconPencil size={12} />
        </button>
        {item.archived ? (
          <button
            type="button"
            className="pr-conv-mini"
            title="恢复到历史列表"
            disabled={disabled}
            onClick={() => run(async () => { await onUnarchive(item.id) })}
          >
            <IconRestore size={12} />
          </button>
        ) : (
          <button
            type="button"
            className="pr-conv-mini"
            title={item.active ? '当前对话不能归档' : '归档（保留日志）'}
            disabled={disabled || item.active}
            onClick={() => run(async () => { await onArchive(item.id) })}
          >
            <IconArchive size={12} />
          </button>
        )}
      </span>
    </div>
  )

  return (
    <div className="pr-history" data-scroll>
      {visible.length === 0 && archived.length === 0 ? (
        <div className="pr-empty">
          <IconHistory size={18} />
          还没有对话。发送第一条问题后，这里会出现历史对话。
        </div>
      ) : null}
      <div className="pr-history-list">
        {visible.map(row)}
      </div>
      {archived.length > 0 ? (
        <>
          <div className="pr-conv-sub">已归档 · {archived.length}</div>
          <div className="pr-history-list">{archived.map(row)}</div>
        </>
      ) : null}
      <div className="pr-history-note">
        归档只把对话从列表里隐藏，DSH 会话日志仍保留，可随时恢复。
      </div>
    </div>
  )
}
