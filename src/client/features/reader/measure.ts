/**
 * Text metrics for the re-typesetting pass.
 *
 * `fitText` needs advance widths before anything is painted, so it measures
 * with a canvas at a fixed reference size and scales linearly: font advances
 * scale with the em, and this keeps one metric lookup per distinct token
 * instead of one per token per candidate size. The browser's real layout is
 * still checked afterwards, which catches the rare font whose hinting differs.
 */

import type { Measure } from '../../../shared/typeset.js'

const REFERENCE = 100
const LIMIT = 20000

interface Entry {
  measure: Measure
}

const cache = new Map<string, Entry>()

function fallback(text: string): number {
  let width = 0
  for (const char of text) {
    if (/\s/.test(char)) width += 0.28
    else if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(char)) width += 1
    else if (/[A-Z]/.test(char)) width += 0.68
    else if (/[il.,:;'|!]/.test(char)) width += 0.28
    else width += 0.5
  }
  return width * REFERENCE
}

function createMeasure(fontFamily: string, weight: string): Measure {
  let context: CanvasRenderingContext2D | null | undefined
  let ready = false
  const baseWidths = new Map<string, number>()
  const scaled = new Map<string, number>()

  const resolve = (): CanvasRenderingContext2D | null => {
    if (ready) return context ?? null
    ready = true
    // jsdom defines the canvas API but throws (and logs) on getContext.
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
      context = null
      return null
    }
    try {
      const canvas = document.createElement('canvas')
      context = canvas.getContext('2d')
      if (context) context.font = `${weight} ${REFERENCE}px ${fontFamily}`
    } catch {
      context = null
    }
    return context ?? null
  }

  return (text: string, size: number): number => {
    if (text === '' || size <= 0) return 0
    const key = `${size}|${text}`
    const hit = scaled.get(key)
    if (hit !== undefined) return hit
    let base = baseWidths.get(text)
    if (base === undefined) {
      const ctx = resolve()
      base = ctx ? ctx.measureText(text).width : fallback(text)
      if (baseWidths.size >= LIMIT) baseWidths.clear()
      baseWidths.set(text, base)
    }
    const value = base * (size / REFERENCE)
    if (scaled.size >= LIMIT) scaled.clear()
    scaled.set(key, value)
    return value
  }
}

/**
 * One measure per font family/weight pair. Callers pass what
 * `getComputedStyle` reports on the rendered element, so the estimate uses the
 * same font the browser will actually paint.
 */
export function measureFor(fontFamily: string, weight: string): Measure {
  const key = `${weight}|${fontFamily}`
  const hit = cache.get(key)
  if (hit) return hit.measure
  const measure = createMeasure(fontFamily, weight)
  cache.set(key, { measure })
  return measure
}
