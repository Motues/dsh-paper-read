import { IconBack, IconHistory, IconPlus } from '../../../components/ui.js'

/** The conversation bar: active title on the left, history/new on the right. */
export function ChatHeader({
  title,
  history,
  busy,
  onBack,
  onToggleHistory,
  onNewConversation,
}: {
  title: string
  history: boolean
  busy: boolean
  onBack: () => void
  onToggleHistory: () => void
  onNewConversation: () => void
}) {
  return (
    <div className="pr-chat-head">
      {history ? (
        <button
          type="button"
          className="pr-chat-icon"
          title="返回对话"
          aria-label="返回对话"
          onClick={onBack}
        >
          <IconBack size={14} />
        </button>
      ) : null}
      <span className="pr-chat-title" title={title}>{title}</span>
      <div className="pr-spacer" />
      <button
        type="button"
        className="pr-chat-icon"
        data-on={history || undefined}
        aria-pressed={history}
        title={history ? '返回对话' : '历史对话'}
        aria-label="历史对话"
        onClick={onToggleHistory}
      >
        <IconHistory size={14} />
      </button>
      <button
        type="button"
        className="pr-chat-icon"
        disabled={busy}
        title={busy ? '等这一轮回答结束再新建对话' : '新建对话'}
        aria-label="新建对话"
        onClick={onNewConversation}
      >
        <IconPlus size={14} />
      </button>
    </div>
  )
}
