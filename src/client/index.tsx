import React from 'react'
import { PaperReaderApp } from './app.js'
import { KATEX_CSS_PATH } from '../shared/constants.js'
import { STYLES } from './theme/styles/index.js'

export const name = 'paper-reader'
export const inject = ['slots', 'theme']

/** The `sidebar.panellist` id and the `main` slot key: one id, one page. */
const PANEL_ID = 'paperreader'
const STYLE_ID = 'paperreader-styles'
const KATEX_STYLE_ID = 'paperreader-katex'

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}

function ensureKatexStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(KATEX_STYLE_ID)) return
  const link = document.createElement('link')
  link.id = KATEX_STYLE_ID
  link.rel = 'stylesheet'
  link.href = KATEX_CSS_PATH
  document.head.appendChild(link)
}

function PaperIcon({ size = 18 }: { size?: number }) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 20 20',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    React.createElement('path', { d: 'M3.4 4.6c1.9-.8 3.6-.8 5.3 0v10.8c-1.7-.8-3.4-.8-5.3 0V4.6Z' }),
    React.createElement('path', { d: 'M16.6 4.6c-1.9-.8-3.6-.8-5.3 0v10.8c1.7-.8 3.4-.8 5.3 0V4.6Z' }),
    React.createElement('path', { d: 'M10 4.7v10.7' }),
    React.createElement('path', { d: 'M14.6 2.1l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z', strokeWidth: 1.1 }),
  )
}

function readScheme(ctx: any): 'light' | 'dark' {
  try {
    return ctx?.theme?.getTheme?.()?.active?.colorScheme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * Token names a colour plugin can use to paint the whole app, in priority
 * order. The built-in `light`/`dark` themes ship an EMPTY token map (their
 * palette lives in the platform stylesheet), so anything present in
 * `active.tokens` was put there by a registered theme or an
 * `overrideTokens()` layer — i.e. by the user's appearance plugin. That makes
 * the snapshot a reliable "did somebody choose a colour?" probe.
 */
const ACCENT_TOKENS = [
  '--dsw-alias-brand-primary',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-button-primary-fill',
] as const

/**
 * Read the accent a theme/override layer installed, or null when the stock
 * palette is in charge (then `styles.ts` falls back to the host accent token
 * and finally to the stock blue on its own).
 * @param ctx - client context carrying the theme service.
 * @returns the raw token value (a colour or a var() expression), or null.
 */
export function readAccentToken(ctx: any): string | null {
  try {
    const tokens = ctx?.theme?.getTheme?.()?.active?.tokens
    if (!tokens || typeof tokens !== 'object') return null
    for (const name of ACCENT_TOKENS) {
      const raw = (tokens as Record<string, unknown>)[name]
      if (typeof raw !== 'string') continue
      const value = raw.trim()
      if (value === '' || value === 'initial' || value === 'inherit' || value === 'unset') continue
      return value
    }
  } catch {
    /* treat as "no override" */
  }
  return null
}

/** Relative luminance of an sRGB triple, per WCAG 2.1. */
function luminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Normalise any CSS colour to 0-255 channels, or null when it cannot be read. */
function toRgb(value: string): [number, number, number] | null {
  const text = value.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text)
  if (short) return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)]
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(text)
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)]
  // Anything else (rgb(), oklch(), a named colour, or a var() expression that
  // has to be resolved against the document): let the browser do the work.
  if (typeof document === 'undefined') return null
  try {
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:0;height:0;color:${text}`
    document.body.appendChild(probe)
    const computed = window.getComputedStyle(probe).color
    probe.remove()
    const parts = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(computed ?? '')
    if (parts) return [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  } catch {
    /* unreadable colour */
  }
  return null
}

/**
 * Ink for a filled accent surface: black or white by WCAG luminance, the exact
 * rule the desktop appearance plugin uses for `--we-accent-ink`, so both
 * sources agree on what text sits on the fill.
 * @param accent - the accent colour or var() expression.
 * @returns `#0f1115` on light accents, `#ffffff` otherwise.
 */
export function accentInk(accent: string): string {
  const rgb = toRgb(accent)
  if (!rgb) return '#ffffff'
  return luminance(rgb[0], rgb[1], rgb[2]) > 0.45 ? '#0f1115' : '#ffffff'
}

/**
 * The accent itself is pure CSS (`styles.ts` chains to the host tokens and to
 * `--we-accent`), so it keeps following live without a re-render. The one thing
 * CSS cannot decide is WHICH token carries the user's colour: a theme layer may
 * set brand-primary only, state-business-primary only, or both. So this root
 * mirrors the snapshot's literal onto two private variables that sit at the top
 * of that chain, and refreshes them on every `theme/change` — the documented
 * signal for a token-layer change. With no override the snapshot is empty and
 * no inline style is emitted at all.
 */
function AppRoot({ ctx }: { ctx: any }) {
  const [scheme, setScheme] = React.useState<'light' | 'dark'>(() => readScheme(ctx))
  const [accent, setAccent] = React.useState<string | null>(() => readAccentToken(ctx))

  React.useEffect(() => {
    if (!ctx?.on) return undefined
    const off = ctx.on('theme/change', () => {
      setScheme(readScheme(ctx))
      setAccent(readAccentToken(ctx))
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [ctx])

  const accentStyle = React.useMemo(
    () => (accent ? ({ '--pr-accent-host': accent, '--pr-ink-host': accentInk(accent) } as React.CSSProperties) : undefined),
    [accent],
  )

  return React.createElement(PaperReaderApp, { scheme, ctx, accentStyle })
}

export function apply(ctx: any): void {
  ensureStyles()
  ensureKatexStyles()
  ctx.effect?.(() => () => {
    document.getElementById(STYLE_ID)?.remove()
    document.getElementById(KATEX_STYLE_ID)?.remove()
  })

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, () => React.createElement(AppRoot, { ctx })),
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: -1, label: () => '论文' },
      (owner: { size?: number } = {}) => React.createElement(PaperIcon, { size: owner.size ?? 18 }),
    ),
  )
}
