/** Small presentational pieces shared by the inspector and the list view. */

import React from 'react'
import type { RelationEvidence, RelationGraphEdge, RelationSignals } from '../../types.js'
import { KIND_META, statusLabel } from './palette.js'

export function KindBadge({
  kind,
  status,
  compact = false,
}: {
  kind: RelationGraphEdge['kind']
  status?: RelationGraphEdge['status']
  compact?: boolean
}) {
  const meta = KIND_META[kind]
  return (
    <span
      className="pr-kbadge"
      data-kind={kind}
      data-status={status ?? 'confirmed'}
      data-compact={compact || undefined}
      title={meta.hint}
      style={{ ['--pr-kind' as string]: meta.color }}
    >
      <i className="pr-kdot" />
      {meta.label}
      {status === 'suggested' ? <em>待确认</em> : null}
    </span>
  )
}

export function SignalChips({
  signals,
  evidence,
  limit = 3,
}: {
  signals?: RelationSignals
  evidence?: RelationEvidence
  limit?: number
}) {
  const chips: Array<{ key: string; label: string }> = []
  const sharedConcepts = evidence?.sharedConcepts ?? []
  if (sharedConcepts.length > 0) chips.push({ key: 'concept', label: `共享概念 ${sharedConcepts.slice(0, 2).join('、')}` })
  const sharedRefs = evidence?.sharedRefs ?? []
  if (sharedRefs.length > 0) chips.push({ key: 'ref', label: `共同引用 ${sharedRefs.length} 篇` })
  else if ((signals?.ref ?? 0) >= 0.15) chips.push({ key: 'ref', label: `引用相似 ${(signals?.ref ?? 0).toFixed(2)}` })
  if ((signals?.concept ?? 0) >= 0.2 && sharedConcepts.length === 0) {
    chips.push({ key: 'sim', label: `概念相似 ${(signals?.concept ?? 0).toFixed(2)}` })
  }
  if ((signals?.lexical ?? 0) >= 0.25) chips.push({ key: 'lexical', label: `文本相似 ${(signals?.lexical ?? 0).toFixed(2)}` })
  if (chips.length === 0 && evidence?.refIndex !== undefined) {
    chips.push({ key: 'refIndex', label: `参考文献 #${evidence.refIndex + 1}` })
  }
  return (
    <span className="pr-signals">
      {chips.slice(0, limit).map((chip) => (
        <span className="pr-signal" key={chip.key}>{chip.label}</span>
      ))}
    </span>
  )
}

export function ConfidenceBar({ value, status }: { value: number; status?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <span
      className="pr-conf"
      data-low={percent < 62 || undefined}
      title={`证据强度 ${percent}（${statusLabel(status)}）：0.7×模型判断 + 0.3×信号分，不是概率`}
    >
      <span className="pr-conf-track"><i style={{ width: `${percent}%` }} /></span>
      <b>{percent}</b>
    </span>
  )
}

export function StatBlock({
  label,
  value,
  hint,
  onClick,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className="pr-stat" onClick={onClick} title={hint} type={onClick ? 'button' : undefined}>
      <b>{value}</b>
      <span>{label}</span>
    </Tag>
  )
}

export function EmptyBlock({
  icon,
  title,
  text,
  action,
}: {
  icon?: React.ReactNode
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <div className="pr-rempty">
      {icon ? <div className="pr-rempty-icon">{icon}</div> : null}
      <b>{title}</b>
      {text ? <p>{text}</p> : null}
      {action ? <div className="pr-rempty-action">{action}</div> : null}
    </div>
  )
}

export function metaLine(parts: Array<string | number | undefined | null>): string {
  return parts.filter((part) => part !== undefined && part !== null && String(part).trim() !== '').join(' · ')
}
