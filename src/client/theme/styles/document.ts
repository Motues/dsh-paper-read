/**
 * PDF 画布、文本回退与查找闪烁。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const document = String.raw`
/* ---------------------------------------------------------------- misc */

.pr-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 70px 0; color: var(--pr-ink-3); }
.pr-toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: var(--dsw-alias-bg-overlay, #222); color: var(--pr-ink);
  border: 1px solid var(--pr-line-strong); border-radius: 9px; padding: 7px 12px;
  font-size: 12px; box-shadow: var(--pr-shadow); z-index: 80; animation: pr-rise .18s ease-out;
}
@keyframes pr-rise { from { opacity: 0; transform: translate(-50%, 6px); } }
.pr-svg-icon { flex: none; }
.pr-para { margin: 0 0 7px; }
.pr-para:last-child { margin-bottom: 0; }

/* ── 真实 PDF 纸面 ─────────────────────────────────────────────── */
.pr-sheet[data-pdf] {
  width: auto; padding: 0; min-height: 0;
  background: transparent; border: 0; box-shadow: none;
  display: flex; justify-content: center;
}
/* 阅读器的单页画布。类名与页面容器 .pr-page 区分开：两者曾经同名，
   容器因此继承了纸面背景与阴影，表现为主区域蒙了一层白。 */
.pr-pdfpage {
  position: relative; flex: none;
  background: var(--pr-paper);
  border-radius: 3px;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--pr-line-strong) 42%, transparent),
    0 1px 2px rgba(15, 23, 42, .08),
    0 12px 32px rgba(15, 23, 42, .18);
  overflow: hidden;
  transition: opacity 120ms ease;
}
.pr-pdfpage[data-rendering] { opacity: .94; }
/* Fixed 100% geometry; zoom is one transform on this layer, so glyphs,
   highlights and the bitmap all move together without a re-layout. No
   will-change hint: the layer must re-raster at the new scale to stay crisp. */
.pr-pdfpage-stage {
  position: absolute; top: 0; left: 0;
  transform-origin: 0 0;
}
.pr-pdf-canvas { display: block; width: 100%; height: 100%; }
.pr-pdf-loading {
  position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--pr-ink) 5%, transparent) 50%, transparent 70%);
  animation: pr-shimmer 1.2s linear infinite;
}
@keyframes pr-shimmer { from { transform: translateX(-40%); } to { transform: translateX(40%); } }

.pr-textlayer {
  position: absolute; inset: 0; overflow: hidden;
  line-height: 1; text-size-adjust: none;
}
.pr-textlayer span {
  position: absolute; white-space: pre; transform-origin: 0 0;
  color: transparent; cursor: text;
}
.pr-textlayer span::selection { background: transparent; }
.pr-sel-layer { position: absolute; inset: 0; pointer-events: none; }
.pr-sel {
  position: absolute; border-radius: 1px;
  background: color-mix(in srgb, var(--pr-accent) 24%, transparent);
}
.pr-anno-layer { position: absolute; inset: 0; pointer-events: none; }
/* Find-in-paper: the matched block flashes once, then fades back out. */
.pr-find-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.pr-find {
  position: absolute; border-radius: 2px;
  background: color-mix(in srgb, #f2c14e 44%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #d79a12 38%, transparent);
  animation: pr-find-flash 3s ease-out forwards;
}
@keyframes pr-find-flash { 0%, 62% { opacity: 1 } 100% { opacity: 0 } }
.pr-anno { position: absolute; border-radius: 2px; }
.pr-anno-ring {
  position: absolute; z-index: 2; pointer-events: none;
  border: 2px solid var(--pr-accent); border-radius: 4px;
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--pr-paper) 72%, transparent),
    0 0 18px color-mix(in srgb, var(--pr-accent) 48%, transparent);
  animation: pr-anno-pulse 1.4s ease-out 2;
}
@keyframes pr-anno-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--pr-paper) 72%, transparent),
      0 0 18px color-mix(in srgb, var(--pr-accent) 48%, transparent);
  }
  45% {
    box-shadow:
      0 0 0 6px color-mix(in srgb, var(--pr-paper) 55%, transparent),
      0 0 28px color-mix(in srgb, var(--pr-accent) 62%, transparent);
  }
}
.pr-anno[data-c="yellow"] { background: var(--pr-hl); }
.pr-anno[data-c="blue"] { background: var(--pr-hl-blue); }
.pr-anno[data-c="rose"] { background: var(--pr-hl-rose); }
.pr-anno[data-c="green"] { background: var(--pr-hl-green); }
.pr-anno[data-c="purple"] { background: var(--pr-hl-purple); }
.pr-anno[data-c="orange"] { background: var(--pr-hl-orange); }
.pr-anno[data-anchor="pending"] {
  background: color-mix(in srgb, var(--pr-accent) 20%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--pr-accent) 45%, transparent);
}
.pr-anno[data-anchor="asked"] {
  background: transparent;
  border-bottom: 1px solid color-mix(in srgb, var(--pr-accent) 30%, transparent);
}
.pr-zoom-page { padding: 0 2px; font-size: 11.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }

/* 没有 PDF 时的文本视图 */
.pr-text-paper {
  width: min(760px, 100%); margin: 0 auto; padding: 40px 48px;
  background: var(--pr-paper); border: 1px solid var(--pr-line);
  border-radius: 5px; box-shadow: 0 24px 60px -30px rgba(15, 23, 42, .4);
  font-family: var(--pr-serif); font-size: 13px; line-height: 1.72; color: var(--pr-ink);
}
.pr-text-title { font-size: 15px; font-weight: 650; margin: 18px 0 8px; line-height: 1.4; }
.pr-text-para { margin: 0 0 10px; text-align: justify; }
.pr-text-paper p[data-find-mark] {
  border-radius: 4px;
  background: color-mix(in srgb, #f2c14e 32%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, #f2c14e 18%, transparent);
}

`
