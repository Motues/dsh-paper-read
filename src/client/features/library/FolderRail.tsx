import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import type { Folder } from '../../types.js'
import {
  IconChevronRight,
  IconCollapseAll,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLibrary,
  IconMoreDots,
  IconPencil,
  IconPlus,
  IconSearch,
  IconClose,
  IconTag,
  IconTrash,
  IconUpload,
} from '../../components/ui.js'
import type { FolderFilter } from './LibraryPage.js'
import { PaneResizer } from '../../components/PaneResizer.js'
import { usePaneSize } from '../../lib/pane-size.js'

const EXPANDED_KEY = 'paperreader.folder-expanded'

function readExpanded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

interface FolderMenu {
  id: string
  top: number
  left: number
}

/** Where a dragged folder would land on the hovered row. */
type DropZone = 'before' | 'inside' | 'after'

interface DropTarget {
  id: string
  zone: DropZone
}

/**
 * The library's folder rail, modelled on DSH's workspace sidebar:
 * a nested tree where clicking a folder selects it and toggles its children,
 * the leading folder glyph becomes the expand arrow on hover, hover exposes
 * "more" and "import into this folder", dragging a row reorders siblings or
 * reparents it, and renaming happens in place. Papers never appear here —
 * they live in the content pane.
 */
export function FolderRail({
  folders,
  total,
  unfiled,
  trashCount,
  tags,
  tag,
  selected,
  query,
  onSelect,
  onTag,
  onQuery,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onImportInto,
}: {
  folders: Folder[]
  total: number
  unfiled: number
  trashCount: number
  tags: Array<{ tag: string; count: number }>
  tag: string | null
  selected: FolderFilter
  query: string
  onSelect: (folder: FolderFilter) => void
  onTag: (tag: string | null) => void
  onQuery: (query: string) => void
  onCreate: (name: string, parentId: string | null) => Promise<boolean>
  onRename: (folder: Folder, name: string) => Promise<void>
  onDelete: (folder: Folder) => Promise<void>
  onMove: (folder: Folder, parentId: string | null, beforeId: string | null) => Promise<void>
  onImportInto: (folder: Folder) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [draft, setDraft] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menu, setMenu] = useState<FolderMenu | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const pane = usePaneSize('folders')
  const searchRef = useRef<HTMLInputElement>(null)
  const searchRootRef = useRef<HTMLDivElement>(null)
  const confirmTimer = useRef<number | null>(null)
  // Enter and blur can both fire for the same edit; these guard double submits.
  const submitting = useRef(false)
  const createCancelled = useRef(false)
  const renameCancelled = useRef(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* private mode / quota: expansion simply stops persisting */
    }
  }, [expanded])

  useEffect(() => () => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
  }, [])

  // Focus the inline search as soon as the header icon opens it.
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  const closeSearch = useCallback(() => {
    searchRef.current?.blur()
    onQuery('')
    setSearchOpen(false)
  }, [onQuery])

  // Any click outside the search field collapses it (and clears the shared
  // filter). The toggle lives inside that field, so its own click never counts.
  useEffect(() => {
    if (!searchOpen) return
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (searchRootRef.current?.contains(target)) return
      closeSearch()
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [closeSearch, searchOpen])

  const byParent = useMemo(() => {
    const ids = new Set(folders.map((folder) => folder.id))
    const map = new Map<string | null, Folder[]>()
    for (const folder of folders) {
      const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null
      const list = map.get(parent) ?? []
      list.push(folder)
      map.set(parent, list)
    }
    return map
  }, [folders])

  const needle = query.trim().toLowerCase()

  // While searching, keep matching folders and every ancestor, expanded.
  const visible = useMemo(() => {
    if (!needle) return null
    const out = new Set<string>()
    const seen = new Set<string>()
    const visit = (folder: Folder): boolean => {
      if (seen.has(folder.id)) return false
      seen.add(folder.id)
      const children = byParent.get(folder.id) ?? []
      let hit = folder.name.toLowerCase().includes(needle)
      for (const child of children) {
        if (visit(child)) hit = true
      }
      if (hit) out.add(folder.id)
      return hit
    }
    for (const root of byParent.get(null) ?? []) visit(root)
    return out
  }, [byParent, needle])

  // Selecting a folder (from a chip or elsewhere) reveals its ancestors; the
  // folder's own state belongs to the row click, which toggles it.
  useEffect(() => {
    if (selected === 'all' || selected === 'unfiled' || selected === 'trash') return
    const chain: string[] = []
    const guard = new Set<string>()
    let parentId = folders.find((folder) => folder.id === selected)?.parentId ?? null
    while (parentId && !guard.has(parentId)) {
      guard.add(parentId)
      chain.push(parentId)
      parentId = folders.find((folder) => folder.id === parentId)?.parentId ?? null
    }
    if (chain.length === 0) return
    setExpanded((previous) => {
      if (chain.every((id) => previous.has(id))) return previous
      const next = new Set(previous)
      for (const id of chain) next.add(id)
      return next
    })
  }, [folders, selected])

  const closeMenu = useCallback(() => {
    setMenu(null)
    setConfirmDelete(null)
  }, [])

  // A click anywhere outside the popover closes it; so does any scroll.
  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-folder-menu]') || target?.closest('[data-folder-more]')) return
      closeMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [closeMenu, menu])

  const expand = (id: string) => {
    setExpanded((previous) => (previous.has(id) ? previous : new Set(previous).add(id)))
  }

  const toggle = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // One click both selects the folder and flips its branch, like DSH's
  // workspace row. A leaf folder has nothing to flip, so it only selects.
  const activate = (folder: Folder) => {
    onSelect(folder.id)
    if ((byParent.get(folder.id) ?? []).length > 0) toggle(folder.id)
  }

  /** Whether `candidate` is `rootId` or sits anywhere below it. */
  const isInSubtree = (candidate: string | null, rootId: string): boolean => {
    let current = candidate
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      if (current === rootId) return true
      seen.add(current)
      current = folders.find((folder) => folder.id === current)?.parentId ?? null
    }
    return false
  }

  /**
   * Resolve a hovered row + zone into the move the host should perform, or
   * null when the drop is a no-go (cycle, self, same-name sibling).
   */
  const resolveDrop = (
    draggedId: string,
    targetId: string,
    zone: DropZone,
  ): { parentId: string | null; beforeId: string | null } | null => {
    const dragged = folders.find((folder) => folder.id === draggedId)
    const target = folders.find((folder) => folder.id === targetId)
    if (!dragged || !target || dragged.id === target.id) return null
    const parentId = zone === 'inside' ? target.id : target.parentId ?? null
    if (isInSubtree(parentId, dragged.id)) return null
    const nameClash = folders.some((folder) => (
      folder.id !== dragged.id
      && (folder.parentId ?? null) === parentId
      && folder.name.toLowerCase() === dragged.name.toLowerCase()
    ))
    if (nameClash) return null
    let beforeId: string | null = null
    if (zone === 'before') {
      beforeId = target.id
    } else if (zone === 'after') {
      // Insert before the next sibling (excluding the dragged folder itself),
      // or append when the target is the last sibling.
      const siblings = (byParent.get(parentId) ?? []).filter((folder) => folder.id !== dragged.id)
      const index = siblings.findIndex((folder) => folder.id === target.id)
      beforeId = siblings[index + 1]?.id ?? null
    }
    return { parentId, beforeId }
  }

  const startDrag = (folder: Folder, event: DragEvent<HTMLDivElement>) => {
    if (editing === folder.id) {
      event.preventDefault()
      return
    }
    closeMenu()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', folder.id)
    setDragId(folder.id)
    setDropTarget(null)
  }

  const dragOverFolder = (folder: Folder, event: DragEvent<HTMLDivElement>) => {
    if (!dragId) return
    if (dragId === folder.id) {
      event.dataTransfer.dropEffect = 'none'
      setDropTarget((current) => (current === null ? current : null))
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
    const zone: DropZone = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
    if (!resolveDrop(dragId, folder.id, zone)) {
      event.dataTransfer.dropEffect = 'none'
      setDropTarget((current) => (current === null ? current : null))
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget((current) => (
      current && current.id === folder.id && current.zone === zone
        ? current
        : { id: folder.id, zone }
    ))
  }

  const dragLeaveFolder = (folder: Folder, event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    setDropTarget((current) => (current && current.id === folder.id ? null : current))
  }

  const dropOnFolder = (folder: Folder, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const draggedId = dragId
    const target = dropTarget
    setDragId(null)
    setDropTarget(null)
    if (!draggedId || !target || target.id !== folder.id) return
    const resolved = resolveDrop(draggedId, folder.id, target.zone)
    if (!resolved) return
    const dragged = folders.find((entry) => entry.id === draggedId)
    if (!dragged) return
    if (resolved.parentId) expand(resolved.parentId)
    void onMove(dragged, resolved.parentId, resolved.beforeId)
  }

  const endDrag = () => {
    setDragId(null)
    setDropTarget(null)
  }

  const openMenu = (folder: Folder, element: HTMLElement) => {
    if (menu?.id === folder.id) {
      closeMenu()
      return
    }
    const rect = element.getBoundingClientRect()
    setConfirmDelete(null)
    setMenu({
      id: folder.id,
      top: Math.min(rect.bottom + 4, window.innerHeight - 172),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 188)),
    })
  }

  const startRename = (folder: Folder) => {
    renameCancelled.current = false
    setEditing(folder.id)
    setEditDraft(folder.name)
    closeMenu()
  }

  const commitRename = (folder: Folder) => {
    if (renameCancelled.current) {
      renameCancelled.current = false
      setEditing(null)
      return
    }
    const value = editDraft.trim()
    setEditing(null)
    if (value && value !== folder.name) void onRename(folder, value)
  }

  const startCreate = (parentId: string | null) => {
    createCancelled.current = false
    setCreating({ parentId })
    setDraft('')
    closeMenu()
  }

  const submitCreate = async () => {
    if (!creating || submitting.current) return
    if (createCancelled.current) {
      createCancelled.current = false
      setCreating(null)
      return
    }
    const value = draft.trim()
    if (!value) {
      setCreating(null)
      return
    }
    submitting.current = true
    const target = creating.parentId
    try {
      const ok = await onCreate(value, target)
      if (ok) {
        if (target) expand(target)
        setDraft('')
        setCreating(null)
      }
    } finally {
      submitting.current = false
    }
  }

  const askDelete = (folder: Folder) => {
    if (confirmDelete === folder.id) {
      closeMenu()
      void onDelete(folder)
      return
    }
    setConfirmDelete(folder.id)
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    confirmTimer.current = window.setTimeout(() => setConfirmDelete(null), 3200)
  }

  const menuFolder = menu ? folders.find((folder) => folder.id === menu.id) : undefined

  const createRow = (parentId: string | null, depth: number) => {
    const style = { '--pr-depth': depth } as CSSProperties
    return (
      <div className="pr-tree-create" data-parent={parentId ?? 'root'} style={style} key="creator">
        <span className="pr-tree-glyph"><IconFolder size={14} /></span>
        <input
          autoFocus
          value={draft}
          placeholder={parentId ? '子文件夹名' : '文件夹名'}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void submitCreate()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitCreate()
            if (event.key === 'Escape') {
              createCancelled.current = true
              setCreating(null)
              setDraft('')
            }
          }}
        />
      </div>
    )
  }

  const renderFolder = (folder: Folder, depth: number): ReactNode => {
    const children = (byParent.get(folder.id) ?? [])
      .filter((child) => !visible || visible.has(child.id))
    const hasChildren = (byParent.get(folder.id) ?? []).length > 0
    if (visible && !visible.has(folder.id)) return null
    const open = Boolean(needle) ? true : expanded.has(folder.id)
    const style = { '--pr-depth': depth } as CSSProperties
    const isEditing = editing === folder.id
    const selectedHere = selected === folder.id
    const menuOpen = menu?.id === folder.id

    return (
      <div className="pr-tree-branch" key={folder.id}>
        <div
          className="pr-tree-row"
          data-on={selectedHere || undefined}
          data-open={open || undefined}
          data-branch={hasChildren || undefined}
          data-menu={menuOpen || undefined}
          data-dragging={dragId === folder.id || undefined}
          data-drop={dropTarget?.id === folder.id ? dropTarget.zone : undefined}
          draggable={!isEditing}
          onDragStart={(event) => startDrag(folder, event)}
          onDragOver={(event) => dragOverFolder(folder, event)}
          onDragLeave={(event) => dragLeaveFolder(folder, event)}
          onDrop={(event) => dropOnFolder(folder, event)}
          onDragEnd={endDrag}
          style={style}
        >
          {isEditing ? (
            <input
              className="pr-tree-input"
              autoFocus
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              onBlur={() => commitRename(folder)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  renameCancelled.current = true
                  setEditing(null)
                }
              }}
            />
          ) : (
            <>
              <button
                type="button"
                className="pr-tree-main"
                aria-expanded={hasChildren ? open : undefined}
                draggable={!isEditing}
                onClick={() => activate(folder)}
                title={folder.name}
              >
                <span className="pr-tree-glyph">
                  {open && hasChildren
                    ? <IconFolderOpen size={14} className="pr-tree-folder" />
                    : <IconFolder size={14} className="pr-tree-folder" />}
                  {hasChildren ? <IconChevronRight size={12} className="pr-tree-arrow" /> : null}
                </span>
                <span className="pr-tree-name">{folder.name}</span>
                <span className="pr-count">{folder.count}</span>
              </button>
              <div className="pr-tree-actions">
                <button
                  type="button"
                  className="pr-icon-btn"
                  data-folder-more
                  title="更多操作"
                  onClick={(event) => openMenu(folder, event.currentTarget)}
                >
                  <IconMoreDots size={14} />
                </button>
                <button
                  type="button"
                  className="pr-icon-btn"
                  title={`导入论文到「${folder.name}」`}
                  onClick={() => onImportInto(folder)}
                >
                  <IconUpload size={14} />
                </button>
              </div>
            </>
          )}
        </div>

        {menuOpen && menuFolder ? (
          <div
            className="pr-menu pr-tree-menu"
            data-folder-menu
            role="menu"
            style={{ position: 'fixed', top: menu.top, left: menu.left }}
          >
            <button role="menuitem" className="pr-menu-item" onClick={() => startRename(menuFolder)}>
              <IconPencil size={13} />
              重命名
            </button>
            <button role="menuitem" className="pr-menu-item" onClick={() => startCreate(folder.id)}>
              <IconFolderPlus size={13} />
              新建子文件夹
            </button>
            <div className="pr-menu-sep" />
            <button
              role="menuitem"
              className="pr-menu-item"
              data-danger
              data-confirm={confirmDelete === folder.id || undefined}
              onClick={() => askDelete(folder)}
            >
              <IconTrash size={13} />
              {confirmDelete === folder.id ? '再点一次确认' : '删除文件夹'}
            </button>
            <div className="pr-menu-note">删除整棵子树，论文回到未分类</div>
          </div>
        ) : null}

        {creating?.parentId === folder.id ? createRow(folder.id, depth + 1) : null}

        {hasChildren ? (
          <div
            className="pr-tree-children"
            data-open={open || undefined}
            aria-hidden={open ? undefined : true}
          >
            <div className="pr-tree-children-inner">
              {children.map((child) => renderFolder(child, depth + 1))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const roots = (byParent.get(null) ?? []).filter((folder) => !visible || visible.has(folder.id))

  return (
    <aside className="pr-folders" ref={pane.ref} style={{ width: pane.width }}>
      <div className="pr-lib-head">
        <div className="pr-lib-head-text">
          <h1>文献库</h1>
          <span className="pr-page-sub">{`${total} 篇 · ${folders.length} 个文件夹`}</span>
        </div>
      </div>

      <div className="pr-rail-special">
        <button
          type="button"
          className="pr-folder-row"
          data-on={selected === 'all' || undefined}
          onClick={() => onSelect('all')}
        >
          <IconLibrary size={14} />
          <span>全部</span>
          <span className="pr-count">{total}</span>
        </button>
        <button
          type="button"
          className="pr-folder-row"
          data-on={selected === 'unfiled' || undefined}
          onClick={() => onSelect('unfiled')}
        >
          <IconFile size={14} />
          <span>未分类</span>
          <span className="pr-count">{unfiled}</span>
        </button>
        <button
          type="button"
          className="pr-folder-row"
          data-on={selected === 'trash' || undefined}
          data-trash
          onClick={() => onSelect('trash')}
        >
          <IconTrash size={14} />
          <span>回收站</span>
          <span className="pr-count">{trashCount}</span>
        </button>
      </div>

      <div className="pr-rail-section" data-search-open={searchOpen || undefined}>
        <h2 className="pr-rail-title" data-hidden={searchOpen || undefined}>文件夹</h2>
        <div
          ref={searchRootRef}
          className="pr-rail-search"
          role="search"
          data-open={searchOpen || undefined}
          onClick={() => {
            if (!searchOpen) setSearchOpen(true)
          }}
        >
          <button
            type="button"
            className="pr-rail-search-toggle"
            title={searchOpen ? '关闭搜索' : '搜索'}
            aria-label={searchOpen ? '关闭搜索' : '搜索'}
            aria-expanded={searchOpen}
            onClick={() => {
              if (searchOpen) closeSearch()
              else setSearchOpen(true)
            }}
          >
            <IconSearch size={14} />
          </button>
          <input
            ref={searchRef}
            className="pr-rail-search-input"
            value={query}
            aria-label="搜索文件夹与论文"
            placeholder="搜索文件夹与论文…"
            tabIndex={searchOpen ? 0 : -1}
            aria-hidden={searchOpen ? undefined : true}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch()
            }}
          />
          <button
            type="button"
            className="pr-rail-search-clear"
            title="清空并收起"
            aria-label="清空并收起"
            data-show={searchOpen && query ? '' : undefined}
            tabIndex={searchOpen && query ? 0 : -1}
            aria-hidden={searchOpen && query ? undefined : true}
            onClick={closeSearch}
          >
            <IconClose size={11} />
          </button>
        </div>
        <div className="pr-rail-actions" data-hidden={searchOpen || undefined}>
          <button type="button" className="pr-icon-btn" title="新建文件夹" onClick={() => startCreate(null)}>
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            className="pr-icon-btn"
            title="全部折叠"
            onClick={() => setExpanded(new Set())}
          >
            <IconCollapseAll size={14} />
          </button>
        </div>
      </div>

      <div className="pr-tree" data-scroll>
        {creating?.parentId === null ? createRow(null, 0) : null}
        {roots.length === 0 ? (
          <div className="pr-tree-empty">{needle ? '没有匹配的文件夹' : '还没有文件夹'}</div>
        ) : null}
        {roots.map((folder) => renderFolder(folder, 0))}
      </div>

      <div className="pr-rail-tags">
        <div className="pr-rail-tags-head">
          <h2 className="pr-rail-title pr-rail-tags-title">标签</h2>
          <span className="pr-rail-tags-count">{tags.length}</span>
          {tag ? (
            <button
              type="button"
              className="pr-rail-tags-clear"
              title="清除标签筛选"
              onClick={() => onTag(null)}
            >
              清除
            </button>
          ) : null}
        </div>
        <div className="pr-rail-tags-list" data-scroll>
          {tags.length === 0 ? (
            <div className="pr-rail-tags-empty">还没有标签</div>
          ) : (
            tags.map((entry) => (
              <button
                type="button"
                key={entry.tag}
                className="pr-tag-row"
                data-on={tag === entry.tag || undefined}
                title={`按 #${entry.tag} 筛选`}
                onClick={() => onTag(tag === entry.tag ? null : entry.tag)}
              >
                <IconTag size={14} />
                <span className="pr-tag-name">#{entry.tag}</span>
                <span className="pr-count">{entry.count}</span>
              </button>
            ))
          )}
        </div>
      </div>
      <PaneResizer label="调整文件夹栏宽度" {...pane.handle} />
    </aside>
  )
}
