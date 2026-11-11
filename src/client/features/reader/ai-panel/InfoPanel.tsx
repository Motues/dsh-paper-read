import { useEffect, useState, type ReactNode } from 'react'
import type { PaperDetail, PaperMetadataPatch } from '../../../types.js'
import { RichText } from '../../../components/ui.js'

type MetadataDraft = {
  title: string
  authors: string
  year: string
  venue: string
  abstract: string
  doi: string
  arxivId: string
  pmid: string
}

function draftOf(detail: PaperDetail): MetadataDraft {
  return {
    title: detail.title ?? '',
    authors: (detail.authors ?? []).join(', '),
    year: detail.year ? String(detail.year) : '',
    venue: detail.venue ?? '',
    abstract: detail.abstract ?? '',
    doi: detail.doi ?? '',
    arxivId: detail.arxivId ?? '',
    pmid: detail.pmid ?? '',
  }
}

function authorsOf(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value.split(/[,，;；\n]/)) {
    const name = item.trim().slice(0, 120)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out.slice(0, 30)
}

/** The paper metadata tab: abstract, identifiers and captured references. */
export function InfoPanel({
  detail,
  saving,
  onSave,
  onToast,
}: {
  detail: PaperDetail
  saving: boolean
  onSave: (patch: PaperMetadataPatch) => Promise<void>
  onToast: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MetadataDraft>(() => draftOf(detail))

  useEffect(() => {
    if (!editing) setDraft(draftOf(detail))
  }, [detail, editing])

  const startEdit = () => {
    setDraft(draftOf(detail))
    setEditing(true)
  }

  const save = async () => {
    if (saving) return
    const title = draft.title.trim()
    if (!title) {
      onToast('标题不能为空')
      return
    }
    const yearText = draft.year.trim()
    let year: number | null = null
    if (yearText) {
      const parsed = Number(yearText)
      if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 2100) {
        onToast('年份需要在 1000–2100 之间')
        return
      }
      year = parsed
    }
    try {
      await onSave({
        title,
        authors: authorsOf(draft.authors),
        year,
        venue: draft.venue.trim() || null,
        abstract: draft.abstract.trim() || null,
        doi: draft.doi.trim() || null,
        arxivId: draft.arxivId.trim() || null,
        pmid: draft.pmid.trim() || null,
      })
      setEditing(false)
    } catch (error) {
      onToast((error as Error).message)
    }
  }

  const references = detail.references ?? []
  const rows: Array<{ label: string; value: ReactNode }> = []
  if (detail.authors.length > 0) rows.push({ label: '作者', value: detail.authors.join(', ') })
  if (detail.venue) rows.push({ label: '期刊 / 会议', value: detail.venue })
  if (detail.year) rows.push({ label: '年份', value: String(detail.year) })
  if (detail.doi) {
    rows.push({
      label: 'DOI',
      value: (
        <a href={`https://doi.org/${detail.doi}`} target="_blank" rel="noreferrer">{detail.doi}</a>
      ),
    })
  }
  if (detail.arxivId) {
    rows.push({
      label: 'arXiv',
      value: (
        <a href={`https://arxiv.org/abs/${detail.arxivId}`} target="_blank" rel="noreferrer">{detail.arxivId}</a>
      ),
    })
  }
  if (detail.pmid) {
    rows.push({
      label: 'PMID',
      value: (
        <a href={`https://pubmed.ncbi.nlm.nih.gov/${detail.pmid}/`} target="_blank" rel="noreferrer">{detail.pmid}</a>
      ),
    })
  }
  if (detail.sourceUrl) {
    rows.push({
      label: '来源',
      value: (
        <a href={detail.sourceUrl} target="_blank" rel="noreferrer" title={detail.sourceUrl}>{detail.sourceUrl}</a>
      ),
    })
  }

  return (
    <div className="pr-info" data-scroll>
      <div className="pr-info-head">
        <div className="pr-info-heading">
          <b>文献信息</b>
          <span>手动补全或修正元数据</span>
        </div>
        {!editing ? (
          <button type="button" className="pr-btn" data-sm data-ghost onClick={startEdit}>
            编辑
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="pr-info-form">
          <label className="pr-info-field">
            <span>标题</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="pr-info-field">
            <span>作者（逗号分隔）</span>
            <input
              value={draft.authors}
              placeholder="Alice Smith, Bob Jones"
              onChange={(event) => setDraft((current) => ({ ...current, authors: event.target.value }))}
            />
          </label>
          <div className="pr-info-form-row">
            <label className="pr-info-field">
              <span>年份</span>
              <input
                inputMode="numeric"
                value={draft.year}
                placeholder="2026"
                onChange={(event) => setDraft((current) => ({ ...current, year: event.target.value }))}
              />
            </label>
            <label className="pr-info-field">
              <span>期刊 / 会议</span>
              <input
                value={draft.venue}
                onChange={(event) => setDraft((current) => ({ ...current, venue: event.target.value }))}
              />
            </label>
          </div>
          <label className="pr-info-field">
            <span>摘要</span>
            <textarea
              rows={5}
              value={draft.abstract}
              placeholder="支持 $...$ 与 $$...$$ 公式"
              onChange={(event) => setDraft((current) => ({ ...current, abstract: event.target.value }))}
            />
          </label>
          <div className="pr-info-form-row">
            <label className="pr-info-field">
              <span>DOI</span>
              <input
                value={draft.doi}
                placeholder="10.xxxx/..."
                onChange={(event) => setDraft((current) => ({ ...current, doi: event.target.value }))}
              />
            </label>
            <label className="pr-info-field">
              <span>arXiv</span>
              <input
                value={draft.arxivId}
                placeholder="1706.03762"
                onChange={(event) => setDraft((current) => ({ ...current, arxivId: event.target.value }))}
              />
            </label>
            <label className="pr-info-field">
              <span>PMID</span>
              <input
                value={draft.pmid}
                placeholder="26017442"
                onChange={(event) => setDraft((current) => ({ ...current, pmid: event.target.value }))}
              />
            </label>
          </div>
          <div className="pr-info-form-actions">
            <button type="button" className="pr-btn" data-primary disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="pr-btn" data-ghost disabled={saving} onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          {detail.abstract ? (
            <div className="pr-info-block">
              <div className="pr-info-label">摘要</div>
              <div className="pr-info-abstract"><RichText text={detail.abstract} /></div>
            </div>
          ) : (
            <div className="pr-info-block">
              <div className="pr-info-label">摘要</div>
              <div className="pr-info-empty">还没有摘要，点右上角「编辑」补全。</div>
            </div>
          )}

          {rows.length > 0 ? (
            <div className="pr-info-block">
              <div className="pr-info-label">元数据</div>
              <div className="pr-info-rows">
                {rows.map((row) => (
                  <div className="pr-info-row" key={row.label}>
                    <span className="pr-info-key">{row.label}</span>
                    <span className="pr-info-value">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="pr-info-block">
        <div className="pr-info-label">
          参考文献 <span>{references.length}</span>
        </div>
        <div className="pr-info-note">自动抓取，可能不完整。</div>
        {references.length === 0 ? (
          <div className="pr-info-empty">还没有抓取到参考文献。</div>
        ) : (
          <ol className="pr-refs">
            {references.map((reference, index) => {
              const meta = [
                reference.authors?.slice(0, 3).join(', '),
                reference.venue,
                reference.year,
              ].filter(Boolean).join(' · ')
              return (
                <li className="pr-ref" key={`${reference.doi ?? reference.title ?? reference.raw ?? 'ref'}-${index}`}>
                  <div className="pr-ref-title">{reference.title ?? reference.raw ?? '未命名参考文献'}</div>
                  {meta ? <div className="pr-ref-meta">{meta}</div> : null}
                  {reference.doi ? (
                    <a className="pr-ref-link" href={`https://doi.org/${reference.doi}`} target="_blank" rel="noreferrer">
                      {reference.doi}
                    </a>
                  ) : reference.pmid ? (
                    <a className="pr-ref-link" href={`https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}/`} target="_blank" rel="noreferrer">
                      PMID {reference.pmid}
                    </a>
                  ) : reference.url ? (
                    <a className="pr-ref-link" href={reference.url} target="_blank" rel="noreferrer">链接</a>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
