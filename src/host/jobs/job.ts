/** A job's shape and the human labels for its pipeline steps. */

import type { Job, JobSource, JobStep } from '../../shared/domain.js'
import { newId, nowIso } from '../util/util.js'

export const STEP_LABELS = {
  identify: '识别文件',
  store: '写入文献库',
  parse: '解析 PDF',
  metadata: '补全元数据',
  chunk: '分块',
  summary: '生成导读',
  relations: '推断关联',
  index: '更新检索索引',
} as const

export type StepKey = keyof typeof STEP_LABELS

export const STEP_KEYS = Object.keys(STEP_LABELS) as StepKey[]

/** The rebuild pipeline's own steps; the queue keeps them in the same shape. */
export const RELATION_STEP_LABELS = {
  profiles: '生成论文画像',
  citations: '匹配引用',
  pairs: '计算相关度',
  judge: 'AI 判定',
  clusters: '主题聚类',
} as const

export const RELATION_STEP_KEYS = Object.keys(RELATION_STEP_LABELS) as Array<keyof typeof RELATION_STEP_LABELS>

export interface JobMeta {
  source: JobSource
  sourceLabel: string
  paperId: string | null
}

export interface StepSpec {
  key: string
  label: string
}

export function createJob(kind: string, meta: JobMeta, steps?: StepSpec[]): Job {
  const list: JobStep[] = (steps ?? STEP_KEYS.map((key) => ({ key, label: STEP_LABELS[key] }))).map((step) => ({
    key: step.key,
    label: step.label,
    state: 'pending',
  }))
  return {
    id: newId('job'),
    kind,
    state: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    steps: list,
    ...meta,
  }
}
