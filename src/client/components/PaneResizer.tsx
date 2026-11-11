import type { PaneHandle } from '../lib/pane-size.js'

/**
 * The divider between a pane and the content. It sits on the pane's own edge
 * (inside its box, so overflow-hidden panels never clip it) and is keyboard
 * operable: arrows resize, Home/End jump to the bounds, double-click resets.
 */
export function PaneResizer({ label, ...handle }: PaneHandle & { label: string }) {
  return (
    <div
      className="pr-resizer"
      data-edge={handle.edge}
      data-dragging={handle.dragging || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={handle.min}
      aria-valuemax={handle.max}
      aria-valuenow={Math.round(handle.value)}
      title={`${label}（拖动调整，双击恢复默认）`}
      tabIndex={0}
      onPointerDown={handle.onPointerDown}
      onKeyDown={handle.onKeyDown}
      onDoubleClick={handle.onDoubleClick}
    />
  )
}
