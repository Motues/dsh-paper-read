/**
 * Durable daily token ledger.
 *
 * One JSON file (`$DSH_HOME/paperreader/usage.json`) keeps the aggregate the
 * settings page renders: per local day, the input/output/cache/reasoning
 * counts, the number of calls, and the same totals split by model and purpose.
 * Keeping the split on disk (instead of raw per-call rows) bounds the file and
 * lets a year-wide contribution grid load without replaying every request.
 *
 * Writes are debounced: relation rebuilds can finish dozens of model calls in
 * a burst, and one atomic write per burst is enough.
 */

import path from 'node:path'
import type {
  UsageDay,
  UsageModel,
  UsagePayload,
  UsagePurpose,
  UsageSource,
  UsageTotals,
} from '../../shared/domain.js'
import { readJson, writeJson } from '../util/util.js'

/** One model call's usage, as reported by DSH's `usage` stream chunk. */
export interface UsageSample {
  at?: string
  provider?: string
  model?: string
  source?: UsagePurpose
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

interface DayRecord extends UsageTotals {
  models: Record<string, UsageTotals>
  sources: Record<string, UsageTotals>
}

interface UsageFile {
  version: number
  days: Record<string, DayRecord>
}

const VERSION = 1
/** Two years is enough for the "全部" range and still keeps the file small. */
const KEEP_DAYS = 730
const SAVE_DELAY_MS = 800

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  calls: 0,
})

const emptyDay = (): DayRecord => ({ ...emptyTotals(), models: {}, sources: {} })

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayKeyOf(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date()
  return Number.isNaN(date.getTime()) ? localDate(new Date()) : localDate(date)
}

function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function addTotals(target: UsageTotals, delta: UsageTotals): void {
  target.input += delta.input
  target.output += delta.output
  target.cacheRead += delta.cacheRead
  target.cacheWrite += delta.cacheWrite
  target.reasoning += delta.reasoning
  target.total += delta.total
  target.calls += delta.calls
}

function sanitizeTotals(raw: unknown): UsageTotals {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (key: string): number => (isCount(data[key]) ? (data[key] as number) : 0)
  return {
    input: pick('input'),
    output: pick('output'),
    cacheRead: pick('cacheRead'),
    cacheWrite: pick('cacheWrite'),
    reasoning: pick('reasoning'),
    total: pick('total'),
    calls: pick('calls'),
  }
}

function sanitizeBuckets(raw: unknown): Record<string, UsageTotals> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, UsageTotals> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue
    out[key] = sanitizeTotals(value)
  }
  return out
}

function totalsOf(day: DayRecord): UsageTotals {
  return {
    input: day.input,
    output: day.output,
    cacheRead: day.cacheRead,
    cacheWrite: day.cacheWrite,
    reasoning: day.reasoning,
    total: day.total,
    calls: day.calls,
  }
}

export class UsageLedger {
  private file: string
  private days: Record<string, DayRecord> = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(root: string) {
    this.file = path.join(root, 'usage.json')
  }

  async load(): Promise<void> {
    const raw = await readJson<Partial<UsageFile>>(this.file, { days: {} })
      .catch(() => ({ days: {} }) as Partial<UsageFile>)
    const days = raw && typeof raw.days === 'object' && raw.days ? raw.days : {}
    this.days = {}
    for (const [key, value] of Object.entries(days)) {
      if (!isDayKey(key)) continue
      const data = (value && typeof value === 'object' ? value : {}) as Partial<DayRecord>
      const day = emptyDay()
      Object.assign(day, sanitizeTotals(data))
      day.models = sanitizeBuckets(data.models)
      day.sources = sanitizeBuckets(data.sources)
      this.days[key] = day
    }
    this.prune()
  }

  /** Fold one call into today's bucket and schedule a durable write. */
  record(sample: UsageSample): void {
    if (!isCount(sample.inputTokens) || !isCount(sample.outputTokens)) return
    const cacheRead = isCount(sample.cacheReadTokens) ? sample.cacheReadTokens : 0
    const cacheWrite = isCount(sample.cacheWriteTokens) ? sample.cacheWriteTokens : 0
    const reasoning = isCount(sample.reasoningTokens) ? sample.reasoningTokens : 0
    const total = isCount(sample.totalTokens)
      ? sample.totalTokens
      : sample.inputTokens + sample.outputTokens + cacheRead + cacheWrite
    if (!isCount(total) || total <= 0) return

    const key = dayKeyOf(sample.at)
    const day = this.days[key] ?? (this.days[key] = emptyDay())
    const delta: UsageTotals = {
      input: sample.inputTokens,
      output: sample.outputTokens,
      cacheRead,
      cacheWrite,
      reasoning,
      total,
      calls: 1,
    }
    addTotals(day, delta)

    const modelKey = `${sample.provider?.trim() || 'unknown'}/${sample.model?.trim() || 'unknown'}`
    const model = day.models[modelKey] ?? (day.models[modelKey] = emptyTotals())
    addTotals(model, delta)

    const sourceKey = sample.source ?? 'other'
    const source = day.sources[sourceKey] ?? (day.sources[sourceKey] = emptyTotals())
    addTotals(source, delta)

    this.prune()
    this.schedule()
  }

  /** Write immediately; called on host shutdown and by tests. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const payload: UsageFile = { version: VERSION, days: this.days }
    this.saving = this.saving
      .catch(() => undefined)
      .then(() => writeJson(this.file, payload))
    await this.saving
  }

  /**
   * Aggregate the requested inclusive local-date range.
   *
   * Missing `from`/`to` fall back to the ledger bounds (or today when empty), so
   * the route can be called without query parameters during a cold start.
   */
  snapshot(from?: string | null, to?: string | null): UsagePayload {
    const keys = Object.keys(this.days).sort()
    const firstAt = keys[0] ?? null
    const lastAt = keys[keys.length - 1] ?? null
    const end = to && isDayKey(to) ? to : (lastAt ?? localDate(new Date()))
    const start = from && isDayKey(from) ? from : (firstAt ?? end)

    const total = emptyTotals()
    const days: UsageDay[] = []
    const models = new Map<string, UsageModel>()
    const sources = new Map<string, UsageSource>()

    for (const key of keys) {
      if (key < start || key > end) continue
      const day = this.days[key]
      const dayTotals = totalsOf(day)
      days.push({ date: key, ...dayTotals })
      addTotals(total, dayTotals)

      for (const [modelKey, bucket] of Object.entries(day.models)) {
        const [provider, ...rest] = modelKey.split('/')
        const entry = models.get(modelKey) ?? {
          provider: provider || 'unknown',
          model: rest.join('/') || 'unknown',
          ...emptyTotals(),
        }
        addTotals(entry, bucket)
        models.set(modelKey, entry)
      }
      for (const [source, bucket] of Object.entries(day.sources)) {
        const entry = sources.get(source) ?? {
          source: source as UsagePurpose,
          ...emptyTotals(),
        }
        addTotals(entry, bucket)
        sources.set(source, entry)
      }
    }

    return {
      from: start,
      to: end,
      total,
      days,
      models: [...models.values()].sort((left, right) => right.total - left.total),
      sources: [...sources.values()].sort((left, right) => right.total - left.total),
      firstAt,
      lastAt,
    }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => undefined)
    }, SAVE_DELAY_MS)
    // Do not keep the host process alive just to flush one bucket.
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  private prune(): void {
    const cutoff = localDate(new Date(Date.now() - KEEP_DAYS * 86_400_000))
    for (const key of Object.keys(this.days)) {
      if (key < cutoff) delete this.days[key]
    }
  }
}
