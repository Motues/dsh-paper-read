import type { Paper } from '../../types.js'
import { STATUS_LABEL } from '../../types.js'
import { relativeTime } from '../../lib/format.js'
import { IconMore } from '../../components/ui.js'

/**
 * The one card shared by 最近阅读 and 文献库（卡片视图）.
 *
 * Four rows, top to bottom:
 *   1. small meta row — status (left) ←→ `year · venue` (right)
 *   2. title
 *   3. authors
 *   4. small footer — folder + tags (left) ←→ progress bar + last-read time (right)
 *
 * The old tldr block and the "第 N 页" readout are gone on purpose: the page
 * position now lives in the progress bar, and both views must look identical.
 */
export function PaperCard({
  paper,
  fresh,
  folderName,
  onOpen,
  onOrganize,
}: {
  paper: Paper
  fresh?: boolean
  folderName?: string
  onOpen: () => void
  onOrganize: () => void
}) {
  const status = paper.missing ? 'missing' : paper.status
  const meta = [paper.year ? String(paper.year) : '', paper.venue ?? ''].filter(Boolean).join(' · ')
  const lastRead = paper.lastReadAt ? relativeTime(paper.lastReadAt) : ''
  const flag = paper.missing
    ? null
    : !paper.hasFullText
      ? paper.pdfUnavailable === 'auth' ? '需上传 PDF' : '无全文'
      : null

  return (
    <article className="pr-card" data-status={status} onClick={onOpen}>
      <div className="pr-card-top">
        <span className="pr-card-state">
          <span className="pr-dot" data-s={status} />
          <span className="pr-card-state-label">{paper.missing ? '文件缺失' : STATUS_LABEL[paper.status]}</span>
        </span>
        {flag ? (
          <span
            className="pr-card-flag"
            data-auth={paper.pdfUnavailable === 'auth' ? '1' : undefined}
            title={paper.pdfUnavailable === 'auth' ? '该 PDF 需要登录或订阅，请下载后上传' : '还没有 PDF 全文'}
          >
            {flag}
          </span>
        ) : null}
        {fresh ? <span className="pr-new">刚刚导入</span> : null}
        {meta ? <span className="pr-card-meta" title={meta}>{meta}</span> : null}
        <button
          className="pr-icon-btn pr-card-more"
          title="整理"
          onClick={(event) => {
            event.stopPropagation()
            onOrganize()
          }}
        >
          <IconMore size={13} />
        </button>
      </div>
      <div className="pr-card-title">{paper.title}</div>
      {paper.authorLine ? <div className="pr-card-authors">{paper.authorLine}</div> : null}
      <div className="pr-card-foot">
        <div className="pr-tags">
          {folderName ? <span className="pr-tag" data-group title={folderName}>{folderName}</span> : null}
          {paper.tags.slice(0, 2).map((name) => (
            <span className="pr-tag" key={name} title={name}>{name}</span>
          ))}
        </div>
        <div
          className="pr-card-read"
          title={lastRead ? `已读 ${paper.progress}% · 上次阅读 ${lastRead}` : '还没有阅读记录'}
        >
          <div className="pr-bar">
            <i style={{ width: `${paper.progress}%` }} />
          </div>
          <span className="pr-card-time">{lastRead || '未读'}</span>
        </div>
      </div>
    </article>
  )
}
