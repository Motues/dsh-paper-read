/** Shared visual vocabulary for the relation page: kinds, clusters, colours. */

import type { EdgeKind } from '../../types.js'

export interface KindMeta {
  label: string
  /** CSS custom property that holds the stroke colour. */
  color: string
  directed: boolean
  /** One-line explanation used by the legend and the filter tooltip. */
  hint: string
}

export const KIND_META: Record<EdgeKind, KindMeta> = {
  cites: { label: '引用', color: 'var(--pr-k-cites)', directed: true, hint: '参考文献里点名引用了对方' },
  'builds-on': { label: '基于', color: 'var(--pr-k-builds)', directed: true, hint: '同一问题上的直接改进或替换' },
  'same-method': { label: '同方法', color: 'var(--pr-k-method)', directed: false, hint: '同一方法族，彼此独立' },
  'same-problem': { label: '同问题', color: 'var(--pr-k-problem)', directed: false, hint: '同一问题，不同技术路线' },
  uses: { label: '应用', color: 'var(--pr-k-uses)', directed: true, hint: '借用对方的方法、数据或工具' },
  contradicts: { label: '相反', color: 'var(--pr-k-contra)', directed: false, hint: '结论或关键假设冲突' },
}

export const CLUSTER_TOKENS = [
  'var(--pr-g1)',
  'var(--pr-g2)',
  'var(--pr-g3)',
  'var(--pr-g4)',
  'var(--pr-g5)',
  'var(--pr-g6)',
] as const

export function clusterColor(color: number): string {
  if (color < 0) return 'var(--pr-ink-3)'
  return CLUSTER_TOKENS[color % CLUSTER_TOKENS.length]
}

export const CONFIRMED_AT = 0.62

export function statusLabel(status: string | undefined): string {
  if (status === 'suggested') return '待确认'
  if (status === 'rejected') return '已忽略'
  return '已确认'
}

export const SIGNAL_LABEL: Record<string, string> = {
  ref: '共同引用',
  concept: '概念重叠',
  claim: '结论相近',
  lexical: '文本相似',
  external: '外部推荐',
}
