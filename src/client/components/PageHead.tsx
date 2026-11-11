import React from 'react'

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children?: React.ReactNode
}) {
  return (
    <div className="pr-page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <span className="pr-page-sub">{sub}</span> : null}
      </div>
      <div className="pr-spacer" />
      {children}
    </div>
  )
}
