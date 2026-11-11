/** The list mode: papers on the left, relations on the right, same filter state. */

import { AnimatePresence, motion } from 'motion/react'
import type { Paper, RelationGraph, RelationGraphEdge, RelationGraphNode } from '../../types.js'
import { KIND_META } from './palette.js'
import { ConfidenceBar, EmptyBlock, KindBadge, SignalChips, metaLine } from './parts.js'
import { IconChevronRight, IconFile } from '../../components/ui.js'

export interface RelationListProps {
  graph: RelationGraph
  nodes: RelationGraphNode[]
  edges: RelationGraphEdge[]
  papers: Map<string, Paper>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpen: (id: string) => void
  onFeedback: (edge: RelationGraphEdge, action: 'accept' | 'reject') => void
}

function otherSide(edge: RelationGraphEdge, paperId: string): string {
  return edge.from === paperId ? edge.to : edge.from
}

function fallbackName(id: string, graph: RelationGraph): string {
  return graph.nodes.find((node) => node.id === id)?.title ?? id
}

function ListRow({
  edge,
  perspective,
  graph,
  papers,
  onSelect,
  onOpen,
  onFeedback,
}: {
  edge: RelationGraphEdge
  perspective: string | null
  graph: RelationGraph
  papers: Map<string, Paper>
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onFeedback: (edge: RelationGraphEdge, action: 'accept' | 'reject') => void
}) {
  const other = perspective ? otherSide(edge, perspective) : edge.to
  const paper = papers.get(other)
  const fromPaper = papers.get(edge.from)
  const toPaper = papers.get(edge.to)
  const fromTitle = fromPaper?.title ?? fallbackName(edge.from, graph)
  const toTitle = toPaper?.title ?? fallbackName(edge.to, graph)
  const title = paper?.title ?? fallbackName(other, graph)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="pr-lrow"
      data-status={edge.status}
    >
      <button type="button" className="pr-lrow-main" onClick={() => onSelect(other)}>
        <span className="pr-lrow-head">
          <KindBadge kind={edge.kind} status={edge.status} compact />
          {perspective ? (
            <span className="pr-lrow-title">{title}</span>
          ) : (
            <span className="pr-lrow-title pr-lrow-pair">
              <span>{fromTitle}</span>
              <em>→</em>
              <span>{toTitle}</span>
            </span>
          )}
          <em>{perspective ? paper?.year : fromPaper?.year}</em>
        </span>
        {edge.reason ? <span className="pr-lrow-reason">{edge.reason}</span> : null}
        <span className="pr-lrow-foot">
          <SignalChips signals={edge.signals} evidence={edge.evidence} limit={2} />
          <span className="pr-spacer" />
          <ConfidenceBar value={edge.confidence} status={edge.status} />
        </span>
      </button>
      <div className="pr-lrow-actions">
        {edge.status === 'suggested' ? (
          <>
            <button type="button" className="pr-btn" data-sm data-primary onClick={() => onFeedback(edge, 'accept')}>接受</button>
            <button type="button" className="pr-btn" data-sm data-ghost onClick={() => onFeedback(edge, 'reject')}>忽略</button>
          </>
        ) : (
          <button type="button" className="pr-btn" data-sm data-ghost onClick={() => onOpen(other)}>
            打开
            <IconChevronRight size={11} />
          </button>
        )}
      </div>
    </motion.div>
  )
}

export function RelationList({
  graph,
  nodes,
  edges,
  papers,
  selectedId,
  onSelect,
  onOpen,
  onFeedback,
}: RelationListProps) {
  const selected = selectedId ? nodes.find((node) => node.id === selectedId) ?? graph.nodes.find((node) => node.id === selectedId) : null
  const relevant = selectedId
    ? edges.filter((edge) => edge.from === selectedId || edge.to === selectedId)
    : edges
  const groups = Object.keys(KIND_META).map((kind) => ({
    kind: kind as keyof typeof KIND_META,
    list: relevant.filter((edge) => edge.kind === kind),
  })).filter((group) => group.list.length > 0)

  return (
    <div className="pr-list-grid">
      <div className="pr-list-papers" data-scroll>
        <div className="pr-rel-head">
          <h3>论文</h3>
          <span>{nodes.length}</span>
          {selectedId ? <button type="button" className="pr-btn" data-sm data-ghost onClick={() => onSelect(null)}>清除</button> : null}
        </div>
        {nodes.length === 0 ? (
          <EmptyBlock title="没有匹配的论文" text="换个关键词，或清掉筛选。" />
        ) : (
          <AnimatePresence initial={false}>
            {nodes.map((node) => {
              const paper = papers.get(node.id)
              const cluster = graph.clusters.find((item) => item.id === node.cluster)
              return (
                <motion.button
                  layout
                  key={node.id}
                  type="button"
                  className="pr-paper-row"
                  data-on={selectedId === node.id || undefined}
                  onClick={() => onSelect(node.id)}
                  onDoubleClick={() => onOpen(node.id)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.16 }}
                >
                  <i style={{ background: cluster && cluster.color >= 0 ? `var(--pr-g${cluster.color + 1})` : 'var(--pr-ink-3)' }} />
                  <span className="pr-paper-row-body">
                    <b>{paper?.title ?? node.title}</b>
                    <span className="pr-paper-row-meta">
                      {metaLine([paper?.year ?? node.year, paper?.venue ?? node.venue, `${node.degree} 条关联`])}
                    </span>
                    {paper?.tags?.length ? (
                      <span className="pr-paper-row-tags">{paper.tags.map((tag) => `#${tag}`).join(' ')}</span>
                    ) : null}
                  </span>
                  {node.duplicateOf ? <span className="pr-tag" data-warn>重复</span> : null}
                </motion.button>
              )
            })}
          </AnimatePresence>
        )}
      </div>

      <div className="pr-list-rels" data-scroll>
        <div className="pr-rel-head">
          <h3>{selected ? '这篇的关联' : '全部关联'}</h3>
          <span>{relevant.length}</span>
          {selected ? <button type="button" className="pr-btn" data-sm data-ghost onClick={() => onOpen(selected.id)}><IconFile size={11} />打开</button> : null}
        </div>
        {selected ? <div className="pr-list-focus">{selected.title}</div> : null}
        {relevant.length === 0 ? (
          <EmptyBlock title="没有关联" text={selectedId ? '这篇还没有和库里其他论文形成关系。' : '筛选条件下没有关联。'} />
        ) : (
          groups.map((group) => (
            <section className="pr-lgroup" key={group.kind}>
              <div className="pr-lgroup-head">
                <KindBadge kind={group.kind} compact />
                <span>{group.list.length}</span>
              </div>
              <AnimatePresence initial={false}>
                {group.list.map((edge) => (
                  <ListRow
                    key={edge.id}
                    edge={edge}
                    perspective={selectedId}
                    graph={graph}
                    papers={papers}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    onFeedback={onFeedback}
                  />
                ))}
              </AnimatePresence>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
