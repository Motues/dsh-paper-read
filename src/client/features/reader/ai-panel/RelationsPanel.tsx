import { EDGE_LABEL } from '../../../types.js'
import { IconLink } from '../../../components/ui.js'
import type { EdgeView } from '../../../types.js'

/**
 * The 关联 page: every edge this paper has, one card per related paper.
 *
 * It used to be a short footer on the notes tab, which hid most of the list and
 * mixed "annotations" with "papers this one is related to". Direction is only
 * spelled out for citations — for 同方法 the graph's from/to says nothing a
 * reader would care about, and labelling it "本文引用" would simply be wrong.
 */
export function RelationsPanel({
  relations,
  onOpenPaper,
  onShowGraph,
}: {
  relations: EdgeView[]
  onOpenPaper: (id: string) => void
  onShowGraph?: () => void
}) {
  if (relations.length === 0) {
    return (
      <div className="pr-rels" data-scroll>
        <div className="pr-empty">
          <IconLink size={18} />
          还没有关联。读完几篇之后会自动找出引用、同方法、延续与反驳关系。
        </div>
        {onShowGraph ? (
          <button type="button" className="pr-btn" data-sm onClick={onShowGraph}>打开关系图</button>
        ) : null}
      </div>
    )
  }
  return (
    <div className="pr-rels" data-scroll>
      <div className="pr-rels-summary">
        <span>{relations.length} 条关联</span>
        {onShowGraph ? (
          <button type="button" className="pr-btn" data-sm data-ghost onClick={onShowGraph}>
            在关系图中查看
          </button>
        ) : null}
      </div>
      {relations.map((edge) => (
        <button
          key={edge.id}
          type="button"
          className="pr-rel-mini"
          onClick={() => onOpenPaper(edge.paperId)}
          title={edge.title}
        >
          <span className="pr-rel-mini-head">
            <span className="pr-tag" data-accent>{EDGE_LABEL[edge.kind]}</span>
            {edge.kind === 'cites' ? (
              <span className="pr-rel-mini-dir">
                {edge.direction === 'out' ? '本文引用它' : '它引用本文'}
              </span>
            ) : null}
            {edge.year ? <span className="pr-rel-mini-year">{edge.year}</span> : null}
          </span>
          <span className="pr-rel-mini-title">{edge.title}</span>
          {edge.reason ? <span className="pr-rel-mini-why">{edge.reason}</span> : null}
        </button>
      ))}
    </div>
  )
}
