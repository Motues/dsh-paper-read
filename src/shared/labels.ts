import type { EdgeKind, Status } from './domain.js'

export const STATUS_LABEL: Record<Status, string> = {
  todo: '待读',
  reading: '在读',
  done: '已读',
}

export const EDGE_LABEL: Record<EdgeKind, string> = {
  cites: '引用',
  'builds-on': '基于',
  'same-method': '同方法',
  'same-problem': '同问题',
  uses: '应用',
  contradicts: '相反',
}

/** Order the graph legend and the relation filter chips. */
export const EDGE_KINDS: EdgeKind[] = [
  'cites',
  'builds-on',
  'same-method',
  'same-problem',
  'uses',
  'contradicts',
]
