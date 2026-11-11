/**
 * Preview entry for the relation page screenshots.
 *
 * It is bundled by `scripts/preview-relations.mjs` with React included and a
 * mocked fetch, so the real page can be rendered in a headless browser without
 * a DSH host. Not part of the shipped plugin.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import type { Paper, RelationGraph, RelationInsight } from '../../src/client/types.js'
import { RelationsPage } from '../../src/client/features/relations/RelationsPage.js'
import { STYLES } from '../../src/client/theme/styles.js'
import { IconClock, IconGear, IconLibrary, IconPlus, IconSpark } from '../../src/client/components/ui.js'

interface PreviewConfig {
  scheme: 'light' | 'dark'
  focus: string | null
  mode: 'graph' | 'list'
  /** Render the same papers with no edges (checks the grid fallback). */
  empty?: boolean
}

interface PreviewData {
  graph: RelationGraph
  papers: Paper[]
}

declare global {
  interface Window {
    __PR_PREVIEW__?: PreviewConfig
    __PR_PREVIEW_DATA__?: PreviewData
  }
}

const config: PreviewConfig = window.__PR_PREVIEW__ ?? { scheme: 'light', focus: 'attn', mode: 'graph' }
const liveData = window.__PR_PREVIEW_DATA__

const paperData: Array<[string, string, number, string, string[], string]> = [
  ['attn', 'Attention Is All You Need', 2017, 'NeurIPS', ['Transformer', '序列建模'], '只用注意力就能在翻译任务上超过循环网络，而且更并行。'],
  ['lin', 'Linformer: Self-Attention with Linear Complexity', 2020, 'arXiv', ['线性注意力'], '把键值投影到低维，让自注意力从 O(n²) 降到 O(n)。'],
  ['perf', 'Rethinking Attention with Performers', 2021, 'ICLR', ['线性注意力', '核方法'], '用随机特征近似 softmax 核，线性复杂度且无近似误差累积。'],
  ['long', 'Longformer: The Long-Document Transformer', 2020, 'arXiv', ['稀疏注意力', '长文档'], '窗口加全局注意力的稀疏模式，把长文档建模成本降下来。'],
  ['flash', 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness', 2022, 'NeurIPS', ['注意力加速', 'GPU'], '按 IO 分块计算精确注意力，省显存也更快。'],
  ['retnet', 'Retentive Network: A Successor to Transformer for Large Language Models', 2023, 'arXiv', ['线性注意力', '语言模型'], '用保留机制统一并行训练与循环推理。'],
  ['rwkv', 'RWKV: Reinventing RNNs for the Transformer Era', 2023, 'EMNLP', ['线性注意力', 'RNN'], '线性注意力加循环状态，训练可并行、推理是常数内存。'],
  ['s4', 'Efficiently Modeling Long Sequences with Structured State Spaces', 2022, 'ICLR', ['状态空间模型', '长序列'], '结构化状态空间模型在超长序列上替代注意力。'],
  ['mamba', 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces', 2023, 'arXiv', ['状态空间模型', '长序列'], '让状态空间参数随输入变化，选择性建模长序列。'],
  ['ln', 'Advances in Bias Drift Mechanisms and Suppression Techniques for Thin-Film Lithium Niobate Electro-Optic Modulators', 2026, 'Laser & Photonics Reviews', ['铌酸锂', '电光调制'], '系统梳理薄膜铌酸锂调制器偏置漂移的成因与抑制路线。'],
  ['photonic', 'Photonic Matrix Multiplication with Thin-Film Lithium Niobate Modulators', 2024, 'Nature Photonics', ['铌酸锂', '光计算'], '用马赫-曾德尔阵列做片上光矩阵乘法。'],
  ['sensor', 'Biomimetic Olfactory Chips Based on Large-Scale Monolithically Integrated Nanotube Sensor Arrays', 2024, 'Nature Electronics', ['气体传感', '神经形态'], '用碳纳米管阵列做仿生嗅觉芯片。'],
]

const clusterOf: Record<string, string> = {}
for (const [id] of paperData.slice(0, 9)) clusterOf[id] = 'c1'
for (const [id] of paperData.slice(9, 11)) clusterOf[id] = 'c2'
clusterOf.sensor = 'solo'

const edges: Array<{
  from: string
  to: string
  kind: RelationGraph['edges'][number]['kind']
  reason: string
  confidence: number
  status: 'confirmed' | 'suggested'
  direction?: 'a2b' | 'b2a'
  evidence?: RelationGraph['edges'][number]['evidence']
}> = [
  { from: 'lin', to: 'attn', kind: 'cites', reason: '把自注意力近似成线性复杂度，直接接在 Transformer 之后', confidence: 0.98 },
  { from: 'perf', to: 'attn', kind: 'cites', reason: '用随机特征近似 softmax 注意力，替代原式', confidence: 0.97 },
  { from: 'long', to: 'attn', kind: 'cites', reason: '把全注意力改成窗口 + 全局的稀疏模式', confidence: 0.96 },
  { from: 'flash', to: 'attn', kind: 'cites', reason: '精确注意力本身不变，只重排 GPU 上的计算顺序', confidence: 0.97 },
  { from: 'retnet', to: 'attn', kind: 'cites', reason: '保留 Transformer 的并行训练形式，替换注意力', confidence: 0.95 },
  { from: 'rwkv', to: 'attn', kind: 'cites', reason: '用线性注意力替换 softmax 注意力', confidence: 0.94 },
  { from: 's4', to: 'attn', kind: 'cites', reason: '把注意力换成结构化状态空间递推', confidence: 0.93 },
  { from: 'mamba', to: 'attn', kind: 'cites', reason: '标题即声明线性时间序列建模，对照 Transformer', confidence: 0.95 },
  { from: 'lin', to: 'perf', kind: 'same-method', reason: '都属于线性注意力：把注意力计算压到 O(n)', confidence: 0.74 },
  { from: 'lin', to: 'retnet', kind: 'same-method', reason: '同一族线性化注意力，独立工作', confidence: 0.71 },
  { from: 'rwkv', to: 'retnet', kind: 'same-method', reason: '都用循环状态承载历史，训练时并行', confidence: 0.73 },
  { from: 'mamba', to: 's4', kind: 'builds-on', reason: '把 S4 的固定参数改成输入相关的选择性参数', confidence: 0.93, direction: 'a2b', evidence: { noteA: '选择性状态空间', noteB: '结构化状态空间' } },
  { from: 'mamba', to: 'flash', kind: 'same-problem', reason: '都在降低长序列注意力的显存与时间开销', confidence: 0.66 },
  { from: 'long', to: 'flash', kind: 'same-problem', reason: '一个改注意力模式，一个改 IO 调度，目标都是长上下文', confidence: 0.62 },
  { from: 'photonic', to: 'ln', kind: 'same-method', reason: '都基于薄膜铌酸锂平台做电光调制', confidence: 0.86, evidence: { sharedConcepts: ['薄膜铌酸锂', '电光调制'], sharedRefs: ['TFLN modulator review'] } },
  { from: 'mamba', to: 'rwkv', kind: 'same-problem', reason: '都在回答“如何在线性时间里保留长程依赖”', confidence: 0.44, status: 'suggested' },
  { from: 's4', to: 'flash', kind: 'same-problem', reason: '一个换建模方式、一个换计算顺序，都可缓解长序列瓶颈', confidence: 0.41, status: 'suggested' },
]

const kindCounts = edges.reduce<Record<string, number>>((counts, edge) => {
  counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
  return counts
}, {})

const degree = new Map<string, number>()
const weight = new Map<string, number>()
for (const edge of edges) {
  for (const id of [edge.from, edge.to]) {
    degree.set(id, (degree.get(id) ?? 0) + 1)
    weight.set(id, (weight.get(id) ?? 0) + edge.confidence)
  }
}

const graph: RelationGraph = {
  generatedAt: new Date().toISOString(),
  nodes: paperData.map(([id, title, year, venue, tags, tldr]) => ({
    id,
    title,
    year,
    venue,
    tldr,
    tags,
    cluster: clusterOf[id],
    degree: degree.get(id) ?? 0,
    weight: Math.round((weight.get(id) ?? 0) * 1000) / 1000,
    isolated: (degree.get(id) ?? 0) === 0,
    hasProfile: clusterOf[id] !== 'solo',
  })),
  edges: edges.map((edge) => ({
    id: `${edge.from}->${edge.to}:${edge.kind}`,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    reason: edge.reason,
    confidence: edge.confidence,
    status: edge.status ?? 'confirmed',
    direction: edge.direction ?? 'a2b',
    signals: {
      ref: edge.kind === 'cites' ? 0.62 : 0.18,
      concept: edge.kind === 'cites' ? 0.41 : 0.52,
      claim: 0.24,
      lexical: 0.31,
    },
    evidence: edge.evidence ?? { sharedConcepts: ['线性注意力', '长序列'], sharedRefs: ['Attention Is All You Need'] },
    origin: 'auto',
  })),
  clusters: [
    { id: 'c1', label: '线性序列建模', paperIds: paperData.slice(0, 9).map(([id]) => id), color: 0, aiNamed: true },
    { id: 'c2', label: '薄膜铌酸锂', paperIds: paperData.slice(9, 11).map(([id]) => id), color: 1, aiNamed: true },
    { id: 'solo', label: '未关联', paperIds: ['sensor'], color: -1, aiNamed: false },
  ],
  stats: {
    papers: paperData.length,
    hidden: 0,
    edges: edges.length,
    confirmed: edges.filter((edge) => (edge.status ?? 'confirmed') === 'confirmed').length,
    suggested: edges.filter((edge) => edge.status === 'suggested').length,
    isolated: 1,
    coverage: 11 / 12,
    ai: true,
  },
}

const papers: Paper[] = paperData.map(([id, title, year, venue, tags, tldr], index) => ({  id,
  title,
  authors: ['Chen Wang', 'Zhesi Chen'],
  authorLine: 'Chen Wang, Zhesi Chen',
  year,
  venue,
  tags,
  folder: null,
  status: index % 3 === 0 ? 'reading' : index % 3 === 1 ? 'done' : 'todo',
  progress: (index * 7) % 100,
  source: 'pdf',
  pageCount: 12 + index,
  addedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
  updatedAt: new Date(Date.now() - index * 3_600_000).toISOString(),
  tldr,
  hasFullText: true,
  hasSummary: clusterOf[id] !== 'solo',
}))

const isolatedGraph: RelationGraph = {
  ...graph,
  nodes: graph.nodes.map((node) => ({ ...node, cluster: 'solo', degree: 0, weight: 0, isolated: true })),
  edges: [],
  clusters: [{ id: 'solo', label: '未关联', paperIds: paperData.map(([id]) => id), color: -1, aiNamed: false }],
  stats: { ...graph.stats, hidden: 0, edges: 0, confirmed: 0, suggested: 0, isolated: paperData.length, coverage: 0 },
}

const insights: Record<string, RelationInsight> = {
  attn: {
    paperId: 'attn',
    text: '它是这个库里被引用最多的起点：Linformer、Performer、Longformer 与 FlashAttention 都在改写它的注意力计算，Mamba 则从状态空间一侧另起一条路线。它更像“共同祖先”，而不是某一支的最新进展。',
    bullets: [
      '被 8 篇论文直接引用，是整个线性序列簇的基线。',
      'Linformer / Performer / RetNet / RWKV 与它同属注意力路线。',
      'Mamba 经 S4 走向状态空间路线，与它的关系是替代而非继承。',
    ],
    model: 'deepseek-v4.1-flash',
    createdAt: new Date().toISOString(),
    stale: false,
  },
  mamba: {
    paperId: 'mamba',
    text: '它接着 S4 的线路，把固定状态空间参数改成输入相关，从而在长序列上既保留线性时间又具备选择性；与注意力一族的 Linformer / RetNet 是并行路线，而不是直接竞争。',
    bullets: [
      '直接扩展 S4：同一建模框架，换成选择性参数。',
      '与 FlashAttention 同属“缓解长序列开销”，但一个改建模范式、一个改计算顺序。',
      '目前是状态空间支线里唯一同时引用 S4 与 Transformer 的论文。',
    ],
    model: 'deepseek-v4.1-flash',
    createdAt: new Date().toISOString(),
    stale: false,
  },
}

const activePapers = liveData?.papers ?? papers

const library = {
  papers: activePapers,
  folders: [],
  trash: [],
  unfiled: activePapers.length,
  tags: [],
  counts: { all: activePapers.length, todo: 4, reading: 4, done: 4, recent: 0, trash: 0 },
}

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  const json = (body: unknown): Response => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  if (url.includes('/relations/graph')) return json(config.empty ? isolatedGraph : liveData?.graph ?? graph)
  if (url.includes('/relations/insights/')) {
    const id = decodeURIComponent(url.split('/relations/insights/')[1]?.split('?')[0] ?? '')
    return json({ insight: insights[id] ?? null })
  }
  if (url.includes('/relations/rebuild')) return json({ jobId: 'job-preview' })
  if (url.includes('/relations/feedback')) return json({ ok: true, edge: null })
  if (url.includes('/search')) return json({ query: '', hits: [], reranked: false })
  if (url.includes('/papers')) return json(library)
  if (url.includes('/config')) return json({})
  return json({})
}) as typeof fetch

const style = document.createElement('style')
style.textContent = `
${STYLES}
html, body, #root { height: 100%; margin: 0; }
body { background: ${config.scheme === 'dark' ? '#141518' : '#f6f7f9'}; }
.pr-preview-stage { height: 100%; }
`
document.head.append(style)

if (config.scheme === 'dark') {
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.style.setProperty('--dsw-alias-bg-base', '#141518')
  document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', '#1c1d21')
  document.documentElement.style.setProperty('--dsw-alias-bg-layer-2', '#24262b')
  document.documentElement.style.setProperty('--dsw-alias-bg-overlay', '#202126')
  document.documentElement.style.setProperty('--dsw-alias-border-l1', '#2e3037')
  document.documentElement.style.setProperty('--dsw-alias-border-l2', '#3c3f48')
  document.documentElement.style.setProperty('--dsw-alias-label-primary', '#e8eaee')
  document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#a5abb6')
  document.documentElement.style.setProperty('--dsw-alias-label-tertiary', '#737985')
  document.documentElement.style.setProperty('--dsw-alias-state-business-primary', '#7aaaff')
} else {
  document.documentElement.style.setProperty('--dsw-alias-bg-base', '#f6f7f9')
  document.documentElement.style.setProperty('--dsw-alias-bg-layer-1', '#ffffff')
  document.documentElement.style.setProperty('--dsw-alias-bg-layer-2', '#f1f2f5')
  document.documentElement.style.setProperty('--dsw-alias-bg-overlay', '#ffffff')
  document.documentElement.style.setProperty('--dsw-alias-border-l1', '#e4e6ea')
  document.documentElement.style.setProperty('--dsw-alias-border-l2', '#d3d6dc')
  document.documentElement.style.setProperty('--dsw-alias-label-primary', '#1c2027')
  document.documentElement.style.setProperty('--dsw-alias-label-secondary', '#5c6472')
  document.documentElement.style.setProperty('--dsw-alias-label-tertiary', '#8b93a1')
  document.documentElement.style.setProperty('--dsw-alias-state-business-primary', '#4176e6')
}

function NavItem({ icon, label, count, active }: { icon: React.ReactNode; label: string; count?: number; active?: boolean }) {
  return (
    <button className="pr-nav-item" data-on={active || undefined}>
      {icon}
      {label}
      {count !== undefined ? <span className="pr-nav-count">{count}</span> : null}
    </button>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <div className="pr-preview-stage">
    <div className="pr-root" data-scheme={config.scheme} style={{ height: '100%' }}>
      <div className="pr-shell">
        <aside className="pr-nav">
          <button className="pr-btn pr-nav-import" data-primary>
            <IconPlus size={14} />
            导入论文
          </button>
          <hr className="pr-nav-sep" />
          <nav className="pr-nav-group">
            <NavItem icon={<IconClock size={15} />} label="最近阅读" count={9} />
            <NavItem icon={<IconLibrary size={15} />} label="文献库" count={12} />
            <NavItem icon={<IconSpark size={15} />} label="关联" active />
            <NavItem icon={<IconGear size={15} />} label="系统设置" />
          </nav>
        </aside>
        <main className="pr-content">
          <RelationsPage
            papers={activePapers}
            focusId={config.focus}
            initialMode={config.mode}
            onOpen={() => {}}
            onToast={() => {}}
          />
        </main>
      </div>
    </div>
  </div>,
)

void kindCounts
