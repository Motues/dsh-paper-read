import { useEffect, useState, type ReactNode } from 'react'
import type { PaperDetail, Summary, SummaryEdit } from '../../../types.js'
import { IconChevronRight, IconSpark, RichText } from '../../../components/ui.js'

type Draft = {
  tldr: string
  problem: string
  method: string
  findings: string
  limitations: string
  reusable: string
}

const EMPTY: Draft = {
  tldr: '',
  problem: '',
  method: '',
  findings: '',
  limitations: '',
  reusable: '',
}

function linesOf(values: string[] | undefined): string {
  return (values ?? []).join('\n')
}

function listOf(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 12)
}

function draftOf(summary: Summary | null): Draft {
  if (!summary) return EMPTY
  return {
    tldr: summary.tldr ?? '',
    problem: summary.problem ?? '',
    method: summary.method ?? '',
    findings: linesOf(summary.findings),
    limitations: linesOf(summary.limitations),
    reusable: linesOf(summary.reusable),
  }
}

function when(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return date.toLocaleDateString('zh-CN')
}

function GuideSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pr-guide-section">
      <div className="pr-guide-label">{label}</div>
      {children}
    </section>
  )
}

function GuideList({ items }: { items: string[] }) {
  if (items.length === 0) return <div className="pr-guide-empty">—</div>
  return (
    <ul className="pr-guide-list">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}><RichText text={item} /></li>
      ))}
    </ul>
  )
}

export function GuidePanel({
  detail,
  aiEnabled,
  busy,
  saving,
  onRegenerate,
  onSave,
  onOpenPaper,
  onToast,
  onAiBlocked,
}: {
  detail: PaperDetail
  aiEnabled: boolean
  /** A regeneration request is in flight. */
  busy: boolean
  /** A manual save is in flight. */
  saving: boolean
  onRegenerate: () => void
  onSave: (patch: SummaryEdit) => Promise<void>
  onOpenPaper: (paperId: string) => void
  onToast: (message: string) => void
  onAiBlocked: (action: string) => void
}) {
  const summary = detail.summary
  const related = summary?.related ?? []
  const findings = summary?.findings ?? []
  const limitations = summary?.limitations ?? []
  const reusable = summary?.reusable ?? []
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftOf(summary))

  useEffect(() => {
    if (!editing) setDraft(draftOf(summary))
  }, [summary, editing])

  useEffect(() => {
    setConfirming(false)
  }, [summary])

  const beginEdit = () => {
    setDraft(draftOf(summary))
    setEditing(true)
  }

  const regenerate = () => {
    if (!aiEnabled) {
      onAiBlocked(summary ? '重新生成导读' : '生成导读')
      return
    }
    if (busy) return
    if (summary?.editedAt && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onRegenerate()
  }

  const save = async () => {
    if (saving) return
    if (!draft.tldr.trim()) {
      onToast('导读的一句话结论不能为空')
      return
    }
    try {
      await onSave({
        tldr: draft.tldr.trim(),
        problem: draft.problem.trim(),
        method: draft.method.trim(),
        findings: listOf(draft.findings),
        limitations: listOf(draft.limitations),
        reusable: listOf(draft.reusable),
      })
      setEditing(false)
    } catch {
      /* the reader already surfaced the error */
    }
  }

  return (
    <div className="pr-guide" data-scroll>
      <div className="pr-guide-head">
        <div className="pr-guide-heading">
          <b>导读</b>
          <span>{summary ? '读完这一页再决定要不要精读' : '还没有生成导读'}</span>
        </div>
        <div className="pr-guide-actions">
          {summary && !editing ? (
            <button type="button" className="pr-btn" data-sm data-ghost onClick={beginEdit}>
              修改
            </button>
          ) : null}
          {!editing ? (
            <button type="button" className="pr-btn" data-sm data-primary disabled={busy} onClick={regenerate}>
              {busy ? '生成中…' : summary ? '重新生成' : '生成导读'}
            </button>
          ) : null}
        </div>
      </div>

      {!aiEnabled ? (
        <div className="pr-ai-off">
          <IconSpark size={13} />
          <span>AI 功能已在设置中关闭；导读仍可手动修改，重新生成需要先开启 AI。</span>
        </div>
      ) : null}

      {confirming ? (
        <div className="pr-guide-confirm">
          <span>这篇导读有手动修改，重新生成会覆盖这些内容。</span>
          <div className="pr-guide-confirm-actions">
            <button type="button" className="pr-btn" data-sm data-primary onClick={regenerate}>继续生成</button>
            <button type="button" className="pr-btn" data-sm data-ghost onClick={() => setConfirming(false)}>取消</button>
          </div>
        </div>
      ) : null}

      {!summary ? (
        <div className="pr-guide-empty-state">
          <IconSpark size={20} />
          <b>还没有导读</b>
          <span>
            {aiEnabled
              ? '生成一份结构化导读：它解决什么问题、怎么做的、结论和局限是什么。'
              : '在系统设置 → 模型里开启 AI 功能后，可以生成导读。'}
          </span>
          <button type="button" className="pr-btn" data-primary onClick={regenerate}>
            生成导读
          </button>
        </div>
      ) : editing ? (
        <div className="pr-guide-form">
          <label className="pr-guide-field">
            <span>一句话结论</span>
            <textarea
              rows={2}
              value={draft.tldr}
              placeholder="它做了什么、凭什么"
              onChange={(event) => setDraft((current) => ({ ...current, tldr: event.target.value }))}
            />
          </label>
          <label className="pr-guide-field">
            <span>要解决的问题</span>
            <textarea
              rows={3}
              value={draft.problem}
              onChange={(event) => setDraft((current) => ({ ...current, problem: event.target.value }))}
            />
          </label>
          <label className="pr-guide-field">
            <span>方法</span>
            <textarea
              rows={4}
              value={draft.method}
              onChange={(event) => setDraft((current) => ({ ...current, method: event.target.value }))}
            />
          </label>
          <label className="pr-guide-field">
            <span>主要结论（一行一条）</span>
            <textarea
              rows={4}
              value={draft.findings}
              onChange={(event) => setDraft((current) => ({ ...current, findings: event.target.value }))}
            />
          </label>
          <label className="pr-guide-field">
            <span>局限（一行一条）</span>
            <textarea
              rows={3}
              value={draft.limitations}
              onChange={(event) => setDraft((current) => ({ ...current, limitations: event.target.value }))}
            />
          </label>
          <label className="pr-guide-field">
            <span>可复用点（一行一条）</span>
            <textarea
              rows={3}
              value={draft.reusable}
              onChange={(event) => setDraft((current) => ({ ...current, reusable: event.target.value }))}
            />
          </label>
          <div className="pr-guide-form-actions">
            <button type="button" className="pr-btn" data-primary disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="pr-btn" data-ghost disabled={saving} onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="pr-guide-body">
          <div className="pr-guide-tldr">
            <IconSpark size={13} />
            <div>
              {summary.tldr?.trim()
                ? <RichText text={summary.tldr} />
                : <span className="pr-guide-empty">还没有一句话结论，点「修改」补全或「重新生成」。</span>}
            </div>
          </div>

          <GuideSection label="要解决的问题">
            {summary.problem ? <RichText text={summary.problem} /> : <div className="pr-guide-empty">—</div>}
          </GuideSection>
          <GuideSection label="方法">
            {summary.method ? <RichText text={summary.method} /> : <div className="pr-guide-empty">—</div>}
          </GuideSection>
          <GuideSection label="主要结论">
            <GuideList items={findings} />
          </GuideSection>
          <GuideSection label="局限">
            <GuideList items={limitations} />
          </GuideSection>
          <GuideSection label="可复用点">
            <GuideList items={reusable} />
          </GuideSection>

          {related.length > 0 ? (
            <GuideSection label={`相关论文 · ${related.length}`}>
              <div className="pr-guide-related">
                {related.map((item) => (
                  <button
                    type="button"
                    className="pr-guide-related-row"
                    key={item.paperId}
                    onClick={() => onOpenPaper(item.paperId)}
                  >
                    <span className="pr-guide-related-title">{item.reason || item.paperId}</span>
                    <IconChevronRight size={12} />
                  </button>
                ))}
              </div>
            </GuideSection>
          ) : null}

          <div className="pr-guide-foot">
            <span>{summary.model ? `模型 ${summary.model}` : '未记录模型'}</span>
            {summary.createdAt ? <span>{when(summary.createdAt)}</span> : null}
            {summary.editedAt ? <span>手动修改于 {when(summary.editedAt)}</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}
