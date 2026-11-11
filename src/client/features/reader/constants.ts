import type { HighlightColor } from '../../types.js'

export const HIGHLIGHT_COLORS: Array<{ key: HighlightColor; css: string; label: string }> = [
  { key: 'yellow', css: 'color-mix(in srgb, #f5c542 62%, transparent)', label: '黄' },
  { key: 'blue', css: 'color-mix(in srgb, #4f8df5 52%, transparent)', label: '蓝' },
  { key: 'rose', css: 'color-mix(in srgb, #ef6a8c 48%, transparent)', label: '玫红' },
  { key: 'green', css: 'color-mix(in srgb, #3fae7a 46%, transparent)', label: '绿' },
  { key: 'purple', css: 'color-mix(in srgb, #9b7bf0 46%, transparent)', label: '紫' },
  { key: 'orange', css: 'color-mix(in srgb, #f08a3c 48%, transparent)', label: '橙' },
]

export const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** Horizontal room the stage keeps around the page (26px padding each side + margin). */
export const PAGE_GUTTER = 72

/**
 * Zoom is a CSS transform (instant), the bitmap re-raster follows once the
 * gesture settles. Long enough to cover a burst of Ctrl+wheel steps.
 */
export const ZOOM_SETTLE_MS = 160

