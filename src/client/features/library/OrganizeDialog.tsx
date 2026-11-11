import { useEffect, useMemo, useState } from 'react'
import type { Folder, Paper } from '../../types.js'
import {
  IconClose,
  IconFile,
  IconFolder,
  IconTrash,
} from '../../components/ui.js'
import { Select } from '../../components/Select.js'

export function OrganizeDialog({
  paper,
  folders,
  onClose,
  onMove,
  onTags,
  onDelete,
}: {
  paper: Paper
  folders: Folder[]
  onClose: () => void
  onMove: (folder: string | null) => void
  onTags: (tags: string[]) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addTag = () => {
    const value = draft.trim().replace(/^#/, '')
    if (!value) return
    if (paper.tags.includes(value)) {
      setDraft('')
      return
    }
    onTags([...paper.tags, value].slice(0, 12))
    setDraft('')
  }

  /**
   * The picker carries the same hierarchy as the rail: `未分类` first, then a
   * depth-first walk of the folder tree. `depth` drives the indent; `path`
   * disambiguates same-named folders in search results.
   */
  const options = useMemo(() => {
    const ids = new Set(folders.map((folder) => folder.id))
    const byParent = new Map<string | null, Folder[]>()
    for (const folder of folders) {
      const parentId = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null
      const siblings = byParent.get(parentId) ?? []
      siblings.push(folder)
      byParent.set(parentId, siblings)
    }
    const out: Array<{ id: string | null; name: string; depth: number; path: string; parentPath: string }> = [
      { id: null, name: '未分类', depth: 0, path: '未分类', parentPath: '' },
    ]
    const seen = new Set<string>()
    const walk = (parentId: string | null, depth: number, ancestors: string[]): void => {
      for (const folder of byParent.get(parentId) ?? []) {
        if (seen.has(folder.id)) continue
        seen.add(folder.id)
        const path = [...ancestors, folder.name].join(' / ')
        out.push({ id: folder.id, name: folder.name, depth, path, parentPath: ancestors.join(' / ') })
        walk(folder.id, depth + 1, [...ancestors, folder.name])
      }
    }
    walk(null, 0, [])
    return out
  }, [folders])

  const selectOptions = options.map((option) => ({
    value: option.id ?? '',
    label: option.name,
    title: option.path,
    ...(option.id !== null && option.parentPath ? { hint: option.parentPath } : {}),
    depth: option.depth,
    icon: option.id === null ? <IconFile size={13} /> : <IconFolder size={13} />,
  }))

  return (
    <div className="pr-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="pr-dialog" data-narrow role="dialog" aria-modal="true" aria-label="整理论文">
        <div className="pr-dlg-head" data-stacked>
          <div className="pr-dlg-head-row">
            <div className="pr-dlg-icon">
              <IconFolder size={15} />
            </div>
            <b>整理论文</b>
            <div className="pr-spacer" />
            <button className="pr-btn" data-icon data-ghost title="关闭" onClick={onClose}>
              <IconClose size={15} />
            </button>
          </div>
          <div className="pr-dlg-title" title={paper.title}>{paper.title}</div>
        </div>

        <div className="pr-dlg-body">
          <div className="pr-field-label" style={{ marginBottom: 6 }}>放进文件夹</div>
          <Select
            value={paper.folder ?? ''}
            options={selectOptions}
            ariaLabel="放进文件夹"
            searchable
            searchPlaceholder="搜索文件夹…"
            menuMinWidth={260}
            onChange={(next) => onMove(next || null)}
          />
          {folders.length === 0 ? (
            <div className="pr-panel-note" style={{ marginTop: 8 }}>
              还没有文件夹，先去侧边栏「文献库」新建一个。
            </div>
          ) : null}

          <div className="pr-field-label" style={{ margin: '14px 0 6px' }}>标签</div>
          <div className="pr-tag-edit">
            {paper.tags.map((name) => (
              <button className="pr-tag" data-removable key={name} onClick={() => onTags(paper.tags.filter((item) => item !== name))}>
                #{name}
                <IconClose size={10} />
              </button>
            ))}
            <input
              value={draft}
              placeholder="加标签，回车确认"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag()
                }
              }}
              onBlur={addTag}
            />
          </div>

          <div className="pr-dlg-foot" data-inline>
            <span
              className="pr-dlg-foot-note"
              title="移入回收站后不会立刻删除，可在「文献库 → 回收站」里还原。"
            >
              <IconTrash size={11} />
              移入回收站可还原
            </span>
            <button
              className="pr-btn"
              data-sm
              data-danger
              data-solid
              onClick={() => {
                if (confirmDelete) onDelete()
                else {
                  setConfirmDelete(true)
                  window.setTimeout(() => setConfirmDelete(false), 2600)
                }
              }}
            >
              <IconTrash size={12} />
              {confirmDelete ? '确认移入回收站' : '移入回收站'}
            </button>
            <button className="pr-btn" data-sm data-primary onClick={onClose}>完成</button>
          </div>
        </div>
      </div>
    </div>
  )
}
