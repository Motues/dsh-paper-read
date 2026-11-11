import { useEffect, useRef, useState } from 'react'
import type {
  Annotation,
  ChatContextUsage,
  ChatConversation,
  ChatMessage,
  ChatModelCatalog,
  ChatRoute,
  EdgeView,
  PaperDetail,
  PaperMetadataPatch,
  SummaryEdit,
} from '../../types.js'
import {
  IconChevronRight,
  IconClose,
  IconNote,
  IconPaperPlane,
  IconSpark,
  RichText,
} from '../../components/ui.js'
import { PaneResizer } from '../../components/PaneResizer.js'
import { usePaneSize } from '../../lib/pane-size.js'
import { ChatHeader } from './ai-panel/ChatHeader.js'
import { ContextMeter } from './ai-panel/ContextMeter.js'
import { ConversationHistory } from './ai-panel/ConversationHistory.js'
import { GuidePanel } from './ai-panel/GuidePanel.js'
import { InfoPanel } from './ai-panel/InfoPanel.js'
import { InjectedBlock } from './ai-panel/InjectedBlock.js'
import { ModelSelect } from './ai-panel/ModelSelect.js'
import { RelationsPanel } from './ai-panel/RelationsPanel.js'

export function AIPanel({
  detail,
  open,
  tab,
  onTab,
  thread,
  context,
  compacting,
  clearing,
  conversations = [],
  route,
  models,
  modelBusy,
  onLoadModels,
  onPickModel,
  annotations,
  relations,
  busy,
  composerQuote,
  onClearQuote,
  onSend,
  onCompact,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onArchiveConversation,
  onUnarchiveConversation,
  onJump,
  onSaveNote,
  onRemoveAnnotation,
  onOpenPaper,
  onShowRelations,
  onToast,
  aiEnabled,
  onAiBlocked,
  onRegenerateSummary,
  onSaveSummary,
  summaryBusy,
  summarySaving,
  onSaveMetadata,
  metadataSaving,
}: {
  detail: PaperDetail
  open: boolean
  tab: 'ai' | 'guide' | 'notes' | 'relations' | 'info'
  onTab: (tab: 'ai' | 'guide' | 'notes' | 'relations' | 'info') => void
  thread: ChatMessage[]
  /** How full this paper session's context is; `null` until the session is live. */
  context: ChatContextUsage | null
  compacting: boolean
  clearing: boolean
  /** Each conversation of this paper, active first. */
  conversations: ChatConversation[]
  /** The model this conversation actually runs on. */
  route: ChatRoute | null
  /** Model list for the switch menu; `null` until the menu is opened once. */
  models: ChatModelCatalog | null
  modelBusy: boolean
  onLoadModels: () => void
  onPickModel: (route: ChatRoute) => void
  annotations: Annotation[]
  relations: EdgeView[]
  busy: boolean
  composerQuote: { text: string; page: number; prompt: string } | null
  onClearQuote: () => void
  onSend: (text: string, quote?: string, page?: number) => void
  onCompact: () => void
  /** Start a fresh conversation; the previous one becomes history. */
  onNewConversation: () => void
  onSelectConversation: (sessionId: string) => void
  onRenameConversation: (sessionId: string, title: string) => Promise<void>
  onArchiveConversation: (sessionId: string) => Promise<void>
  onUnarchiveConversation: (sessionId: string) => Promise<void>
  onJump: (annotation: Annotation) => void
  onSaveNote: (annotationId: string, body: string) => Promise<void>
  onRemoveAnnotation: (annotationId: string) => Promise<void>
  onOpenPaper: (id: string) => void
  /** Jump to the full relation graph with this paper focused. */
  onShowRelations?: (paperId: string) => void
  onToast: (message: string) => void
  /** Global AI switch; false disables every token-consuming action. */
  aiEnabled: boolean
  onAiBlocked: (action: string) => void
  onRegenerateSummary: () => void
  onSaveSummary: (patch: SummaryEdit) => Promise<void>
  summaryBusy: boolean
  summarySaving: boolean
  onSaveMetadata: (patch: PaperMetadataPatch) => Promise<void>
  metadataSaving: boolean
}) {
  const [draft, setDraft] = useState('')
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  /** The AI tab shows either the transcript or the conversation manager. */
  const [panelView, setPanelView] = useState<'chat' | 'history'>('chat')
  /** Injected blocks start collapsed; expanding one is remembered per message. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const threadRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pane = usePaneSize('panel', 'left')

  useEffect(() => {
    if (tab !== 'ai') setPanelView('chat')
  }, [tab])

  const activeConversation = conversations.find((item) => item.active)
  const conversationTitle = activeConversation?.title?.trim() || '新对话'

  useEffect(() => {
    const element = threadRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [thread])

  useEffect(() => {
    if (open && composerQuote) composerRef.current?.focus()
  }, [composerQuote, open])

  const summary = detail.summary
  const ordered = annotations
    .slice()
    .sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt))
  const pageTotals = new Map<number, number>()
  for (const annotation of ordered) pageTotals.set(annotation.page, (pageTotals.get(annotation.page) ?? 0) + 1)

  const submit = (override?: string) => {
    if (busy) return
    const text = (override ?? draft).trim() || composerQuote?.prompt || ''
    if (!text) return
    if (!aiEnabled) {
      onAiBlocked('继续对话')
      return
    }
    setDraft('')
    onSend(text, composerQuote?.text, composerQuote?.page)
    onClearQuote()
  }

  return (
    <aside
      className="pr-panel"
      data-open={open || undefined}
      aria-hidden={open ? undefined : true}
      ref={pane.ref}
      style={{ width: open ? pane.width : 0 }}
    >
      {open ? <PaneResizer label="调整 AI 面板宽度" {...pane.handle} /> : null}
      <div className="pr-panel-inner" ref={pane.innerRef} style={{ width: pane.width }}>
        <div className="pr-panel-tabs">
          <button className="pr-panel-tab" data-on={tab === 'ai' || undefined} onClick={() => onTab('ai')}>
            对话
          </button>
          <button className="pr-panel-tab" data-on={tab === 'guide' || undefined} onClick={() => onTab('guide')}>
            导读
          </button>
          <button className="pr-panel-tab" data-on={tab === 'notes' || undefined} onClick={() => onTab('notes')}>
            批注
          </button>
          <button className="pr-panel-tab" data-on={tab === 'relations' || undefined} onClick={() => onTab('relations')}>
            关联
          </button>
          <button className="pr-panel-tab" data-on={tab === 'info' || undefined} onClick={() => onTab('info')}>
            文献信息
          </button>
        </div>

      {tab === 'guide' ? (
        <GuidePanel
          detail={detail}
          aiEnabled={aiEnabled}
          busy={summaryBusy}
          saving={summarySaving}
          onRegenerate={onRegenerateSummary}
          onSave={onSaveSummary}
          onOpenPaper={onOpenPaper}
          onToast={onToast}
          onAiBlocked={onAiBlocked}
        />
      ) : tab === 'info' ? (
        <InfoPanel
          detail={detail}
          saving={metadataSaving}
          onSave={onSaveMetadata}
          onToast={onToast}
        />
      ) : tab === 'relations' ? (
        <RelationsPanel
          relations={relations}
          onOpenPaper={onOpenPaper}
          onShowGraph={onShowRelations ? () => onShowRelations(detail.id) : undefined}
        />
      ) : tab === 'notes' ? (
        <div className="pr-notes" data-scroll>
          {summary ? (
            <div className="pr-summary">
              <div className="pr-summary-tldr">
                <IconSpark size={12} />
                {summary.tldr}
              </div>
              {(summary.findings ?? []).length > 0 ? (
                <ul className="pr-summary-list">
                  {(summary.findings ?? []).slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          {annotations.length === 0 ? (
            <div className="pr-empty">
              <IconNote size={18} />
              还没有批注。选中正文中的任意段落，点工具条上的颜色即可高亮。
            </div>
          ) : (
            ordered.map((annotation, index) => {
              const total = pageTotals.get(annotation.page) ?? 1
              const position = ordered.slice(0, index + 1).filter((item) => item.page === annotation.page).length
              return (
                <div className="pr-note" key={annotation.id}>
                  <div className="pr-note-q">
                    <span className="pr-dot" data-c={annotation.color} style={{ marginTop: 6 }} />
                    {annotation.quote.length > 140 ? `${annotation.quote.slice(0, 140)}…` : annotation.quote}
                  </div>
                  {annotation.note ? (
                    <div className="pr-note-body">{annotation.note}</div>
                  ) : null}
                  {noteFor === annotation.id ? (
                    <div className="pr-note-edit">
                      <textarea
                        rows={2}
                        value={noteDraft}
                        autoFocus
                        placeholder="写下你的想法，之后可以跨论文检索到…"
                        onChange={(event) => setNoteDraft(event.target.value)}
                      />
                      <div className="pr-note-actions">
                        <button
                          className="pr-btn"
                          data-sm
                          data-primary
                          onClick={() => {
                            void onSaveNote(annotation.id, noteDraft)
                            setNoteFor(null)
                          }}
                        >
                          保存
                        </button>
                        <button className="pr-btn" data-sm data-ghost onClick={() => setNoteFor(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="pr-note-meta">
                    第 {annotation.page} 页{total > 1 ? ` · ${position}/${total}` : ''}
                    <div className="pr-spacer" />
                    <button
                      className="pr-btn"
                      data-sm
                      data-ghost
                      title={total > 1 ? `定位到本页第 ${position} 条批注` : '定位到这条批注'}
                      onClick={() => onJump(annotation)}
                    >
                      定位
                      <IconChevronRight size={12} />
                    </button>
                    <button
                      className="pr-btn"
                      data-sm
                      data-ghost
                      onClick={() => {
                        setNoteFor(annotation.id)
                        setNoteDraft(annotation.note ?? '')
                      }}
                    >
                      {annotation.note ? '改笔记' : '写笔记'}
                    </button>
                    <button
                      className="pr-btn"
                      data-sm
                      data-ghost
                      title="删除批注"
                      onClick={() => void onRemoveAnnotation(annotation.id)}
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        <>
          <ChatHeader
            title={panelView === 'history' ? '历史对话' : conversationTitle}
            history={panelView === 'history'}
            busy={busy || clearing}
            onBack={() => setPanelView('chat')}
            onToggleHistory={() => setPanelView((value) => (value === 'history' ? 'chat' : 'history'))}
            onNewConversation={() => {
              onNewConversation()
              setPanelView('chat')
            }}
          />
          {panelView === 'history' ? (
            <ConversationHistory
              conversations={conversations}
              busy={busy || clearing}
              onSelect={(sessionId) => {
                onSelectConversation(sessionId)
                setPanelView('chat')
              }}
              onRename={onRenameConversation}
              onArchive={onArchiveConversation}
              onUnarchive={onUnarchiveConversation}
              onToast={onToast}
            />
          ) : (
            <>
          {!aiEnabled ? (
            <div className="pr-ai-off">
              <IconSpark size={13} />
              <span>AI 功能已在设置中关闭；对话、解释、翻译与压缩都不会调用模型。</span>
            </div>
          ) : null}
          <div className="pr-thread" data-scroll ref={threadRef}>
            {thread.length === 0 ? (
              <div className="pr-empty">
                <div>
                  我在读《{detail.title.length > 22 ? `${detail.title.slice(0, 22)}…` : detail.title}》。
                  选中段落可以让我解释，也可以直接问：
                </div>
                {summary?.tldr ? <div className="pr-summary-tldr" style={{ marginTop: 10 }}>{summary.tldr}</div> : null}
                <div className="pr-suggest">
                  <button onClick={() => submit('这篇论文解决了什么问题？用三句话概括。')}>
                    这篇论文解决了什么问题？用三句话概括。
                  </button>
                  <button onClick={() => submit('方法的关键步骤是什么？按顺序说。')}>
                    方法的关键步骤是什么？
                  </button>
                  <button onClick={() => submit('作者的方法有哪些隐含假设？可能在哪里失效？')}>
                    作者的方法有哪些隐含假设？
                  </button>
                </div>
              </div>
            ) : (
              thread.map((message) => (
                message.injected ? (
                  <InjectedBlock
                    key={message.id}
                    message={message}
                    open={expanded[message.id] === true}
                    onToggle={() => setExpanded((previous) => ({
                      ...previous,
                      [message.id]: previous[message.id] !== true,
                    }))}
                  />
                ) : message.summary ? (
                  <div className="pr-msg" data-role="summary" key={message.id}>
                    <div className="pr-msg-role"><IconNote size={11} /> 上下文摘要</div>
                    <div className="pr-msg-body"><RichText text={message.text} /></div>
                  </div>
                ) : (
                  <div className="pr-msg" data-role={message.role} key={message.id}>
                    <div className="pr-msg-role">
                      {message.role === 'user' ? '你' : <><IconSpark size={11} /> AI</>}
                      {message.mode === 'explain' ? <span>· 解释</span> : null}
                      {message.page ? <span>· 第 {message.page} 页</span> : null}
                    </div>
                    {message.quote ? <div className="pr-bubble-quote">{message.quote}</div> : null}
                    <div className="pr-msg-body">
                      <RichText text={message.text} />
                      {message.id === 'pending' ? <span className="pr-caret" /> : null}
                    </div>
                  </div>
                )
              ))
            )}
          </div>

          <div className="pr-composer">
            <div className="pr-input-wrap">
              {composerQuote ? (
                <div className="pr-composer-quote">
                  <div className="pr-composer-quote-head">
                    <IconNote size={11} />
                    <span>引用 · 第 {composerQuote.page} 页</span>
                    <button
                      type="button"
                      className="pr-quote-x"
                      title="移除引用"
                      onClick={() => {
                        onClearQuote()
                        composerRef.current?.focus()
                      }}
                    >
                      <IconClose size={11} />
                    </button>
                  </div>
                  <div className="pr-composer-quote-text" title={composerQuote.text}>
                    {composerQuote.text}
                  </div>
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                rows={1}
                value={draft}
                placeholder={composerQuote ? '就这段内容提问，或直接发送…' : '问点什么，或选中一段文字再问…'}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <div className="pr-composer-bar">
                <ContextMeter
                  usage={context}
                  busy={busy}
                  compacting={compacting}
                  onCompact={onCompact}
                />
                <ModelSelect
                  route={route}
                  catalog={models}
                  busy={modelBusy}
                  onOpen={onLoadModels}
                  onPick={onPickModel}
                />
                <div className="pr-spacer" />
                <button
                  className="pr-send"
                  disabled={busy || (!draft.trim() && !composerQuote)}
                  onClick={() => submit()}
                  title="发送（Enter）"
                  aria-label="发送"
                >
                  <IconPaperPlane size={14} />
                </button>
              </div>
            </div>
          </div>
            </>
          )}
        </>
      )}
      </div>
    </aside>
  )
}
