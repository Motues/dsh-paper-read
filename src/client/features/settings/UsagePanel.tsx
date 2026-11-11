import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { formatTokens } from '../../lib/format.js'
import type { UsageDay, UsagePayload, UsagePurpose, UsageTotals } from '../../types.js'

type RangeKey = '30' | '90' | '365' | 'all' | 'custom'

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
  { key: '365', label: '近 12 个月' },
  { key: 'all', label: '全部' },
]

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const SHOWN_WEEKDAYS = new Set([1, 3, 5])
const CELL = 10
const GAP = 2

const PURPOSE_LABEL: Record<UsagePurpose, string> = {
  summary: '导读',
  profile: '论文画像',
  relation: '关联判定',
  cluster: '主题命名',
  insight: '关联综述',
  search: '检索重排',
  chat: '对话',
  ask: '问答',
  translate: '翻译',
  other: '其他',
}

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  total: 0,
  calls: 0,
})

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year || 1970, (month || 1) - 1, day || 1)
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function rangeBounds(key: RangeKey, firstAt: string | null, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date()
  const to = localDate(today)
  if (key === '30') return { from: localDate(shiftDays(today, -29)), to }
  if (key === '90') return { from: localDate(shiftDays(today, -89)), to }
  if (key === '365') return { from: localDate(shiftDays(today, -364)), to }
  if (key === 'all') return { from: firstAt ?? localDate(shiftDays(today, -364)), to }
  const start = customFrom || localDate(shiftDays(today, -29))
  const end = customTo || to
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}

function totalOf(days: UsageDay[]): UsageTotals {
  const total = emptyTotals()
  for (const day of days) {
    total.input += day.input
    total.output += day.output
    total.cacheRead += day.cacheRead
    total.cacheWrite += day.cacheWrite
    total.reasoning += day.reasoning
    total.total += day.total
    total.calls += day.calls
  }
  return total
}

function levelOf(total: number, thresholds: [number, number, number]): number {
  if (total <= 0) return 0
  if (total <= thresholds[0]) return 1
  if (total <= thresholds[1]) return 2
  if (total <= thresholds[2]) return 3
  return 4
}

/** GitHub-style contribution matrix plus range and model summaries. */
export function UsagePanel() {
  const [payload, setPayload] = useState<UsagePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('365')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [hovered, setHovered] = useState<UsageDay | null>(null)
  const firstAtRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    const bounds = rangeBounds(range, firstAtRef.current, customFrom, customTo)
    setLoading(true)
    setError(null)
    try {
      const next = await api.usage(bounds)
      setPayload(next)
      firstAtRef.current = next.firstAt
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }, [customFrom, customTo, range])

  useEffect(() => {
    void load()
  }, [load])

  const days = payload?.days ?? []
  const total = useMemo(() => totalOf(days), [days])
  const activeDays = days.filter((day) => day.total > 0).length
  const average = activeDays > 0 ? Math.round(total.total / activeDays) : 0
  // Cached reads are part of the prompt, so "hit rate" is reads over the whole
  // prompt (uncached reads + cached reads + writes), not reads over input only.
  const promptTokens = total.input + total.cacheRead + total.cacheWrite
  const cacheHitRate = promptTokens > 0 && total.calls > 0
    ? Math.round((total.cacheRead / promptTokens) * 100)
    : null
  const thresholds = useMemo<[number, number, number]>(() => {
    const values = days.map((day) => day.total).filter((value) => value > 0).sort((left, right) => left - right)
    if (values.length === 0) return [0, 0, 0]
    const at = (share: number) => values[Math.floor((values.length - 1) * share)] ?? 0
    return [at(0.25), at(0.5), at(0.75)]
  }, [days])

  const weeks = useMemo(() => {
    if (!payload || typeof payload.from !== 'string' || typeof payload.to !== 'string') return []
    const byDate = new Map(days.map((day) => [day.date, day]))
    const start = parseDate(payload.from)
    const end = parseDate(payload.to)
    const gridStart = shiftDays(start, -start.getDay())
    const gridEnd = shiftDays(end, 6 - end.getDay())
    const columns: Array<Array<UsageDay | null>> = []
    for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = shiftDays(cursor, 1)) {
      if (columns.length === 0 || columns[columns.length - 1].length === 7) columns.push([])
      const key = localDate(cursor)
      const inRange = key >= payload.from && key <= payload.to
      columns[columns.length - 1].push(inRange ? byDate.get(key) ?? { date: key, ...emptyTotals() } : null)
    }
    return columns
  }, [days, payload])

  const months = useMemo(() => {
    const labels: Array<{ label: string; span: number }> = []
    for (const week of weeks) {
      const first = week.find((day): day is UsageDay => Boolean(day))
      if (!first) {
        if (labels.length > 0) labels[labels.length - 1].span += 1
        continue
      }
      const label = `${Number(first.date.slice(5, 7))}月`
      if (labels.length === 0 || labels[labels.length - 1].label !== label) labels.push({ label, span: 1 })
      else labels[labels.length - 1].span += 1
    }
    return labels
  }, [weeks])

  const chooseRange = (key: RangeKey) => {
    if (key === 'custom' && (!customFrom || !customTo)) {
      setCustomFrom(payload?.from ?? localDate(shiftDays(new Date(), -29)))
      setCustomTo(payload?.to ?? localDate(new Date()))
    }
    setRange(key)
  }

  return (
    <div className="pr-usage">
      <div className="pr-usage-head">
        <div className="pr-usage-total">
          <div
            className="pr-usage-total-value"
            title={`${total.total.toLocaleString('en-US')} tokens`}
          >
            {loading ? '…' : formatTokens(total.total)}
            <span>tokens</span>
          </div>
          <div className="pr-usage-total-sub">
            {loading
              ? '统计中…'
              : `${total.calls.toLocaleString('en-US')} 次调用 · 日均 ${formatTokens(average)}${cacheHitRate !== null ? ` · 缓存命中 ${cacheHitRate}%` : ''}`}
          </div>
        </div>
        <div className="pr-usage-ranges" role="group" aria-label="统计区间">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              className="pr-usage-range"
              data-on={range === item.key || undefined}
              onClick={() => chooseRange(item.key)}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="pr-usage-range"
            data-on={range === 'custom' || undefined}
            onClick={() => chooseRange('custom')}
          >
            自定义
          </button>
        </div>
      </div>

      {range === 'custom' ? (
        <div className="pr-usage-custom">
          <label>
            从
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
          </label>
          <span className="pr-usage-custom-sep">至</span>
          <label>
            到
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {error ? <div className="pr-settings-hint" data-error>{error}</div> : null}

      {!loading && total.calls === 0 ? (
        <div className="pr-usage-empty">
          <b>还没有 token 记录</b>
          <span>生成导读、分析关联或开始对话后，这里会按天出现用量。</span>
        </div>
      ) : (
        <>
          <div className="pr-usage-stats">
            <div><span>输入</span><b>{formatTokens(total.input)}</b></div>
            <div><span>输出</span><b>{formatTokens(total.output)}</b></div>
            <div><span>缓存读取</span><b>{formatTokens(total.cacheRead)}</b></div>
            <div>
              <span>缓存写入</span>
              {total.cacheWrite > 0 ? (
                <b>{formatTokens(total.cacheWrite)}</b>
              ) : (
                <b title="当前供应商未上报缓存写入；DeepSeek 等计费不区分读写，显示「—」属正常。">—</b>
              )}
            </div>
            <div><span>调用次数</span><b>{total.calls.toLocaleString('en-US')}</b></div>
            <div><span>活跃天数</span><b>{activeDays.toLocaleString('en-US')}</b></div>
          </div>
          <div className="pr-usage-caption">
            缓存读取是命中的输入 token；缓存写入只有部分供应商会单独上报，未上报时显示「—」。
          </div>

          <div className="pr-usage-chart">
            <div className="pr-usage-scroll">
              <div className="pr-usage-months" style={{ paddingLeft: 26 }}>
                {months.map((month, index) => (
                  <span key={`${month.label}-${index}`} style={{ width: month.span * (CELL + GAP) - GAP }}>
                    {month.label}
                  </span>
                ))}
              </div>
              <div className="pr-usage-body">
                <div className="pr-usage-weekdays">
                  {WEEKDAYS.map((label, index) => (
                    <span key={label}>{SHOWN_WEEKDAYS.has(index) ? label : ''}</span>
                  ))}
                </div>
                <div className="pr-usage-weeks">
                  {weeks.map((week, weekIndex) => (
                    <div className="pr-usage-week" key={weekIndex}>
                      {week.map((day, dayIndex) => (
                        <button
                          key={day?.date ?? `blank-${weekIndex}-${dayIndex}`}
                          type="button"
                          className="pr-usage-cell"
                          data-level={day ? levelOf(day.total, thresholds) : undefined}
                          data-outside={day ? undefined : true}
                          tabIndex={day ? 0 : -1}
                          aria-label={day ? `${day.date}，${day.total.toLocaleString('en-US')} tokens，${day.calls} 次调用` : undefined}
                          title={day ? `${day.date} · ${day.total.toLocaleString('en-US')} tokens` : undefined}
                          onMouseEnter={() => setHovered(day ?? null)}
                          onFocus={() => setHovered(day ?? null)}
                          onMouseLeave={() => setHovered(null)}
                          onBlur={() => setHovered(null)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="pr-usage-legend">
              <span className="pr-usage-legend-label">少</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} data-level={level} />
              ))}
              <span className="pr-usage-legend-label">多</span>
            </div>
            <div className="pr-usage-detail">
              {hovered
                ? `${hovered.date} · ${hovered.total.toLocaleString('en-US')} tokens · 输入 ${hovered.input.toLocaleString('en-US')} / 输出 ${hovered.output.toLocaleString('en-US')} · ${hovered.calls} 次`
                : '悬停方格查看当天用量'}
            </div>
          </div>

          {payload?.models && payload.models.length > 0 ? (
            <div className="pr-usage-breakdown">
              <div className="pr-usage-subhead">按模型</div>
              <div className="pr-usage-models">
                {payload.models.slice(0, 6).map((model) => (
                  <div className="pr-usage-model" key={`${model.provider}/${model.model}`}>
                    <span className="pr-usage-model-name" title={`${model.provider} / ${model.model}`}>
                      {model.provider} / {model.model}
                    </span>
                    <span className="pr-usage-model-bar">
                      <i style={{ width: `${total.total > 0 ? Math.max(2, (model.total / total.total) * 100) : 0}%` }} />
                    </span>
                    <span className="pr-usage-model-total">{formatTokens(model.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {payload?.sources && payload.sources.length > 0 ? (
            <div className="pr-usage-breakdown">
              <div className="pr-usage-subhead">按用途</div>
              <div className="pr-usage-sources">
                {payload.sources.map((source) => (
                  <span className="pr-usage-source" key={source.source}>
                    {PURPOSE_LABEL[source.source] ?? source.source}
                    <b>{formatTokens(source.total)}</b>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
