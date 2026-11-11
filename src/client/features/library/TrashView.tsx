import { useEffect, useMemo, useRef, useState } from 'react'
import type { Folder, Paper } from '../../types.js'
import { relativeTime } from '../../lib/format.js'
import { IconFile, IconRestore, IconTrash } from '../../components/ui.js'

/**
 * The recycle bin: soft-deleted papers keep their PDF and annotations until the
 * reader explicitly purges them (or empties the bin).
 */
export function TrashView({
  trash,
  folders,
  query,
  onRestore,
  onPurge,
  onEmpty,
}: {
  trash: Paper[]
  folders: Folder[]
  query: string
  onRestore: (paper: Paper) => void
  onPurge: (paper: Paper) => void
  onEmpty: () => void
}) {
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const purgeTimer = useRef<number | null>(null)
  const emptyTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (purgeTimer.current) window.clearTimeout(purgeTimer.current)
    if (emptyTimer.current) window.clearTimeout(emptyTimer.current)
  }, [])

  const folderNames = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders])
  const needle = query.trim().toLowerCase()
  const rows = needle
    ? trash.filter((paper) => paper.title?.toLowerCase().includes(needle) || (paper.authorLine ?? '').toLowerCase().includes(needle))
    : trash

  const askPurge = (paper: Paper) => {
    if (confirmPurge === paper.id) {
      setConfirmPurge(null)
      onPurge(paper)
      return
    }
    setConfirmPurge(paper.id)
    if (purgeTimer.current) window.clearTimeout(purgeTimer.current)
    purgeTimer.current = window.setTimeout(
      () => setConfirmPurge((current) => (current === paper.id ? null : current)),
      3200,
    )
  }

  return (
    <div className="pr-trash">
      <div className="pr-trash-head">
        <div className="pr-trash-title">
          <h2>回收站</h2>
          <span className="pr-page-sub">{`${trash.length} 篇 · 删除后仍保留 PDF、批注与导读`}</span>
        </div>
        <div className="pr-spacer" />
        {trash.length > 0 ? (
          <button
            type="button"
            className="pr-btn"
            data-sm
            data-danger
            data-ghost
            onClick={() => {
              if (confirmEmpty) {
                setConfirmEmpty(false)
                onEmpty()
                return
              }
              setConfirmEmpty(true)
              if (emptyTimer.current) window.clearTimeout(emptyTimer.current)
              emptyTimer.current = window.setTimeout(() => setConfirmEmpty(false), 3200)
            }}
          >
            <IconTrash size={12} />
            {confirmEmpty ? '再点一次清空' : '清空回收站'}
          </button>
        ) : null}
      </div>

      {trash.length === 0 ? (
        <div className="pr-empty-state pr-empty-lg">
          <IconTrash size={24} />
          <b>回收站是空的</b>
          <span>从文献库删除的论文会先放进这里，可以随时还原；彻底删除才会清掉它的 PDF 与批注。</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="pr-empty-state">没有匹配的论文。</div>
      ) : (
        <div className="pr-trash-list">
          {rows.map((paper) => (
            <div className="pr-trash-row" key={paper.id}>
              <span className="pr-trash-icon">
                <IconFile size={17} />
              </span>
              <div className="pr-trash-main">
                <b title={paper.title}>{paper.title || '未命名'}</b>
                <span className="pr-trash-meta">
                  {paper.folder ? folderNames.get(paper.folder) ?? '未分类' : '未分类'}
                  <i>·</i>
                  {paper.deletedAt ? `删除于 ${relativeTime(paper.deletedAt)}` : '已删除'}
                  {paper.tags.length > 0 ? <i>·</i> : null}
                  {paper.tags.slice(0, 3).map((name) => <em key={name}>#{name}</em>)}
                </span>
              </div>
              <div className="pr-trash-actions">
                <button type="button" className="pr-btn" data-sm onClick={() => onRestore(paper)}>
                  <IconRestore size={12} />
                  还原
                </button>
                <button
                  type="button"
                  className="pr-btn"
                  data-sm
                  data-danger
                  data-confirm={confirmPurge === paper.id || undefined}
                  onClick={() => askPurge(paper)}
                >
                  <IconTrash size={12} />
                  {confirmPurge === paper.id ? '确认彻底删除' : '彻底删除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
