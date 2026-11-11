/**
 * A transient "here it is" mark for a find-in-paper hit. The reader owns the
 * lifetime; pages only render it while it points at them.
 */

export interface FindMark {
  page: number
  blockId: string
  /** The matched text itself, so the page can hug the hit, not the paragraph. */
  needle: string
  /** `[x, y, w, h]` in PDF points, the space annotations already use. */
  bbox: [number, number, number, number]
  /**
   * Line boxes of the matched text in PDF points, resolved once the page's text
   * layer is up. `undefined` = still locating (draw nothing yet); `null` = the
   * glyphs could not be found, so the block `bbox` is flashed instead.
   */
  rects?: number[][] | null
  /** Bumped on every pick so the flash animation restarts on the same block. */
  token: number
}
