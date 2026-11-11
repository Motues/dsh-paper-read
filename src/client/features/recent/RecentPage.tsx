import { useMemo, useState } from 'react'
import type { Folder, Paper } from '../../types.js'
import { PageHead } from '../../components/PageHead.js'
import { PaperCard } from '../library/PaperCard.js'
import { PaperList } from '../library/PaperList.js'
import { IconClock, IconClose, IconGrid, IconList, IconPlus, IconSearch } from '../../components/ui.js'

export function RecentPage({
  papers,
  folders,
  loading,
  error,
  density,
  limit,
  onDensity,
  onOpen,
  onImport,
  onLibrary,
  onOrganize,
  onRetry,
}: {
  papers: Paper[]
  folders: Folder[]
  loading: boolean
  error: string | null
  density: 'grid' | 'list'
  limit: number
  onDensity: (density: 'grid' | 'list') => void
  onOpen: (id: string, page?: number) => void
  onImport: () => void
  onLibrary: () => void
  onOrganize: (paper: Paper) => void
  onRetry: () => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  // Recent is a short list (at most the configured limit), so filtering happens
  // in place instead of routing the user through the library's search state.
  const filtered = useMemo(() => {
    if (!needle) return papers
    return papers.filter((paper) => (
      paper.title.toLowerCase().includes(needle)
      || (paper.authorLine ?? '').toLowerCase().includes(needle)
      || (paper.tldr ?? '').toLowerCase().includes(needle)
      || paper.tags.some((tag) => tag.toLowerCase().includes(needle))
    ))
  }, [needle, papers])

  return (
    <div className="pr-page" data-scroll>
      <PageHead title="最近阅读" sub={`按最后一次打开时间排序，最多 ${limit} 篇`}>
        <div className="pr-seg" role="group" aria-label="视图密度">
          <button data-on={density === 'grid' || undefined} onClick={() => onDensity('grid')} title="卡片视图">
            <IconGrid size={14} />
          </button>
          <button data-on={density === 'list' || undefined} onClick={() => onDensity('list')} title="列表视图">
            <IconList size={14} />
          </button>
        </div>
        <label className="pr-search pr-recent-search">
          <IconSearch size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索最近阅读…"
            aria-label="搜索最近阅读"
          />
          {query ? (
            <button
              type="button"
              className="pr-field-clear"
              title="清空搜索"
              aria-label="清空搜索"
              onClick={() => setQuery('')}
            >
              <IconClose size={12} />
            </button>
          ) : null}
        </label>
      </PageHead>

      {loading ? (
        <div className="pr-empty-state">载入文献库…</div>
      ) : error ? (
        <div className="pr-empty-state">
          文献库读不出来：{error}
          <button className="pr-btn" onClick={onRetry}>重试</button>
        </div>
      ) : papers.length === 0 ? (
        <div className="pr-empty-state pr-empty-lg">
          <IconClock size={26} />
          <b>还没有阅读记录</b>
          <span>读过一篇论文之后，它会出现在这里，点一下就从上次那一页继续。</span>
          <div className="pr-empty-actions">
            <button className="pr-btn" data-primary onClick={onImport}>
              <IconPlus size={14} />
              导入论文
            </button>
            <button className="pr-btn" onClick={onLibrary}>打开文献库</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="pr-empty-state pr-empty-lg">
          <IconSearch size={24} />
          <b>没有匹配的论文</b>
          <span>最近阅读里没有标题、作者或标签包含「{query.trim()}」的记录。</span>
          <div className="pr-empty-actions">
            <button className="pr-btn" onClick={() => setQuery('')}>清空搜索</button>
          </div>
        </div>
      ) : density === 'grid' ? (
        <div className="pr-grid">
          {filtered.map((paper) => (
            <PaperCard
              key={paper.id}
              paper={paper}
              folderName={folders.find((entry) => entry.id === paper.folder)?.name}
              onOpen={() => onOpen(paper.id, paper.lastReadPage ?? undefined)}
              onOrganize={() => onOrganize(paper)}
            />
          ))}
        </div>
      ) : (
        <PaperList
          papers={filtered}
          folders={folders}
          onOpen={(id) => onOpen(id)}
          onOrganize={onOrganize}
        />
      )}
    </div>
  )
}
