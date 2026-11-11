/** The right-hand column: overview, or one paper's relations and AI insight. */

import type {
  Paper,
  RelationGraph,
  RelationGraphEdge,
  RelationInsight,
  SearchHit,
} from '../../types.js'
import { KIND_META } from './palette.js'
import { ConfidenceBar, EmptyBlock, KindBadge, SignalChips, StatBlock, metaLine } from './parts.js'
import type { LineageHit, NeighbourRank } from './relevance.js'
import { IconChevronRight, IconClose, IconFile, IconLink, IconSparkLink } from '../../components/ui.js'

export interface InspectorProps {
  graph: RelationGraph
  papers: Map<string, Paper>
  selectedId: string | null
  insight: RelationInsight | null
  insightLoading: boolean
  hits: SearchHit[] | null
  hitsFor: string
  rebuilding: boolean
  /** Focus ranking and prior/derivative lists, computed from the graph. */
  ranks: NeighbourRank[]
  lineage: { prior: LineageHit[]; derivative: LineageHit[] }
  onSelect: (id: string | null) => void
  onOpen: (id: string, page?: number) => void
  onFeedback: (edge: RelationGraphEdge, action: 'accept' | 'reject') => void
  onFilterCluster: (clusterId: string) => void
  onInsight: (refresh?: boolean) => void
  onRebuild: () => void
  onSearchHit: (hit: SearchHit) => void
}

function otherSide(edge: RelationGraphEdge, paperId: string): string {
  return edge.from === paperId ? edge.to : edge.from
}

function directionText(edge: RelationGraphEdge, paperId: string): string {
  const meta = KIND_META[edge.kind]
  if (!meta.directed) return ''
  const verb = edge.kind === 'cites' ? '引用' : edge.kind === 'uses' ? '应用' : '基于'
  return edge.from === paperId ? `本文${verb}它` : `它${verb}本文`
}

function RelationRow({
  edge,
  paperId,
  title,
  year,
  onSelect,
  onOpen,
  onFeedback,
}: {
  edge: RelationGraphEdge
  paperId: string
  title: string
  year?: number
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onFeedback: (edge: RelationGraphEdge, action: 'accept' | 'reject') => void
}) {
  const other = otherSide(edge, paperId)
  const direction = directionText(edge, paperId)
  return (
    <div className="pr-rel-row2" data-status={edge.status}>
      <div className="pr-rel-row2-head">
        <KindBadge kind={edge.kind} status={edge.status} />
        {direction ? <span className="pr-rel-dir">{direction}</span> : null}
        <span className="pr-spacer" />
        <ConfidenceBar value={edge.confidence} status={edge.status} />
      </div>
      <button type="button" className="pr-rel-row2-title" title={title} onClick={() => onSelect(other)}>
        {title}
        {year ? <em>{year}</em> : null}
      </button>
      {edge.reason ? <p className="pr-rel-reason">{edge.reason}</p> : null}
      <div className="pr-rel-row2-foot">
        <SignalChips signals={edge.signals} evidence={edge.evidence} />
        <span className="pr-spacer" />
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
    </div>
  )
}

export function Inspector({
  graph,
  papers,
  selectedId,
  insight,
  insightLoading,
  hits,
  hitsFor,
  rebuilding,
  ranks,
  lineage,
  onSelect,
  onOpen,
  onFeedback,
  onFilterCluster,
  onInsight,
  onRebuild,
  onSearchHit,
}: InspectorProps) {
  const paper = selectedId ? papers.get(selectedId) : undefined
  const node = selectedId ? graph.nodes.find((item) => item.id === selectedId) : undefined
  const cluster = node ? graph.clusters.find((item) => item.id === node.cluster) : undefined
  const edges = selectedId ? graph.edges.filter((edge) => edge.from === selectedId || edge.to === selectedId) : []
  const rankOf = new Map(ranks.map((rank) => [rank.id, rank.score]))
  const focusKey = selectedId ?? ''
  const related = [...edges].sort((left, right) => {
    const status = (left.status === 'confirmed' ? 0 : 1) - (right.status === 'confirmed' ? 0 : 1)
    if (status !== 0) return status
    // Within a status, "what to read next" beats raw confidence: it adds shared
    // neighbourhood and concept overlap to the edge's own confidence.
    const leftScore = rankOf.get(otherSide(left, focusKey)) ?? left.confidence
    const rightScore = rankOf.get(otherSide(right, focusKey)) ?? right.confidence
    return rightScore - leftScore
  })
  const titleOf = (id: string): string => graph.nodes.find((item) => item.id === id)?.title ?? papers.get(id)?.title ?? id
  const yearOf = (id: string): number | undefined => papers.get(id)?.year ?? graph.nodes.find((item) => item.id === id)?.year

  const searchBlock = hits !== null ? (
    <section className="pr-insp-section">
      <div className="pr-insp-head">
        <h3>跨库命中</h3>
        <span className="pr-insp-count">{hits.length}</span>
      </div>
      {hits.length === 0 ? (
        <p className="pr-insp-hint">“{hitsFor}” 没有命中全文、批注或笔记。</p>
      ) : (
        <div className="pr-hit-list">
          {hits.map((hit, index) => (
            <button type="button" className="pr-hit" key={`${hit.paperId}-${index}`} onClick={() => onSearchHit(hit)}>
              <span className="pr-hit-head">
                <IconFile size={12} />
                <b>{hit.title}</b>
                <em>第 {hit.page} 页</em>
              </span>
              <span className="pr-hit-quote">{hit.quote}</span>
              {hit.reason ? <span className="pr-hit-reason">{hit.reason}</span> : null}
            </button>
          ))}
        </div>
      )}
      <p className="pr-insp-hint">回车检索会跑遍全文、批注和笔记，结果按模型重排。</p>
    </section>
  ) : null

  if (!node || !selectedId) {
    const confirmedAll = graph.edges.filter((edge) => edge.status === 'confirmed')
    // The overview should not be four citations: show the typed relations first,
    // then fill the remaining slots with the strongest citations.
    const semantic = confirmedAll.filter((edge) => edge.kind !== 'cites').slice(0, 2)
    const citations = confirmedAll.filter((edge) => edge.kind === 'cites').slice(0, Math.max(0, 4 - semantic.length))
    const confirmed = [...semantic, ...citations]
    const pending = graph.edges.filter((edge) => edge.status === 'suggested').slice(0, 5)
    const isolated = graph.nodes.filter((item) => item.isolated).slice(0, 5)
    return (
      <aside className="pr-insp" data-scroll>
        <div className="pr-insp-head">
          <h2>全库概览</h2>
          <span className="pr-insp-sub">{metaLine([graph.stats.papers, '篇论文', `${graph.stats.edges} 条关联`])}</span>
        </div>

        <div className="pr-stats">
          <StatBlock label="论文" value={graph.stats.papers} />
          <StatBlock label="已确认" value={graph.stats.confirmed} hint="置信度 ≥ 0.62" />
          <StatBlock label="待确认" value={graph.stats.suggested} hint="置信度不足，等你判断" />
          <StatBlock label="覆盖率" value={`${Math.round(graph.stats.coverage * 100)}%`} hint="至少一条已确认关联的论文占比" />
        </div>

        {!graph.stats.ai ? (
          <div className="pr-insp-banner">
            <IconLink size={13} />
            {graph.stats.aiDisabled
              ? 'AI 功能已关闭：现在只显示引用与文本相似度。去「系统设置 → 模型」开启后可生成画像与理由。'
              : '未配置模型：现在只显示引用与文本相似度。去「系统设置」选一个模型后可生成画像与理由。'}
          </div>
        ) : null}

        {graph.stats.papers === 0 ? (
          <EmptyBlock title="还没有论文" text="导入 PDF 或粘贴 DOI/arXiv 后，这里会自动长出关系图。" />
        ) : graph.edges.length === 0 ? (
          <EmptyBlock
            title="还没有关联"
            text={graph.stats.ai ? '点「重建关联」，先用引用与文本信号找候选，再由模型判定。' : '引用与文本相似度还没有找到足够接近的论文。'}
            action={<button type="button" className="pr-btn" data-primary disabled={rebuilding} onClick={onRebuild}>{rebuilding ? '重建中…' : '重建关联'}</button>}
          />
        ) : (
          <>
            <section className="pr-insp-section">
              <div className="pr-insp-head">
                <h3>最可信的关联</h3>
                <span className="pr-insp-count">{confirmed.length}</span>
              </div>
              {confirmed.length === 0 ? <p className="pr-insp-hint">还没有达到 0.62 的关联，先看待确认。</p> : null}
              {confirmed.map((edge) => (
                <button type="button" key={edge.id} className="pr-pair" onClick={() => onSelect(edge.from)}>
                  <span className="pr-pair-head">
                    <KindBadge kind={edge.kind} compact />
                    <ConfidenceBar value={edge.confidence} status={edge.status} />
                  </span>
                  <span className="pr-pair-titles">
                    {titleOf(edge.from)} <em>→</em> {titleOf(edge.to)}
                  </span>
                  <span className="pr-pair-reason">{edge.reason}</span>
                </button>
              ))}
            </section>

            {pending.length > 0 ? (
              <section className="pr-insp-section">
                <div className="pr-insp-head">
                  <h3>待确认</h3>
                  <span className="pr-insp-count">{graph.stats.suggested}</span>
                </div>
                {pending.map((edge) => (
                  <RelationRow
                    key={edge.id}
                    edge={edge}
                    paperId={edge.from}
                    title={titleOf(edge.to)}
                    year={yearOf(edge.to)}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    onFeedback={onFeedback}
                  />
                ))}
              </section>
            ) : null}

            <section className="pr-insp-section">
              <div className="pr-insp-head"><h3>主题</h3></div>
              <div className="pr-cluster-list">
                {graph.clusters.map((item) => (
                  <button type="button" className="pr-cluster-row" key={item.id} onClick={() => onFilterCluster(item.id)}>
                    <i style={{ background: item.color < 0 ? 'var(--pr-ink-3)' : `var(--pr-g${item.color + 1})` }} />
                    <b>{item.label}</b>
                    <span>{item.paperIds.length}</span>
                  </button>
                ))}
              </div>
            </section>

            {isolated.length > 0 ? (
              <section className="pr-insp-section">
                <div className="pr-insp-head"><h3>未连上</h3><span className="pr-insp-count">{graph.stats.isolated}</span></div>
                <div className="pr-cluster-list">
                  {isolated.map((item) => (
                    <button type="button" className="pr-cluster-row" key={item.id} onClick={() => onSelect(item.id)}>
                      <i style={{ background: 'var(--pr-ink-3)' }} />
                      <b>{item.title}</b>
                      <span>{item.year ?? ''}</span>
                    </button>
                  ))}
                </div>
                <p className="pr-insp-hint">孤独的论文通常是新导入，或与现有主题没有实质关系。</p>
              </section>
            ) : null}
          </>
        )}

        {searchBlock}
      </aside>
    )
  }

  const pending = related.filter((edge) => edge.status === 'suggested')
  const confirmed = related.filter((edge) => edge.status === 'confirmed')

  return (
    <aside className="pr-insp" data-scroll>
      <div className="pr-insp-focus">
        <button type="button" className="pr-insp-back" onClick={() => onSelect(null)} title="回到全库概览">
          <IconClose size={13} />
          全库概览
        </button>
        {cluster ? (
          <button type="button" className="pr-cluster-pill" onClick={() => onFilterCluster(cluster.id)}>
            <i style={{ background: cluster.color < 0 ? 'var(--pr-ink-3)' : `var(--pr-g${cluster.color + 1})` }} />
            {cluster.label}
          </button>
        ) : null}
      </div>

      <h2 className="pr-insp-title">{paper?.title ?? node.title}</h2>
      <div className="pr-insp-meta">
        {metaLine([paper?.year ?? node.year, paper?.venue ?? node.venue, `${node.degree} 条关联`])}
      </div>
      {paper && paper.tags.length > 0 ? (
        <div className="pr-insp-tags">
          {paper.tags.map((tag) => <span className="pr-tag" key={tag}>#{tag}</span>)}
          {node.duplicateOf ? <span className="pr-tag" data-warn>疑似重复</span> : null}
        </div>
      ) : null}
      <div className="pr-insp-actions">
        <button type="button" className="pr-btn" data-primary onClick={() => onOpen(node.id)}>
          <IconFile size={12} />
          打开阅读
        </button>
        {paper && !paper.hasSummary ? <span className="pr-insp-hint">还没有导读，导入时自动生成。</span> : null}
      </div>

      <section className="pr-insight" data-loading={insightLoading || undefined}>
        <div className="pr-insight-head">
          <IconSparkLink size={13} />
          <b>AI 关联综述</b>
          <span className="pr-spacer" />
          <button
            type="button"
            className="pr-btn"
            data-sm
            data-ghost
            disabled={insightLoading || !graph.stats.ai}
            onClick={() => onInsight(true)}
          >
            {insightLoading ? '生成中…' : '重新生成'}
          </button>
        </div>
        {insightLoading && !insight ? (
          <div className="pr-insight-skeleton"><i /><i /><i /></div>
        ) : insight ? (
          <>
            <p className="pr-insight-text">{insight.text}</p>
            {insight.bullets.length > 0 ? (
              <ul className="pr-insight-bullets">
                {insight.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
              </ul>
            ) : null}
            <span className="pr-insight-foot">
              {insight.model || '未记录模型'} · {new Date(insight.createdAt).toLocaleDateString()}
              {insight.stale ? ' · 关联已变化，建议重新生成' : ''}
            </span>
          </>
        ) : (
          <p className="pr-insp-hint">
            {graph.stats.ai ? '还没有生成。点「重新生成」让模型读一遍这篇的邻居。' : '未配置模型，生成不了关联综述。'}
          </p>
        )}
      </section>

      {ranks.length > 0 ? (
        <section className="pr-insp-section">
          <div className="pr-insp-head">
            <h3>最相关</h3>
            <span className="pr-insp-count">{ranks.length}</span>
          </div>
          <div className="pr-rank-list">
            {ranks.slice(0, 5).map((rank, index) => (
              <button type="button" className="pr-rank-row" key={rank.id} onClick={() => onSelect(rank.id)}>
                <b>{index + 1}</b>
                <span className="pr-rank-title">{titleOf(rank.id)}</span>
                <em>{yearOf(rank.id) ?? ''}</em>
                <span className="pr-rank-score" title="相对相关度：以这一组里最强的一篇为 100">
                  {Math.round((rank.score / (ranks[0]?.score || 1)) * 100)}
                </span>
              </button>
            ))}
          </div>
          <p className="pr-insp-hint">按「读下一篇」排序：置信度、共同邻居与概念重叠的加权，不是概率。</p>
        </section>
      ) : null}

      {lineage.prior.length > 0 || lineage.derivative.length > 0 ? (
        <section className="pr-insp-section">
          <div className="pr-insp-head"><h3>来路与去向</h3></div>
          <div className="pr-lineage">
            <div className="pr-lineage-col">
              <span className="pr-lineage-label">前置工作</span>
              {lineage.prior.length === 0 ? <em className="pr-lineage-empty">库内没有</em> : lineage.prior.map((hit) => (
                <button type="button" className="pr-lineage-row" key={hit.id} onClick={() => onSelect(hit.id)}>
                  <span>{titleOf(hit.id)}</span>
                  <b>×{hit.count}</b>
                </button>
              ))}
            </div>
            <div className="pr-lineage-col">
              <span className="pr-lineage-label">后续工作</span>
              {lineage.derivative.length === 0 ? <em className="pr-lineage-empty">库内没有</em> : lineage.derivative.map((hit) => (
                <button type="button" className="pr-lineage-row" key={hit.id} onClick={() => onSelect(hit.id)}>
                  <span>{titleOf(hit.id)}</span>
                  <b>×{hit.count}</b>
                </button>
              ))}
            </div>
          </div>
          <p className="pr-insp-hint">前置 = 这篇与它的邻居共同引用（按次数）；后续 = 库内引用了这篇的论文。</p>
        </section>
      ) : null}

      <section className="pr-insp-section">
        <div className="pr-insp-head">
          <h3>关联</h3>
          <span className="pr-insp-count">{related.length}</span>
        </div>
        {related.length === 0 ? (
          <EmptyBlock title="还没有关联" text="它可能是新导入的，或者主题与库内其他论文不同。" />
        ) : (
          <>
            {confirmed.map((edge) => (
              <RelationRow
                key={edge.id}
                edge={edge}
                paperId={node.id}
                title={titleOf(otherSide(edge, node.id))}
                year={yearOf(otherSide(edge, node.id))}
                onSelect={onSelect}
                onOpen={onOpen}
                onFeedback={onFeedback}
              />
            ))}
            {pending.length > 0 ? (
              <>
                <div className="pr-insp-subhead">待确认 {pending.length}</div>
                {pending.map((edge) => (
                  <RelationRow
                    key={edge.id}
                    edge={edge}
                    paperId={node.id}
                    title={titleOf(otherSide(edge, node.id))}
                    year={yearOf(otherSide(edge, node.id))}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    onFeedback={onFeedback}
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </section>

      {searchBlock}
    </aside>
  )
}
