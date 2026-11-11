/**
 * Durable task ledger for the task list page.
 *
 * Every long-running action (import, relation rebuild, full-text translation,
 * manual guide generation) opens a task here. While it runs, model usage is
 * attributed through an AsyncLocalStorage context; when it finishes, the row
 * moves from the in-memory active list into `tasks.json`.
 *
 * Chat turns are deliberately live-only: they are useful in the active list,
 * but one row per question would drown the history the page is meant for.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import type {
  Job,
  TaskKind,
  TaskKindCount,
  TaskRecord,
  TaskState,
  TasksPayload,
  UsageTotals,
} from '../../shared/domain.js'
import { readJson, writeJson } from '../util/util.js'
import type { UsageSample } from '../usage/ledger.js'

const VERSION = 1
const MAX_HISTORY = 500
const SAVE_DELAY_MS = 400

const KINDS: TaskKind[] = ['import', 'relations', 'summary', 'translation', 'chat']
const KIND_LABEL: Record<TaskKind, string> = {
  import: '导入',
  relations: '关联',
  summary: '导读',
  translation: '翻译',
  chat: '对话',
}

interface TaskFile {
  version: number
  tasks: TaskRecord[]
}

interface ActiveEntry {
  task: TaskRecord
  /** Chat rows stay in the live list but are never archived. */
  archive: boolean
  models: Set<string>
}

interface Context {
  taskId: string
}

export interface TaskBeginInput {
  id?: string
  kind: TaskKind
  title: string
  detail?: string
  paperId?: string
  state?: 'queued' | 'running'
  startedAt?: string
  progress?: { done: number; total: number }
  cancelable?: boolean
  /** Defaults to true; chat passes false. */
  archive?: boolean
}

export interface TaskPatch {
  title?: string
  detail?: string
  paperId?: string
  startedAt?: string
  progress?: { done: number; total: number } | null
  cancelable?: boolean
}

export interface TaskFinish {
  state?: Exclude<TaskState, 'queued' | 'running'>
  detail?: string
  error?: string
}

export interface TaskHandle {
  id: string
  update(patch: TaskPatch): void
  finish(finish?: TaskFinish): void
}

export interface TaskQuery {
  kind?: TaskKind | 'all'
  state?: TaskState | 'all'
  q?: string
  /** Inclusive local date, `YYYY-MM-DD`. */
  from?: string
  to?: string
  offset?: number
  limit?: number
}

const emptyUsage = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  calls: 0,
})

function addUsage(target: UsageTotals, sample: UsageSample): void {
  const cacheRead = sample.cacheReadTokens ?? 0
  const cacheWrite = sample.cacheWriteTokens ?? 0
  const reasoning = sample.reasoningTokens ?? 0
  const total = sample.totalTokens ?? sample.inputTokens + sample.outputTokens + cacheRead + cacheWrite
  target.input += sample.inputTokens
  target.output += sample.outputTokens
  target.cacheRead += cacheRead
  target.cacheWrite += cacheWrite
  target.reasoning += reasoning
  target.total += total
  target.calls += 1
}

function localDay(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function isDayKey(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    ...(task.progress ? { progress: { ...task.progress } } : {}),
    ...(task.usage ? { usage: { ...task.usage } } : {}),
    ...(task.models ? { models: [...task.models] } : {}),
  }
}

function taskDay(task: TaskRecord): string {
  return localDay(task.finishedAt ?? task.startedAt)
}

function stepOf(job: Job): string {
  if (job.state === 'queued') return '排队中'
  const running = job.steps.find((step) => step.state === 'running')
  const pending = job.steps.find((step) => step.state === 'pending')
  const step = running ?? pending
  if (!step) return job.state === 'done' ? '已完成' : '执行中'
  return step.label + (step.detail ? ` · ${step.detail}` : '')
}

function progressOf(job: Job): { done: number; total: number } {
  const done = job.steps.filter((step) => step.state === 'done' || step.state === 'skipped').length
  return { done, total: job.steps.length }
}

export class TaskCenter {
  private file: string
  private resolveTitle: (paperId: string) => string | undefined
  private log: (message: string, error?: unknown) => void
  private active = new Map<string, ActiveEntry>()
  private history: TaskRecord[] = []
  private als = new AsyncLocalStorage<Context>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()
  private counter = 0

  constructor({
    root,
    resolveTitle = () => undefined,
    log = () => {},
  }: {
    root: string
    resolveTitle?: (paperId: string) => string | undefined
    log?: (message: string, error?: unknown) => void
  }) {
    this.file = path.join(root, 'tasks.json')
    this.resolveTitle = resolveTitle
    this.log = log
  }

  async load(): Promise<void> {
    const raw = await readJson<Partial<TaskFile>>(this.file, { tasks: [] })
      .catch(() => ({ tasks: [] }) as Partial<TaskFile>)
    const list = Array.isArray(raw?.tasks) ? raw.tasks : []
    const now = new Date().toISOString()
    const restored: TaskRecord[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as TaskRecord
      if (!row.id || !row.kind || !KINDS.includes(row.kind)) continue
      if (!row.startedAt) continue
      const state: TaskState = row.state === 'running' || row.state === 'queued'
        ? 'failed'
        : (['done', 'failed', 'canceled'].includes(row.state) ? row.state : 'done')
      restored.push({
        ...row,
        title: String(row.title ?? '任务'),
        state,
        updatedAt: row.updatedAt ?? row.startedAt,
        finishedAt: row.finishedAt ?? now,
        ...(state === 'failed' && (row.state === 'running' || row.state === 'queued')
          ? { error: '宿主重启，任务已中断' }
          : {}),
        ...(row.usage ? { usage: { ...emptyUsage(), ...row.usage } } : {}),
        ...(Array.isArray(row.models) ? { models: row.models.filter((model) => typeof model === 'string') } : {}),
      })
    }
    this.history = restored
      .sort((left, right) => String(right.finishedAt ?? right.startedAt).localeCompare(String(left.finishedAt ?? left.startedAt)))
      .slice(0, MAX_HISTORY)
  }

  begin(input: TaskBeginInput): TaskHandle {
    const existing = input.id ? this.active.get(input.id) : undefined
    if (existing) {
      this.update(existing.task.id, {
        title: input.title,
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
        ...(input.paperId !== undefined ? { paperId: input.paperId } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.progress !== undefined ? { progress: input.progress } : {}),
        ...(input.cancelable !== undefined ? { cancelable: input.cancelable } : {}),
      })
      return this.handle(existing.task.id)
    }

    this.counter += 1
    const now = new Date().toISOString()
    const task: TaskRecord = {
      id: input.id ?? `task_${Date.now().toString(36)}_${this.counter}`,
      kind: input.kind,
      title: input.title || KIND_LABEL[input.kind],
      state: input.state ?? 'running',
      startedAt: input.startedAt ?? now,
      updatedAt: now,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.paperId ? { paperId: input.paperId } : {}),
      ...(input.progress ? { progress: { ...input.progress } } : {}),
      ...(input.cancelable ? { cancelable: true } : {}),
    }
    this.active.set(task.id, {
      task,
      archive: input.archive !== false,
      models: new Set(),
    })
    return this.handle(task.id)
  }

  update(id: string, patch: TaskPatch): void {
    const entry = this.active.get(id)
    if (!entry) return
    const task = entry.task
    if (patch.title !== undefined) task.title = patch.title
    if (patch.detail !== undefined) task.detail = patch.detail
    if (patch.paperId !== undefined) task.paperId = patch.paperId
    if (patch.startedAt !== undefined) task.startedAt = patch.startedAt
    if (patch.cancelable !== undefined) task.cancelable = patch.cancelable
    if (patch.progress === null) delete task.progress
    else if (patch.progress) task.progress = { ...patch.progress }
    task.updatedAt = new Date().toISOString()
  }

  finish(id: string, finish: TaskFinish = {}): void {
    const entry = this.active.get(id)
    if (!entry) return
    this.active.delete(id)
    const task = entry.task
    const now = new Date().toISOString()
    task.state = finish.state ?? 'done'
    task.finishedAt = now
    task.updatedAt = now
    if (finish.detail !== undefined) task.detail = finish.detail
    if (finish.error) task.error = finish.error
    if (entry.models.size > 0) task.models = [...entry.models]
    if (!task.usage || task.usage.calls === 0) delete task.usage
    if (!entry.archive) return
    this.history.unshift(cloneTask(task))
    this.history = this.history.slice(0, MAX_HISTORY)
    this.schedule()
  }

  /** Run work with this task's usage context. */
  run<T>(id: string, fn: () => T): T {
    return this.als.run({ taskId: id }, fn)
  }

  /** Called by the Summoner/chat for every exact usage sample. */
  record(sample: UsageSample): void {
    const context = this.als.getStore()
    if (!context) return
    const entry = this.active.get(context.taskId)
    if (!entry) return
    const task = entry.task
    task.usage ??= emptyUsage()
    addUsage(task.usage, sample)
    const provider = sample.provider?.trim()
    const model = sample.model?.trim()
    if (provider || model) entry.models.add(`${provider || 'unknown'}/${model || 'unknown'}`)
    task.updatedAt = new Date().toISOString()
  }

  /** Mirror a job's queued/running/done state into the task list. */
  syncJob(job: Job): boolean {
    const terminal = job.state === 'done' || job.state === 'failed'
    const entry = this.active.get(job.id)
    if (!entry) {
      if (terminal) return true
      const kind: TaskKind = job.kind === 'relations' ? 'relations' : 'import'
      const paperTitle = job.paperId ? this.resolveTitle(job.paperId) : undefined
      this.begin({
        id: job.id,
        kind,
        title: paperTitle || job.sourceLabel || KIND_LABEL[kind],
        detail: stepOf(job),
        ...(job.paperId ? { paperId: job.paperId } : {}),
        state: job.state === 'queued' ? 'queued' : 'running',
        startedAt: job.startedAt ?? job.createdAt,
        progress: progressOf(job),
      })
    } else {
      const paperTitle = job.paperId ? this.resolveTitle(job.paperId) : undefined
      this.update(job.id, {
        ...(paperTitle ? { title: paperTitle } : {}),
        detail: stepOf(job),
        ...(job.paperId ? { paperId: job.paperId } : {}),
        ...(job.startedAt ? { startedAt: job.startedAt } : {}),
        progress: progressOf(job),
      })
      if (entry.task.state === 'queued' && job.state === 'running') entry.task.state = 'running'
    }
    if (terminal) {
      this.finish(job.id, {
        state: job.state === 'failed' ? 'failed' : 'done',
        detail: job.state === 'failed' ? '失败' : '已完成',
        ...(job.error ? { error: job.error } : {}),
      })
      return true
    }
    return false
  }

  /** Register a job immediately and follow it until it reaches a terminal state. */
  trackJob(job: Job, subscribe: (id: string, listener: (job: Job) => void) => () => void): void {
    if (this.syncJob(job)) return
    const unsubscribe = subscribe(job.id, (next) => {
      if (this.syncJob(next)) unsubscribe()
    })
  }

  activeTasks(query: TaskQuery = {}): TaskRecord[] {
    const rank = (task: TaskRecord): number => {
      if (task.state === 'running') return 0
      if (task.state === 'queued') return 1
      return 2
    }
    return [...this.active.values()]
      .map((entry) => entry.task)
      .filter((task) => this.matches(task, query))
      .sort((left, right) => (
        rank(left) - rank(right)
        || String(right.startedAt).localeCompare(String(left.startedAt))
      ))
      .map(cloneTask)
  }

  snapshot(query: TaskQuery = {}): TasksPayload {
    const counts: TaskKindCount[] = KINDS.map((kind) => ({
      kind,
      count: this.history.filter((task) => task.kind === kind).length,
    }))
    const filtered = this.history.filter((task) => this.matches(task, query))
    const offset = Math.max(0, Math.floor(query.offset ?? 0))
    const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 50)))
    const keys = this.history.map(taskDay).filter(Boolean).sort()
    return {
      tasks: this.activeTasks(query),
      history: filtered.slice(offset, offset + limit).map(cloneTask),
      total: filtered.length,
      counts,
      firstAt: keys[0] ?? null,
      lastAt: keys[keys.length - 1] ?? null,
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const payload: TaskFile = { version: VERSION, tasks: this.history }
    this.saving = this.saving
      .catch(() => undefined)
      .then(() => writeJson(this.file, payload))
    await this.saving
  }

  private handle(id: string): TaskHandle {
    return {
      id,
      update: (patch) => this.update(id, patch),
      finish: (finish) => this.finish(id, finish),
    }
  }

  private matches(task: TaskRecord, query: TaskQuery): boolean {
    if (query.kind && query.kind !== 'all' && task.kind !== query.kind) return false
    if (query.state && query.state !== 'all' && task.state !== query.state) return false
    const day = taskDay(task)
    if (isDayKey(query.from) && day < query.from) return false
    if (isDayKey(query.to) && day > query.to) return false
    const needle = query.q?.trim().toLowerCase()
    if (!needle) return true
    return [
      task.title,
      task.detail ?? '',
      task.error ?? '',
      task.paperId ?? '',
      ...(task.models ?? []),
      KIND_LABEL[task.kind],
    ].some((value) => value.toLowerCase().includes(needle))
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch((error) => this.log('task history flush failed', error))
    }, SAVE_DELAY_MS)
    ;(this.timer as { unref?: () => void }).unref?.()
  }
}
