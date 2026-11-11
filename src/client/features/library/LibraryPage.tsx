import React, { useMemo } from 'react'
import type { Folder, Paper, Status } from '../../types.js'
import { PaperCard } from './PaperCard.js'
import { PaperList } from './PaperList.js'
import { FolderRail } from './FolderRail.js'
import { TrashView } from './TrashView.js'
import { Select } from '../../components/Select.js'
import {
  IconClose,
  IconFile,
  IconFolder,
  IconGrid,
  IconList,
  IconPlus,
  IconSearch,
} from '../../components/ui.js'

export type FolderFilter = 'all' | 'unfiled' | 'trash' | string

/** The library page: a DSH-style folder tree on the left, papers on the right. */
export function LibraryPage(props: {
  papers: Paper[]
  all: Paper[]
  folders: Folder[]
  trash: Paper[]
  unfiled: number
  tags: Array<{ tag: string; count: number }>
  counts: { all: number; todo: number; reading: number; done: number }
  folder: FolderFilter
  status: Status | 'all'
  tag: string | null
  query: string
  authors: Array<{ name: string; count: number }>
  years: number[]
  venues: Array<{ name: string; count: number }>
  author: string | null
  year: number | null
  venue: string | null
  density: 'grid' | 'list'
  loading: boolean
  error: string | null
  freshId: string | null
  searchRef: React.RefObject<HTMLInputElement>
  searching: boolean
  /** How many matches came from notes or PDF full text. */
  searchFullTextCount: number
  onFolder: (folder: FolderFilter) => void
  onStatus: (status: Status | 'all') => void
  onTag: (tag: string | null) => void
  onQuery: (query: string) => void
  onAuthor: (author: string | null) => void
  onYear: (year: number | null) => void
  onVenue: (venue: string | null) => void
  onClearFilters: () => void
  onDensity: (density: 'grid' | 'list') => void
  onOpen: (id: string, page?: number) => void
  onOrganize: (paper: Paper) => void
  onImport: () => void
  onImportInto: (folder: Folder) => void
  onCreateFolder: (name: string, parentId: string | null) => Promise<boolean>
  onRenameFolder: (folder: Folder, name: string) => Promise<void>
  onDeleteFolder: (folder: Folder) => Promise<void>
  onMoveFolder: (folder: Folder, parentId: string | null, beforeId: string | null) => Promise<void>
  onRestorePaper: (paper: Paper) => void
  onPurgePaper: (paper: Paper) => void
  onEmptyTrash: () => void
  onRetry: () => void
}) {
  const {
    papers, all, folders, trash, unfiled, tags, counts, folder, status, tag, query, density,
    authors, years, venues, author, year, venue, loading, error, freshId, searchRef,
    searching, searchFullTextCount,
  } = props
  const hasFilters = Boolean(author || year || venue)

  const selected = folder === 'all' || folder === 'unfiled' || folder === 'trash'
    ? null
    : folders.find((entry) => entry.id === folder) ?? null
  // A folder's own papers sit on the right; its children are chips you can drill into.
  const children = useMemo(
    () => (selected ? folders.filter((entry) => entry.parentId === selected.id) : []),
    [folders, selected],
  )

  return (
    <div className="pr-page" data-scroll>
      <div className="pr-lib">
        <FolderRail
          folders={folders}
          total={counts.all}
          unfiled={unfiled}
          trashCount={trash.length}
          tags={tags}
          tag={tag}
          selected={folder}
          query={query}
          onSelect={props.onFolder}
          onTag={props.onTag}
          onQuery={props.onQuery}
          onCreate={props.onCreateFolder}
          onRename={props.onRenameFolder}
          onDelete={props.onDeleteFolder}
          onMove={props.onMoveFolder}
          onImportInto={props.onImportInto}
        />

        <div className="pr-lib-main">
          <div className="pr-lib-toolbar">
            {folder !== 'trash' ? (
              <>
                <div className="pr-seg" role="group" aria-label="状态">
                  {(
                    [
                      ['all', '全部'],
                      ['todo', '待读'],
                      ['reading', '在读'],
                      ['done', '已读'],
                    ] as Array<[Status | 'all', string]>
                  ).map(([key, label]) => (
                    <button key={key} data-on={status === key || undefined} onClick={() => props.onStatus(key)}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="pr-spacer" />
            {folder !== 'trash' ? (
              <div className="pr-seg" role="group" aria-label="视图密度">
                <button data-on={density === 'grid' || undefined} onClick={() => props.onDensity('grid')} title="卡片视图">
                  <IconGrid size={14} />
                </button>
                <button data-on={density === 'list' || undefined} onClick={() => props.onDensity('list')} title="列表视图">
                  <IconList size={14} />
                </button>
              </div>
            ) : null}
            <label className="pr-search">
              <IconSearch size={14} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => props.onQuery(event.target.value)}
                placeholder={folder === 'trash' ? '搜索回收站…' : '搜索标题、作者、摘要、期刊、笔记、全文…'}
              />
              {query ? (
                <button className="pr-field-clear" title="清空" onClick={() => props.onQuery('')}>
                  <IconClose size={12} />
                </button>
              ) : (
                <span className="pr-kbd">Ctrl F</span>
              )}
            </label>
          </div>

          {folder !== 'trash' ? (
            <div className="pr-lib-filter-row">
              <span className="pr-lib-filter-label">筛选</span>
              <div className="pr-lib-filter">
                <Select
                  value={author ?? ''}
                  ariaLabel="按作者筛选"
                  size="sm"
                  options={[
                    { value: '', label: '全部作者' },
                    ...authors.map((entry) => ({ value: entry.name, label: `${entry.name}（${entry.count}）` })),
                  ]}
                  onChange={(next) => props.onAuthor(next || null)}
                />
              </div>
              <div className="pr-lib-filter" data-narrow>
                <Select
                  value={year === null ? '' : String(year)}
                  ariaLabel="按年份筛选"
                  size="sm"
                  options={[
                    { value: '', label: '全部年份' },
                    ...years.map((value) => ({ value: String(value), label: String(value) })),
                  ]}
                  onChange={(next) => props.onYear(Number(next) || null)}
                />
              </div>
              <div className="pr-lib-filter" data-wide>
                <Select
                  value={venue ?? ''}
                  ariaLabel="按期刊筛选"
                  size="sm"
                  options={[
                    { value: '', label: '全部期刊 / 会议' },
                    ...venues.map((entry) => ({ value: entry.name, label: `${entry.name}（${entry.count}）` })),
                  ]}
                  onChange={(next) => props.onVenue(next || null)}
                />
              </div>
              {hasFilters ? (
                <button type="button" className="pr-btn" data-sm data-ghost onClick={props.onClearFilters}>
                  清除筛选
                </button>
              ) : null}
              <div className="pr-spacer" />
              {query.trim() ? (
                <span className="pr-lib-search-state">
                  {searching ? '正在检索全文…' : searchFullTextCount > 0 ? `全文 / 笔记命中 ${searchFullTextCount} 篇` : '没有全文 / 笔记命中'}
                </span>
              ) : null}
            </div>
          ) : null}

          {folder !== 'trash' && children.length > 0 ? (
            <div className="pr-subfolders">
              <span className="pr-subfolders-label">
                <IconFolder size={12} />
                {children.length} 个子文件夹
              </span>
              {children.map((entry) => (
                <button
                  key={entry.id}
                  className="pr-chip pr-folder-chip"
                  onClick={() => props.onFolder(entry.id)}
                  title={`打开「${entry.name}」`}
                >
                  <IconFolder size={11} />
                  {entry.name}
                  <b>{entry.count}</b>
                </button>
              ))}
            </div>
          ) : null}

          {folder === 'trash' ? (
            <TrashView
              trash={trash}
              folders={folders}
              query={query}
              onRestore={props.onRestorePaper}
              onPurge={props.onPurgePaper}
              onEmpty={props.onEmptyTrash}
            />
          ) : loading ? (
            <div className="pr-empty-state">载入文献库…</div>
          ) : error ? (
            <div className="pr-empty-state">
              文献库读不出来：{error}
              <button className="pr-btn" onClick={props.onRetry}>重试</button>
            </div>
          ) : papers.length === 0 ? (
            <div className="pr-empty-state pr-empty-lg">
              <IconFile size={24} />
              <b>
                {all.length === 0
                  ? '文献库还是空的'
                  : children.length > 0
                    ? '这个文件夹还没有直属论文'
                    : '这个筛选下没有论文'}
              </b>
              <span>
                {all.length === 0
                  ? '导入一个 PDF 或链接，我会解析全文、生成导读，并把它和库里的其它论文连起来。'
                  : children.length > 0
                    ? '论文都在上方的子文件夹里；也可以把论文直接放进这个文件夹。'
                    : '换个文件夹、状态或标签再看看。'}
              </span>
              {all.length === 0 ? (
                <div className="pr-empty-actions">
                  <button className="pr-btn" data-primary onClick={props.onImport}>
                    <IconPlus size={14} />
                    导入论文
                  </button>
                </div>
              ) : null}
            </div>
          ) : density === 'grid' ? (
            <div className="pr-grid">
              {papers.map((paper) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  fresh={paper.id === freshId}
                  folderName={folders.find((entry) => entry.id === paper.folder)?.name}
                  onOpen={() => props.onOpen(paper.id)}
                  onOrganize={() => props.onOrganize(paper)}
                />
              ))}
            </div>
          ) : (
            <PaperList
              papers={papers}
              folders={folders}
              onOpen={props.onOpen}
              onOrganize={props.onOrganize}
            />
          )}
        </div>
      </div>
    </div>
  )
}
