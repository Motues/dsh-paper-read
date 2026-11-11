/**
 * Task list: what is running now, plus the durable history behind it.
 *
 * The host task center owns the data; this page only filters and renders it.
 * Active rows keep the progress/cancel affordances from the old 当前任务 page,
 * while finished rows show start/end time, duration and exact token spend.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import type { TaskKind, TaskRecord, TaskState, TasksPayload } from '../../types.js'
import { PageHead } from '../../components/PageHead.js'
import { Select } from '../../components/Select.js'
import {
  IconActivity,
  IconChevronRight,
  IconClose,
  IconSearch,
  IconSpark,
  IconSparkLink,
  IconTranslate,
  IconUpload,
} from '../../components/ui.js'

const KIND_LABEL: Record<TaskKind, string> = {
  import: '导入',
  relations: '关联',
  summary: '导读',
  translation: '翻译',
  chat: '对话',
}

const STATE_LABEL: Record<TaskState, string> = {
  queued: '排队中',
  running: '进行中',
  done: '完成',
  failed: '失败',
  canceled: '已取消',
}

type RangeKey = 'all' | 'today' | '7d' | '30d'

const RANGE_LABEL: Record<RangeKey, string> = {
  all: '全部时间',
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
}

function KindIcon({ kind }: { kind: TaskKind }) {
  if (kind === 'translation') return <IconTranslate size={15} />
  if (kind === 'relations') return <IconSparkLink size={15} />
  if (kind === 'summary' || kind === 'chat') return <IconSpark size={15} />
  return <IconUpload size={15} />
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function boundsOf(range: RangeKey): { from?: string; to?: string } {
  if (range === 'all') return {}
  const now = new Date()
  const to = dayKey(now)
  if (range === 'today') return { from: to, to }
  const days = range === '7d' ? 6 : 29
  return { from: dayKey(new Date(now.getTime() - days * 86_400_000)), to }
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const today = dayKey(new Date())
  const day = dayKey(date)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return day === today ? `今天 ${time}` : `${day.slice(5)} ${time}`
}

function durationOf(startAt: string | undefined, endAt: string | undefined, now: number): string {
  if (!startAt) return '—'
  const start = new Date(startAt).getTime()
  if (!Number.isFinite(start)) return '—'
  const end = endAt ? new Date(endAt).getTime() : now
  if (!Number.isFinite(end)) return '—'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function tokensOf(value: number | undefined): string {
  if (!value || value <= 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

function TaskRow({
  task,
  now,
  stopping,
  onOpen,
  onStop,
}: {
  task: TaskRecord
  now: number
  stopping: string | null
  onOpen: (paperId: string) => void
  onStop: (task: TaskRecord) => void
}) {
  const active = task.state === 'running' || task.state === 'queued'
  const clickable = Boolean(task.paperId)
  const progress = task.progress && task.progress.total > 0
    ? Math.round((task.progress.done / task.progress.total) * 100)
    : null
  const usage = task.usage
  const open = () => {
    if (task.paperId) onOpen(task.paperId)
  }

  return (
    <div
      className="pr-task-row"
      data-kind={task.kind}
      data-state={task.state}
      data-active={active || undefined}
      data-clickable={clickable || undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? '打开这篇论文' : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (!clickable) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        open()
      }}
    >
      <div className="pr-task-what">
        <span className="pr-task-icon" data-kind={task.kind}>
          <KindIcon kind={task.kind} />
        </span>
        <div className="pr-task-text">
          <div className="pr-task-line">
            <span className="pr-task-kind">{KIND_LABEL[task.kind]}</span>
            <span className="pr-task-title">{task.title}</span>
          </div>
          <div className="pr-task-sub" data-error={task.error ? true : undefined}>
            {active ? (task.detail ?? '执行中') : (task.error ?? task.detail ?? '—')}
          </div>
          {active && progress !== null ? (
            <div className="pr-task-bar" aria-hidden>
              <i style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="pr-task-state-cell">
        <span className="pr-task-state" data-state={task.state}>
          {task.state === 'running' ? <i className="pr-task-dot" aria-hidden /> : null}
          {STATE_LABEL[task.state]}
        </span>
      </div>

      <div className="pr-task-time-cell">
        <span>{formatWhen(task.startedAt)}</span>
        <span>
          {task.finishedAt
            ? `→ ${formatWhen(task.finishedAt)}`
            : task.state === 'queued'
              ? '等待开始'
              : `已运行 ${durationOf(task.startedAt, undefined, now)}`}
        </span>
        {task.finishedAt ? <span>耗时 {durationOf(task.startedAt, task.finishedAt, now)}</span> : null}
      </div>

      <div className="pr-task-cost-cell">
        <b>{usage && usage.calls > 0 ? `${tokensOf(usage.total)} tokens` : '—'}</b>
        <span>
          {usage && usage.calls > 0
            ? `入 ${tokensOf(usage.input)} · 出 ${tokensOf(usage.output)} · ${usage.calls} 次`
            : '未调用模型'}
        </span>
        {task.models?.length ? (
          <span className="pr-task-models" title={task.models.join('、')}>{task.models.join(' · ')}</span>
        ) : null}
      </div>

      <div className="pr-task-action">
        {active && task.cancelable ? (
          <button
            type="button"
            className="pr-btn"
            data-sm
            data-ghost
            disabled={stopping === task.id}
            onClick={(event) => {
              event.stopPropagation()
              onStop(task)
            }}
          >
            {stopping === task.id ? '停止中…' : '停止'}
          </button>
        ) : clickable ? <IconChevronRight size={13} /> : null}
      </div>
    </div>
  )
}

export function TasksPage({ onOpen, onToast }: {
  onOpen: (paperId: string) => void
  onToast: (text: string) => void
}) {
  const [payload, setPayload] = useState<TasksPayload | null>(null)
  const [history, setHistory] = useState<TaskRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [stopping, setStopping] = useState<string | null>(null)
  const [kind, setKind] = useState<TaskKind | 'all'>('all')
  const [state, setState] = useState<TaskState | 'all'>('all')
  const [range, setRange] = useState<RangeKey>('all')
  const [query, setQuery] = useState('')
  const alive = useRef(true)
  const requestRef = useRef(0)
  const historyRef = useRef<TaskRecord[]>([])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async (
    offset: number,
    append: boolean,
    limit: number,
    spinner = false,
  ) => {
    const request = ++requestRef.current
    if (spinner) setLoading(true)
    if (append) setLoadingMore(true)
    try {
      const bounds = boundsOf(range)
      const next = await api.tasks({
        ...(kind === 'all' ? {} : { kind }),
        ...(state === 'all' ? {} : { state }),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...bounds,
        offset,
        limit,
      })
      if (!alive.current || request !== requestRef.current) return
      setPayload(next)
      const rows = append
        ? [...historyRef.current, ...(next.history ?? [])]
        : (next.history ?? [])
      historyRef.current = rows
      setHistory(rows)
      setTotal(next.total ?? rows.length)
      setError(null)
      setNow(Date.now())
    } catch (loadError) {
      if (!alive.current || request !== requestRef.current) return
      setError((loadError as Error).message)
    } finally {
      if (alive.current && request === requestRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [kind, query, range, state])

  useEffect(() => {
    void load(0, false, 50, true)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const limit = Math.min(200, Math.max(50, historyRef.current.length))
      void load(0, false, limit)
    }, 2000)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const limit = Math.min(200, Math.max(50, historyRef.current.length))
      void load(0, false, limit)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const stopTranslation = async (task: TaskRecord) => {
    if (!task.paperId) return
    setStopping(task.id)
    try {
      await api.cancelTranslation(task.paperId)
      if (alive.current) {
        onToast('已停止翻译，完成的页会保留')
        const limit = Math.min(200, Math.max(50, historyRef.current.length))
        await load(0, false, limit)
      }
    } catch (stopError) {
      if (alive.current) onToast((stopError as Error).message)
    } finally {
      if (alive.current) setStopping(null)
    }
  }

  const active = payload?.tasks ?? []
  const hasFilters = kind !== 'all' || state !== 'all' || range !== 'all' || query.trim().length > 0
  const clearFilters = () => {
    setKind('all')
    setState('all')
    setRange('all')
    setQuery('')
  }
  const countOf = (value: TaskKind): number => (
    (payload?.counts ?? []).find((entry) => entry.kind === value)?.count ?? 0
  )
  const kindOptions = [
    { value: 'all', label: '全部类型' },
    ...(['import', 'relations', 'summary', 'translation', 'chat'] as TaskKind[]).map((value) => ({
      value,
      label: `${KIND_LABEL[value]}（${countOf(value)}）`,
    })),
  ]
  const stateOptions = [
    { value: 'all', label: '全部状态' },
    ...(['done', 'failed', 'canceled', 'running', 'queued'] as TaskState[]).map((value) => ({
      value,
      label: STATE_LABEL[value],
    })),
  ]
  const rangeOptions = (Object.keys(RANGE_LABEL) as RangeKey[]).map((value) => ({
    value,
    label: RANGE_LABEL[value],
  }))

  return (
    <div className="pr-page pr-tasks-page" data-scroll>
      <PageHead title="任务列表" sub="进行中的任务与历史记录，含耗时和模型消耗" />

      <div className="pr-tasks-toolbar">
        <label className="pr-search pr-tasks-search">
          <IconSearch size={14} />
          <input
            value={query}
            placeholder="搜索任务、论文或错误…"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" className="pr-field-clear" title="清空" onClick={() => setQuery('')}>
              <IconClose size={12} />
            </button>
          ) : null}
        </label>
        <div className="pr-tasks-filter">
          <Select
            value={kind}
            options={kindOptions}
            ariaLabel="任务类型"
            size="sm"
            onChange={(next) => setKind(next as TaskKind | 'all')}
          />
        </div>
        <div className="pr-tasks-filter">
          <Select
            value={state}
            options={stateOptions}
            ariaLabel="任务状态"
            size="sm"
            onChange={(next) => setState(next as TaskState | 'all')}
          />
        </div>
        <div className="pr-tasks-filter">
          <Select
            value={range}
            options={rangeOptions}
            ariaLabel="时间范围"
            size="sm"
            onChange={(next) => setRange(next as RangeKey)}
          />
        </div>
        {hasFilters ? (
          <button type="button" className="pr-btn" data-sm data-ghost onClick={clearFilters}>
            清除筛选
          </button>
        ) : null}
        <div className="pr-spacer" />
        <span className="pr-tasks-count">{loading ? '正在筛选…' : `共 ${total} 条历史`}</span>
      </div>

      {error ? (
        <div className="pr-tasks-error">
          <b>读不到任务列表</b>
          <span>{error}</span>
          <button type="button" className="pr-btn" data-sm data-ghost onClick={() => void load(0, false, 50, false)}>
            重试
          </button>
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="pr-tasks-empty">
          <IconActivity size={22} />
          <b>读取任务…</b>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <section className="pr-tasks-section">
              <div className="pr-tasks-section-head">
                <h2>进行中</h2>
                <span>{active.length}</span>
              </div>
              <div className="pr-task-table" role="table" aria-label="进行中的任务">
                {active.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    now={now}
                    stopping={stopping}
                    onOpen={onOpen}
                    onStop={(item) => void stopTranslation(item)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="pr-tasks-section">
            <div className="pr-tasks-section-head">
              <h2>历史任务</h2>
              <span>{total}</span>
            </div>
            {history.length === 0 ? (
              <div className="pr-tasks-empty">
                <IconActivity size={22} />
                <b>{hasFilters ? '没有匹配的任务' : '还没有任务记录'}</b>
                <span>
                  {hasFilters
                    ? '换个类型、状态或时间范围试试。'
                    : '导入论文、翻译全文或生成导读后，这里会留下耗时与 token 记录。'}
                </span>
                {hasFilters ? (
                  <button type="button" className="pr-btn" data-sm data-ghost onClick={clearFilters}>
                    清除筛选
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="pr-task-table" role="table" aria-label="历史任务">
                  <div className="pr-task-head" role="row">
                    <span>任务</span>
                    <span>状态</span>
                    <span>时间 / 耗时</span>
                    <span>模型消耗</span>
                    <span aria-hidden />
                  </div>
                  {history.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      stopping={stopping}
                      onOpen={onOpen}
                      onStop={(item) => void stopTranslation(item)}
                    />
                  ))}
                </div>
                {history.length < total ? (
                  <button
                    type="button"
                    className="pr-btn pr-tasks-more"
                    data-ghost
                    disabled={loadingMore}
                    onClick={() => void load(history.length, true, 50)}
                  >
                    {loadingMore ? '加载中…' : `加载更多（还有 ${total - history.length} 条）`}
                  </button>
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
