import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { IconCheck, IconChevronDown, IconSearch } from './ui.js'

export interface SelectOption {
  value: string
  /** Text shown in the menu. */
  label: string
  /** Right-aligned secondary text (parent path, count, …). */
  hint?: string
  /** Full value shown in the trigger and as the tooltip. Defaults to `label`. */
  title?: string
  icon?: ReactNode
  group?: string
  depth?: number
  disabled?: boolean
}

interface Position {
  left: number
  width: number
  placement: 'bottom' | 'top'
  top?: number
  bottom?: number
  maxHeight: number
}

/**
 * One dropdown for every picker in the plugin.
 *
 * Native `<select>` cannot be themed consistently across the host's light,
 * dark and glass themes, and its popup is painted by the OS. This component
 * keeps the same interaction model but owns the surface. The menu is rendered
 * in place with `position: fixed` so a scrolling settings page or a dialog
 * cannot clip it, while still inheriting the `.pr-root` theme variables.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '请选择',
  fallbackLabel,
  disabled = false,
  searchable = false,
  searchPlaceholder = '搜索…',
  size = 'md',
  menuMinWidth = 180,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  /** Shown when `value` is set but no option matches (stale configured value). */
  fallbackLabel?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  size?: 'sm' | 'md'
  menuMinWidth?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [position, setPosition] = useState<Position | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selected = options.find((option) => option.value === value)
  const selectedLabel = selected?.title ?? selected?.label ?? fallbackLabel ?? placeholder

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => (
      option.label.toLowerCase().includes(needle)
      || (option.title ?? '').toLowerCase().includes(needle)
      || (option.hint ?? '').toLowerCase().includes(needle)
      || option.value.toLowerCase().includes(needle)
    ))
  }, [options, query])

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? 280
    const below = window.innerHeight - rect.bottom - 10
    const above = rect.top - 10
    const placement: Position['placement'] = (
      below >= Math.min(menuHeight, 280) || below >= above ? 'bottom' : 'top'
    )
    const maxHeight = Math.max(140, Math.min(320, placement === 'bottom' ? below : above))
    const width = Math.max(rect.width, menuMinWidth)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPosition({
      left,
      width,
      placement,
      maxHeight,
      ...(placement === 'bottom'
        ? { top: rect.bottom + 5 }
        : { bottom: window.innerHeight - rect.top + 5 }),
    })
  }, [menuMinWidth])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    setQuery('')
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    setQuery('')
    setOpen(true)
    const index = options.findIndex((option) => option.value === value)
    setActive(index >= 0 ? index : Math.max(0, options.findIndex((option) => !option.disabled)))
  }, [disabled, options, value])

  const choose = useCallback((option: SelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    close(true)
  }, [close, onChange])

  useLayoutEffect(() => {
    if (!open) return
    reposition()
    const frame = window.requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus()
      else menuRef.current?.focus()
      reposition()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, reposition, searchable])

  useEffect(() => {
    if (!open) return
    const update = () => reposition()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [close, open])

  useEffect(() => {
    if (!open) return
    const index = filtered.findIndex((option) => option.value === value)
    setActive(index >= 0 ? index : Math.max(0, filtered.findIndex((option) => !option.disabled)))
    // Only a new query or a newly opened menu should reset the highlight.
    // `options` is often built inline by the caller; depending on it would
    // reset the hovered row on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, value])

  const move = (delta: number) => {
    if (filtered.length === 0) return
    let next = active
    for (let step = 0; step < filtered.length; step += 1) {
      next = (next + delta + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) {
        setActive(next)
        return
      }
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const start = event.key === 'Home' ? 0 : filtered.length - 1
      const direction = event.key === 'Home' ? 1 : -1
      let next = start - direction
      for (let step = 0; step < filtered.length; step += 1) {
        next = (next + direction + filtered.length) % filtered.length
        if (!filtered[next]?.disabled) {
          setActive(next)
          break
        }
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = filtered[active]
      if (option) choose(option)
      return
    }
    if (event.key === 'Tab') close()
  }

  let lastGroup: string | undefined
  const menuStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        ...(position.placement === 'bottom' ? { top: position.top } : { bottom: position.bottom }),
      }
    : { visibility: 'hidden' }

  return (
    <div className={`pr-select-wrap ${className ?? ''}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className="pr-select-trigger"
        data-size={size}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={selectedLabel}
        disabled={disabled}
        onClick={() => {
          if (open) close()
          else openMenu()
        }}
      >
        <span className="pr-select-value">{selectedLabel}</span>
        <IconChevronDown size={12} className="pr-select-chevron" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="pr-select-menu"
          data-placement={position?.placement ?? 'bottom'}
          style={menuStyle}
          role="dialog"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {searchable ? (
            <label className="pr-select-search">
              <IconSearch size={12} />
              <input
                ref={searchRef}
                value={query}
                placeholder={searchPlaceholder}
                aria-label={`${ariaLabel}搜索`}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const option = filtered[active] ?? filtered[0]
                    if (option) choose(option)
                  }
                }}
              />
            </label>
          ) : null}

          <div className="pr-select-list" id={listId} role="listbox" aria-label={ariaLabel}>
            {filtered.map((option, index) => {
              const heading = option.group && option.group !== lastGroup ? option.group : undefined
              lastGroup = option.group
              const on = option.value === value
              return (
                <Fragment key={`${option.value}-${index}`}>
                  {heading ? <div className="pr-select-group" role="presentation">{heading}</div> : null}
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={on}
                    disabled={option.disabled}
                    className="pr-select-option"
                    data-on={on || undefined}
                    data-active={index === active || undefined}
                    title={option.title ?? option.label}
                    style={option.depth !== undefined
                      ? { paddingLeft: 8 + (query.trim() ? 0 : option.depth * 16) }
                      : undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                  >
                    {option.icon}
                    <span className="pr-select-option-name">{option.label}</span>
                    {option.hint ? <span className="pr-select-option-path">{option.hint}</span> : null}
                    {on ? <IconCheck size={12} className="pr-select-check" /> : null}
                  </button>
                </Fragment>
              )
            })}
            {filtered.length === 0 ? <div className="pr-select-empty">没有匹配项</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
