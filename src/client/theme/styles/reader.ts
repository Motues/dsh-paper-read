/**
 * 阅读器工具栏、页面、左栏、选区工具条。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const reader = String.raw`
/* ---------------------------------------------------------------- reader */

.pr-reader { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
/* Reader toolbar: rail collapse · rail view switch · page + zoom · layout / read / AI. */
.pr-reader-toolbar {
  display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center; gap: 12px;
  height: 40px; padding: 0 10px; flex: none;
  border-bottom: 1px solid var(--pr-line);
}
.pr-rt-left { display: flex; align-items: center; gap: 6px; min-width: 0; justify-self: start; }
.pr-rt-center { display: flex; align-items: center; gap: 8px; justify-self: center; }
.pr-rt-right { display: flex; align-items: center; gap: 6px; justify-self: end; }
.pr-rail-toggle[data-collapsed] { color: var(--pr-ink); }
.pr-page-nav {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums;
}
.pr-page-input {
  width: 36px; height: 24px; padding: 0 3px;
  border: 1px solid var(--pr-line); border-radius: 6px;
  background: transparent; color: var(--pr-ink-2);
  font: inherit; font-size: 11.5px; text-align: center;
  font-variant-numeric: tabular-nums; outline: 0;
  transition: border-color .15s, box-shadow .15s, color .15s;
}
.pr-page-input:hover { border-color: var(--pr-line-strong); }
.pr-page-input:focus {
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pr-accent) 12%, transparent);
  color: var(--pr-ink);
}
.pr-page-range { color: var(--pr-ink-3); }
.pr-tool-sep { width: 1px; height: 16px; background: var(--pr-line); margin: 0 2px; flex: none; }
.pr-read-toggle { transition: background .15s, color .15s; }
.pr-read-toggle[data-done] {
  color: var(--pr-accent);
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--pr-accent) 28%, transparent);
}
.pr-read-toggle[data-done]:hover { background: color-mix(in srgb, var(--pr-accent) 18%, transparent); }

/* The reader's two icon segments are bare groups: the active pill alone marks
   the state. Scoped to this toolbar so the library's status filters and the
   card/list switch keep their bordered segments. */
.pr-reader-toolbar .pr-seg { padding: 0; border-color: transparent; background: transparent; }
.pr-reader-toolbar .pr-seg button:not([data-on]):hover {
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
  color: var(--pr-ink-2);
}

/* Find-in-paper: one magnifier that grows into a field, mirroring the folder
   rail's search. The hit list is a sibling so the morph's overflow clip cannot
   cut it off. */
.pr-reader-search-wrap { position: relative; flex: none; display: flex; align-items: center; }
.pr-reader-search {
  display: flex; align-items: center; gap: 0;
  width: 32px; height: 28px; min-width: 0;
  padding: 0; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--pr-ink-3);
  cursor: pointer; overflow: hidden;
  transition: width 180ms var(--ds-ease-in-out, ease), padding 180ms var(--ds-ease-in-out, ease), border-color 180ms var(--ds-ease-in-out, ease), background-color 180ms var(--ds-ease-in-out, ease);
}
.pr-reader-search[data-open] {
  width: 252px; padding: 0 3px 0 1px;
  border-color: var(--pr-line-strong);
  background: var(--dsw-alias-bg-layer-1, #fff);
  cursor: text;
}
.pr-reader-search-toggle {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 26px; padding: 0;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer;
}
.pr-reader-search-toggle:hover { background: color-mix(in srgb, var(--pr-ink) 9%, transparent); color: var(--pr-ink); }
.pr-reader-search[data-open] .pr-reader-search-toggle { color: var(--pr-ink-2); }
.pr-reader-search-input {
  flex: 1 1 auto; width: 0; min-width: 0;
  border: 0; outline: 0; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12px;
  opacity: 0; pointer-events: none;
  transition: opacity 120ms var(--ds-ease-in-out, ease);
}
.pr-reader-search-input::-webkit-search-cancel-button { display: none; }
.pr-reader-search[data-open] .pr-reader-search-input { opacity: 1; pointer-events: auto; margin-left: 2px; }
.pr-reader-search-clear {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; max-width: 0; padding: 0;
  border: 0; border-radius: 5px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer; overflow: hidden;
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: max-width 120ms var(--ds-ease-in-out, ease), opacity 120ms var(--ds-ease-in-out, ease), visibility 0s linear 120ms;
}
.pr-reader-search-clear[data-show] {
  max-width: 22px; opacity: 1; visibility: visible; pointer-events: auto;
  transition-delay: 0s;
}
.pr-reader-search-clear:hover { background: color-mix(in srgb, var(--pr-ink) 9%, transparent); color: var(--pr-ink); }

.pr-reader-find {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
  width: 336px; max-height: 320px; overflow: hidden auto;
  padding: 4px;
  border: 1px solid var(--pr-line-strong); border-radius: 10px;
  background: var(--pr-popover-base, #fff);
  box-shadow: 0 18px 42px -22px rgba(15, 23, 42, .48);
  animation: pr-pop 160ms ease-out;
}
.pr-reader-find-head {
  padding: 4px 8px 6px; font-size: 11px; color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums;
}
.pr-reader-find-head[data-error] { color: #d9534f; }
.pr-reader-find-row {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  padding: 6px 8px; border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 12px; line-height: 1.5;
  text-align: left; cursor: pointer;
}
.pr-reader-find-row:hover { background: color-mix(in srgb, var(--pr-ink) 6%, transparent); }
.pr-reader-find-row[data-active] {
  background: color-mix(in srgb, var(--pr-accent) 11%, transparent);
  color: var(--pr-ink);
}
.pr-reader-find-page {
  flex: none; padding: 1px 6px; border-radius: 99px;
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
  color: var(--pr-ink-3);
  font-size: 10.5px; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pr-reader-find-row[data-active] .pr-reader-find-page {
  color: var(--pr-accent);
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-reader-find-quote {
  min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.pr-reader-find-quote mark {
  padding: 0 1px; border-radius: 2px;
  background: color-mix(in srgb, #f2c14e 55%, transparent);
  color: #2b2a24;
}

.pr-reader-body { flex: 1 1 auto; min-height: 0; display: flex; position: relative; }
.pr-rail {
  width: 120px; flex: none; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
  /* Reset the legacy "pr-body" rail padding above: that 20px left / 10px
     right inset would clip the fixed-width inner. */
  padding: 0;
  opacity: 1;
  /* The rail is its own zone: one hairline separates it from the paper, the
     same way the AI panel draws its left edge. */
  border-right: 1px solid var(--pr-line);
}
.pr-rail[data-mode="title"] { width: 212px; }
/* Collapse clips the fixed-width inner column instead of reflowing every
   thumbnail; visibility flips only after the width transition finishes. */
.pr-rail[data-collapsed] {
  opacity: 0; visibility: hidden; pointer-events: none;
  border-right-color: transparent;
  transition: width 200ms cubic-bezier(.2, .8, .2, 1), opacity 140ms ease, border-color 140ms ease, visibility 0s linear 200ms;
}
.pr-rail-inner {
  /* Column flex: this must shrink to the rail height or the thumbnail list
     grows to its full content and can never scroll. Width is cross-size, so the
     inline fixed width still controls the collapse clipping. */
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
}
.pr-thumbs {
  flex: 1 1 auto; min-height: 0; width: auto;
  overflow-y: auto; overflow-x: hidden;
  padding: 8px 6px 28px 8px; display: flex; flex-direction: column; gap: 9px;
}
/* The rail is narrow, so its bar runs thinner than the transcript's. */
.pr-thumbs::-webkit-scrollbar { width: 6px; }
.pr-thumb {
  position: relative; width: 100%; flex: none; aspect-ratio: 1 / 1.294;
  border-radius: 5px; overflow: hidden;
  border: 1px solid var(--pr-line); background: var(--pr-paper);
  color: var(--pr-ink-3); font: inherit; font-size: 10px; font-variant-numeric: tabular-nums;
  cursor: pointer; padding: 0;
  transition: border-color .15s, box-shadow .15s;
}
.pr-thumb:hover { border-color: var(--pr-line-strong); }
.pr-thumb[data-on] { border-color: var(--pr-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pr-accent) 22%, transparent); }
.pr-thumb-canvas {
  position: relative; z-index: 1; display: block; width: 100%; height: 100%;
  object-fit: contain; background: var(--pr-paper); opacity: 0;
  transition: opacity .18s ease;
}
.pr-thumb[data-ready="1"] .pr-thumb-canvas { opacity: 1; }
.pr-thumb[data-preview="1"]::before {
  content: ""; position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(105deg, transparent 24%, color-mix(in srgb, var(--pr-ink) 6%, transparent) 46%, transparent 68%);
  background-size: 220% 100%;
  animation: pr-thumb-shimmer 1.5s linear infinite;
}
.pr-thumb[data-ready="1"]::before { display: none; }
@keyframes pr-thumb-shimmer { from { background-position: 140% 0; } to { background-position: -80% 0; } }
.pr-thumb-num {
  position: absolute; z-index: 2; right: 4px; bottom: 4px;
  min-width: 18px; height: 16px; padding: 0 4px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 99px;
  background: color-mix(in srgb, var(--pr-paper) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--pr-line-strong) 65%, transparent);
  color: var(--pr-ink-3); font-size: 9.5px; line-height: 1;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(3px);
}
.pr-thumb[data-on] .pr-thumb-num {
  color: var(--pr-accent);
  border-color: color-mix(in srgb, var(--pr-accent) 55%, transparent);
}
.pr-thumb-marks {
  position: absolute; z-index: 3; top: 4px; left: 4px;
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px 3px; border-radius: 99px;
  background: color-mix(in srgb, var(--pr-paper) 86%, transparent);
  box-shadow: 0 1px 3px rgba(15, 23, 42, .12);
  pointer-events: none;
}
.pr-thumb-marks i { width: 4px; height: 4px; border-radius: 50%; background: var(--pr-hl); }
.pr-thumb-marks i[data-c="blue"] { background: var(--pr-hl-blue); }
.pr-thumb-marks i[data-c="rose"] { background: var(--pr-hl-rose); }
.pr-thumb-marks i[data-c="green"] { background: var(--pr-hl-green); }
.pr-thumb-marks i[data-c="purple"] { background: var(--pr-hl-purple); }
.pr-thumb-marks i[data-c="orange"] { background: var(--pr-hl-orange); }
.pr-thumb-marks b {
  margin-left: 1px; color: var(--pr-ink-3);
  font: inherit; font-size: 8px; line-height: 1; font-weight: 600;
}

/* Title mode: the PDF outline when the document has bookmarks, else one row
   per page with its first text line. */
.pr-title-list { display: flex; flex-direction: column; gap: 1px; padding: 1px 0 10px; width: 100%; }
.pr-title-row {
  display: flex; align-items: flex-start; gap: 6px; width: 100%;
  padding: 5px 7px; border: 0; border-radius: 6px;
  background: transparent; color: var(--pr-ink-2);
  font: inherit; font-size: 11.5px; line-height: 1.42; text-align: left;
  cursor: pointer; transition: background .12s, color .12s;
}
.pr-title-row:hover { background: color-mix(in srgb, var(--pr-ink) 7%, transparent); color: var(--pr-ink); }
.pr-title-row[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
  color: var(--pr-ink);
}
.pr-title-row[data-depth="1"] { padding-left: 17px; }
.pr-title-row[data-depth="2"] { padding-left: 27px; }
.pr-title-row[data-depth="3"] { padding-left: 37px; }
.pr-title-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-title-text[data-placeholder] { color: var(--pr-ink-3); }
.pr-title-empty { padding: 12px 8px; font-size: 11.5px; color: var(--pr-ink-3); }

.pr-stage-wrap { flex: 1 1 auto; min-width: 0; position: relative; display: flex; }
.pr-stage {
  flex: 1 1 auto; min-width: 0; overflow: auto; padding: 24px 26px 36px;
  scrollbar-width: none; -ms-overflow-style: none; overscroll-behavior: contain;
}
.pr-stage::-webkit-scrollbar { display: none; width: 0; height: 0; }

/* Single/spread layout: the row is as wide as its pages and centred while it
   fits; when zoomed past the stage it starts at the left edge so the left page
   is never clipped away by flex centering. */
.pr-spread { display: flex; align-items: flex-start; gap: 24px; width: max-content; margin: 0 auto; }
.pr-spread .pr-pdfpage,
.pr-spread .pr-text-paper { margin: 0; }
/* Text fallback has no fixed page geometry: keep it inside the stage instead
   of forcing a 760px canvas that overflows a narrow reader. */
.pr-spread[data-text] { width: 100%; justify-content: center; }
.pr-spread[data-text][data-count="1"] .pr-text-paper { width: min(760px, 100%); }
.pr-spread[data-text][data-count="2"] .pr-text-paper { width: min(380px, calc(50% - 12px)); padding: 30px 32px; }

/* Continuous layout: every page keeps its slot; only slots near the viewport
   mount a real page. */
.pr-continuous { position: relative; display: flex; flex-direction: column; align-items: center; gap: 18px; width: 100%; }
.pr-page-slot { position: relative; width: 100%; display: block; }
.pr-page-slot > .pr-pdfpage { margin: 0 auto; }
.pr-page-ghost {
  width: min(760px, 100%); border-radius: 4px;
  background: color-mix(in srgb, var(--pr-ink) 4%, transparent);
}

/* Zoom controls live in the reader toolbar now, not in a floating pill. */
.pr-zoom { display: inline-flex; align-items: center; gap: 1px; }
.pr-zoom button {
  height: 24px; min-width: 26px; padding: 0 6px;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.pr-zoom button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f4f5f7); }
.pr-zoom button:disabled { opacity: .35; cursor: default; }
.pr-zoom-pct { min-width: 46px; font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--pr-ink-2); }
.pr-zoom-fit { color: var(--pr-ink-2); }
.pr-sheet {
  position: relative;
  width: min(800px, 100%);
  margin: 0 auto;
  padding: 46px 54px 30px;
  border-radius: 5px;
  background: var(--pr-paper);
  border: 1px solid var(--pr-line);
  box-shadow: 0 24px 60px -30px rgba(15,23,42,.4), 0 2px 6px rgba(15,23,42,.06);
  min-height: 74vh;
}
.pr-sheet ::selection { background: color-mix(in srgb, var(--pr-accent) 24%, transparent); }

.pr-paper-kicker { font-family: var(--pr-serif); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--pr-ink-3); text-align: center; margin-bottom: 12px; }
.pr-paper-title { font-family: var(--pr-serif); font-size: 22px; line-height: 1.24; font-weight: 600; letter-spacing: -.01em; text-align: center; margin: 0 0 10px; }
.pr-paper-authors { font-family: var(--pr-serif); font-size: 11.5px; line-height: 1.65; text-align: center; color: var(--pr-ink); opacity: .82; }
.pr-paper-affil { font-family: var(--pr-serif); font-size: 10.5px; text-align: center; color: var(--pr-ink-3); margin-top: 6px; }
.pr-abstract { font-family: var(--pr-serif); font-size: 11.5px; line-height: 1.62; text-align: justify; margin: 20px 0 22px; color: var(--pr-ink); opacity: .9; }
.pr-abstract-label { font-weight: 700; }
.pr-article {
  column-count: 2;
  column-gap: 28px;
  column-rule: 0;
  font-family: var(--pr-serif);
  font-size: 11.6px;
  line-height: 1.66;
  text-align: justify;
  hyphens: auto;
  color: var(--pr-ink);
}
.pr-article h2 {
  font-size: 11.8px;
  font-weight: 700;
  margin: 13px 0 5px;
  break-after: avoid;
  page-break-after: avoid;
}
.pr-article h2:first-child { margin-top: 0; }
.pr-article p { margin: 0 0 7px; orphans: 2; widows: 2; }
.pr-article em { font-style: italic; }
.pr-eq { margin: 9px 0 10px; text-align: center; font-style: italic; break-inside: avoid; }
.pr-page-foot { margin-top: 26px; text-align: center; font-family: var(--pr-serif); font-size: 10px; color: var(--pr-ink-3); }
.pr-ghost-page { min-height: 58vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--pr-ink-3); font-family: var(--pr-serif); }
.pr-ghost-mark { font-size: 34px; font-weight: 700; opacity: .18; }
.pr-ghost-hint { font-size: 11px; opacity: .8; }

.pr-sheet mark.pr-hl { background: var(--pr-hl); color: inherit; border-radius: 2px; padding: 1px 0; box-decoration-break: clone; -webkit-box-decoration-break: clone; cursor: pointer; }
.pr-sheet mark.pr-hl[data-c="blue"] { background: var(--pr-hl-blue); }
.pr-sheet mark.pr-hl[data-c="rose"] { background: var(--pr-hl-rose); }
.pr-sheet mark.pr-hl[data-c="green"] { background: var(--pr-hl-green); }
.pr-sheet mark.pr-hl[data-c="purple"] { background: var(--pr-hl-purple); }
.pr-sheet mark.pr-hl[data-c="orange"] { background: var(--pr-hl-orange); }
/* The passage under discussion stays tinted so the reader can see the line
   the assistant is talking about, even after the native selection is gone. */
.pr-sheet mark.pr-hl-pending {
  background: color-mix(in srgb, var(--pr-accent) 20%, transparent);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--pr-accent) 55%, transparent);
  border-radius: 2px;
}
.pr-sheet mark.pr-hl-asked {
  background: transparent;
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--pr-accent) 30%, transparent);
}

/* selection toolbar + marginal note (fixed, above everything in the page) */
.pr-toolbar {
  position: fixed; z-index: 60;
  transform: translate(-50%, -100%);
  display: flex; align-items: center; gap: 1px;
  padding: 3px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--pr-line-strong);
  box-shadow: 0 14px 34px -12px rgba(15,23,42,.42);
}
.pr-toolbar button {
  height: 25px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
}
.pr-toolbar button:hover { background: var(--dsw-alias-bg-layer-2, #f4f5f7); }
.pr-toolbar .pr-sep { width: 1px; height: 14px; background: var(--pr-line); margin: 0 3px; }
.pr-swatches { display: flex; align-items: center; gap: 5px; padding: 0 5px; }
.pr-toolbar .pr-swatch {
  width: 16px; height: 16px; flex: none; padding: 0;
  border-radius: 4px; border: 1px solid rgba(15,23,42,.16);
  cursor: pointer;
}
.pr-toolbar .pr-swatch:hover { transform: scale(1.08); }

.pr-bubble {
  position: fixed; z-index: 59;
  width: 316px; max-height: 46vh; overflow: auto;
  overscroll-behavior: contain; scrollbar-width: thin;
  padding: 11px 12px 10px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--pr-line-strong);
  box-shadow: 0 24px 60px -22px rgba(15,23,42,.46);
}
.pr-bubble-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--pr-ink-3); margin-bottom: 7px; }
.pr-bubble-quote { font-size: 11.5px; line-height: 1.55; color: var(--pr-ink-2); border-left: 2px solid color-mix(in srgb, var(--pr-accent) 45%, transparent); padding-left: 8px; margin-bottom: 9px; max-height: 62px; overflow: hidden; overflow-wrap: anywhere; }
.pr-bubble-body { font-size: 12.5px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.pr-bubble-foot { display: flex; align-items: center; gap: 6px; margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--pr-line); }
.pr-caret { display: inline-block; width: 6px; height: 13px; margin-left: 1px; vertical-align: -2px; background: var(--pr-accent); opacity: .75; animation: pr-blink 1s steps(1) infinite; }
@keyframes pr-blink { 50% { opacity: 0; } }
.pr-cite {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 8px;
  font-size: 10.5px; color: var(--pr-ink-3); background: var(--dsw-alias-bg-layer-2, #f4f5f7);
  border-radius: 99px; padding: 1px 7px;
}

`
