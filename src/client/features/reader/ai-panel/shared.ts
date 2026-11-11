import { useEffect, useRef } from 'react'

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`
  if (value >= 1_000) return `${Math.round((value / 1_000) * 10) / 10}k`
  return String(value)
}

/** Close a popover on an outside click or Escape, the way DSH's own menus do. */
export function useDismiss(open: boolean, rootRef: { current: HTMLElement | null }, onClose: () => void): void {
  // Keep the latest handler out of the dependency list: a streaming turn
  // re-renders this panel many times and must not re-attach the listeners.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, rootRef])
}

export function conversationTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return `${date.getMonth() + 1}/${date.getDate()}`
}
