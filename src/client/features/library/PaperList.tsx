import type { CSSProperties, ReactNode } from 'react'
import type { Folder, Paper } from '../../types.js'
import { STATUS_LABEL } from '../../types.js'
import { IconMore } from '../../components/ui.js'

/** Extra data made available to every column renderer. */
export type PaperListContext = {
  folderName?: string
}

/**
 * One column of the literature library's list view.
 *
 * Add an entry to `PAPER_LIST_COLUMNS` (or pass a custom `columns` array) and
 * both the header and every row pick it up automatically; `track` is the CSS
 * grid track used for that column, so widths stay proportional and fluid.
 */
export type PaperListColumn = {
  key: string
  label: string
  /** CSS grid track, e.g. `'minmax(0, 2fr)'` or `'64px'`. */
  track: string
  align?: 'start' | 'end'
  /** Plain text is truncated with an ellipsis by the cell wrapper. */
  render: (paper: Paper, context: PaperListContext) => ReactNode
}

export const PAPER_LIST_COLUMNS: PaperListColumn[] = [
  {
    key: 'title',
    label: '标题',
    track: 'minmax(0, 2.2fr)',
    render: (paper) => paper.title || '未命名',
  },
  {
    key: 'authors',
    label: '作者',
    track: 'minmax(0, 1.8fr)',
    render: (paper) => paper.authorLine || '—',
  },
  {
    key: 'year',
    label: '时间',
    track: 'minmax(58px, 0.4fr)',
    render: (paper) => (paper.year ? String(paper.year) : '—'),
  },
  {
    key: 'venue',
    label: '出版物',
    track: 'minmax(0, 1.25fr)',
    render: (paper) => paper.venue || '—',
  },
  {
    key: 'status',
    label: '状态',
    track: 'minmax(88px, 0.5fr)',
    render: (paper) => {
      const flag = paper.missing
        ? null
        : !paper.hasFullText
          ? paper.pdfUnavailable === 'auth' ? '需上传' : '无全文'
          : null
      return (
        <span
          className="pr-status-cell"
          title={flag
            ? paper.pdfUnavailable === 'auth'
              ? '该 PDF 需要登录或订阅，请下载后上传'
              : '还没有 PDF 全文'
            : undefined}
        >
          <span className="pr-dot" data-s={paper.missing ? 'missing' : paper.status} />
          <span className="pr-status-label">
            {paper.missing ? '文件缺失' : STATUS_LABEL[paper.status]}
          </span>
          {flag ? (
            <span
              className="pr-card-flag"
              data-auth={paper.pdfUnavailable === 'auth' ? '1' : undefined}
            >
              {flag}
            </span>
          ) : null}
        </span>
      )
    },
  },
]

/**
 * Default list view for the literature library.
 *
 * Columns are data-driven: to add one later, append a `PaperListColumn` to
 * `PAPER_LIST_COLUMNS` (or pass `columns`) — header, cells, and grid tracks are
 * all derived from that definition.
 */
export function PaperList({
  papers,
  folders,
  columns = PAPER_LIST_COLUMNS,
  onOpen,
  onOrganize,
}: {
  papers: Paper[]
  folders: Folder[]
  columns?: PaperListColumn[]
  onOpen: (id: string) => void
  onOrganize: (paper: Paper) => void
}) {
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
  // One extra narrow track keeps the organize action aligned without making it
  // part of the user-configurable data columns.
  const style = {
    '--pr-list-cols': `${columns.map((column) => column.track).join(' ')} 30px`,
  } as CSSProperties

  return (
    <div className="pr-list" style={style}>
      <div className="pr-list-head">
        {columns.map((column) => (
          <span className="pr-list-head-cell" data-align={column.align} key={column.key}>
            {column.label}
          </span>
        ))}
        <span className="pr-list-head-cell" aria-hidden="true" />
      </div>
      {papers.map((paper) => {
        const context: PaperListContext = {
          folderName: paper.folder ? folderNames.get(paper.folder) : undefined,
        }
        return (
          <div
            className="pr-row"
            key={paper.id}
            data-status={paper.status}
            onClick={() => onOpen(paper.id)}
          >
            {columns.map((column) => (
              <span
                className="pr-list-cell"
                data-col={column.key}
                data-align={column.align}
                key={column.key}
              >
                {column.render(paper, context)}
              </span>
            ))}
            <button
              className="pr-icon-btn pr-row-action"
              title="整理"
              onClick={(event) => {
                event.stopPropagation()
                onOrganize(paper)
              }}
            >
              <IconMore size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
