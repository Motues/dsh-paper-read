/** Small display helpers shared by cards and pages. */

export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`
  return new Date(then).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** Compact token counts; `12.3 K` / `1.2 M` instead of Chinese unit words. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const compact = (amount: number, digits: number): string => (
    amount.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') || '0'
  )
  if (value >= 1_000_000_000) return `${compact(value / 1_000_000_000, 2)} B`
  if (value >= 1_000_000) return `${compact(value / 1_000_000, 1)} M`
  if (value >= 1_000) return `${compact(value / 1_000, 1)} K`
  return Math.round(value).toLocaleString('en-US')
}
