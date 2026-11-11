import React from 'react'

export function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button className="pr-nav-item" data-on={active || undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {typeof count === 'number' ? <span className="pr-nav-count">{count}</span> : null}
    </button>
  )
}
