/**
 * 全文翻译菜单与左右对照页。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const translation = String.raw`
/* ── full-text translation ──────────────────────────────────────────────── */
/* The menu hangs off a toolbar icon; it owns starting, stopping and the three
   display modes. */
.pr-translate { position: relative; flex: none; display: inline-flex; }
.pr-translate-toggle[data-on] {
  color: var(--pr-accent);
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-translate-toggle[data-running] { color: var(--pr-accent); }
.pr-translate-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 50;
  width: 272px; padding: 11px 12px 10px; border-radius: 12px;
  background-color: var(--pr-popover-base);
  background-image: linear-gradient(var(--dsw-alias-bg-overlay, transparent), var(--dsw-alias-bg-overlay, transparent));
  border: 1px solid var(--pr-line); box-shadow: 0 10px 30px rgba(15, 23, 42, .18);
  font-size: 11.5px; color: var(--pr-ink-2);
}
.pr-translate-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.pr-translate-head b { font-size: 12px; font-weight: 650; color: var(--pr-ink); }
.pr-translate-head span { font-size: 10.5px; color: var(--pr-ink-3); text-align: right; }
.pr-translate-error {
  margin-top: 7px; padding: 6px 7px; border-radius: 6px;
  background: color-mix(in srgb, #d9534f 10%, transparent);
  color: #c04542; font-size: 10.5px; line-height: 1.5; overflow-wrap: anywhere;
}
.pr-translate-source {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  margin-top: 5px; color: var(--pr-ink-3); font-size: 10.5px; line-height: 1.45;
}
.pr-translate-source span:first-child {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-translate-source span:last-child {
  flex: none; max-width: 60%; color: var(--pr-accent);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-translate-hint {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  margin-top: 7px; padding: 6px 7px; border-radius: 6px;
  background: color-mix(in srgb, var(--pr-ink) 5%, transparent);
  color: var(--pr-ink-2); font-size: 10.5px; line-height: 1.5; overflow-wrap: anywhere;
}
.pr-translate-hint > span { flex: 1 1 auto; min-width: 0; }
.pr-translate-hint .pr-btn { flex: none; height: 24px; padding: 0 8px; font-size: 10.5px; }
.pr-translate-hint[data-tone="warn"] {
  background: color-mix(in srgb, #d99a2b 12%, transparent);
  color: #9a6411;
}
.pr-root[data-scheme="dark"] .pr-translate-hint[data-tone="warn"] { color: #e7b36a; }
.pr-translate-actions { display: flex; gap: 6px; margin-top: 9px; }
.pr-translate-actions .pr-btn { flex: 1 1 0; justify-content: center; }
.pr-translate-views {
  display: flex; gap: 2px; margin-top: 9px; padding: 2px;
  border-radius: 8px; background: color-mix(in srgb, var(--pr-ink) 5%, transparent);
}
.pr-translate-views button {
  flex: 1 1 0; height: 24px; border: 0; border-radius: 6px;
  background: transparent; color: var(--pr-ink-2);
  font: inherit; font-size: 11px; cursor: pointer;
}
.pr-translate-views button[data-on] {
  background: var(--pr-paper); color: var(--pr-ink); font-weight: 550;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .12);
}
.pr-translate-note { margin-top: 8px; font-size: 10.5px; line-height: 1.5; color: var(--pr-ink-3); }

/* One slide: original page and translated page share the row, page for page. */
.pr-bipage {
  display: flex; align-items: flex-start; gap: 24px;
  width: max-content; margin: 0 auto;
}
.pr-bipage[data-mode="only"] { gap: 0; }
.pr-bipage > .pr-pdfpage,
.pr-bipage > .pr-text-paper,
.pr-bipage > .pr-transpage { margin: 0; }
.pr-page-slot > .pr-bipage { margin: 0 auto; }
.pr-spread[data-mode="bilingual"] { width: max-content; justify-content: flex-start; }

/* The translated page is a page-sized surface built from the parsed blocks:
   same bbox, same font size, so the two columns line up. */
.pr-transpage {
  position: relative; flex: none; overflow: hidden;
  background: var(--pr-paper); border-radius: 3px;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--pr-line-strong) 42%, transparent),
    0 1px 2px rgba(15, 23, 42, .08),
    0 12px 32px rgba(15, 23, 42, .18);
  color: var(--pr-ink); font-family: var(--pr-serif);
}
.pr-transpage-stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.pr-transblock {
  position: absolute; overflow: hidden;
  white-space: pre-wrap; overflow-wrap: break-word; word-break: normal;
  line-break: strict; hyphens: manual;
  line-height: 1.38; text-align: left;
  color: var(--pr-ink);
}
.pr-transblock[data-kind="title"] { font-weight: 650; text-align: left; }
.pr-transblock[data-kind="caption"] { color: var(--pr-ink-2); text-align: left; }
.pr-transblock[data-original] { color: var(--pr-ink-3); }
.pr-transpage-note {
  position: absolute; left: 12px; right: 12px; bottom: 12px;
  padding: 8px 10px; border-radius: 8px;
  background: color-mix(in srgb, var(--pr-ink) 5%, transparent);
  color: var(--pr-ink-3); font-family: var(--ds-font-family, sans-serif);
  font-size: 11px; text-align: center;
}
.pr-root[data-scheme="dark"] .pr-transpage {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, .1),
    0 1px 2px rgba(0, 0, 0, .46),
    0 12px 32px rgba(0, 0, 0, .58);
}

/* ── translated page: white paper, original bitmap underneath ───────────── */
/* A translated page stands in for a printed sheet, not for app chrome: it is
   always white with near-black ink, including in the dark theme. */
.pr-transpage {
  background: #fff;
  color: #111;
}
.pr-trans-canvas {
  position: absolute; top: 0; left: 0; z-index: 0;
  width: 100%; height: 100%; display: block;
  pointer-events: none;
}
.pr-trans-mask-layer { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.pr-trans-mask { position: absolute; display: block; background: #fff; }
.pr-transblock { z-index: 2; color: #111; }
.pr-transblock[data-kind="title"] { color: #000; }
.pr-transblock[data-kind="caption"] { color: #333; }
.pr-transblock[data-original] { color: #4b5563; }
.pr-transpage-note {
  background: #f3f4f6; color: #4b5563;
  border: 1px solid #e5e7eb; font-family: var(--ds-font-family, sans-serif);
}
.pr-root[data-scheme="dark"] .pr-transpage {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, .08),
    0 1px 2px rgba(0, 0, 0, .46),
    0 16px 40px rgba(0, 0, 0, .62);
}

/* ── continuous reflowed translation ────────────────────────────────────── */
.pr-reflow-root {
  width: 100%; display: flex; justify-content: center;
  padding: 24px 18px 48px; box-sizing: border-box;
}
.pr-reflow-sheet {
  width: min(860px, 100%); box-sizing: border-box;
  background: #fff; color: #111;
  padding: 56px 64px 72px; border-radius: 4px;
  font-family: var(--pr-serif);
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, .08),
    0 1px 2px rgba(15, 23, 42, .1),
    0 18px 48px rgba(15, 23, 42, .18);
}
.pr-root[data-scheme="dark"] .pr-reflow-sheet {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, .08),
    0 1px 2px rgba(0, 0, 0, .46),
    0 20px 56px rgba(0, 0, 0, .64);
}
.pr-reflow-progress {
  position: sticky; top: 0; z-index: 5;
  margin: -24px 0 20px; padding: 7px 10px; border-radius: 6px;
  background: #fff8e1; color: #7a4b00; font-size: 12px;
  font-family: var(--ds-font-family, sans-serif); text-align: center;
}
.pr-reflow-progress[data-warn] { background: #f3f4f6; color: #4b5563; }
.pr-reflow-error {
  margin: 0 0 18px; padding: 8px 10px; border-radius: 6px;
  background: #fdecec; color: #a12a2a; font-size: 12px;
  font-family: var(--ds-font-family, sans-serif);
}
.pr-reflow-head { margin-bottom: 30px; }
.pr-reflow-head h1 {
  margin: 0 0 10px; font-size: 30px; line-height: 1.35;
  font-weight: 700; letter-spacing: .01em;
}
.pr-reflow-authors { margin: 0 0 4px; font-size: 13.5px; color: #333; line-height: 1.6; }
.pr-reflow-meta { margin: 0; font-size: 12.5px; color: #666; }
.pr-reflow-page { position: relative; }
.pr-reflow-page + .pr-reflow-page { margin-top: 18px; }
.pr-reflow-h2 {
  margin: 1.7em 0 .6em; font-size: 21px; line-height: 1.45;
  font-weight: 700; color: #111;
}
.pr-reflow-h3 {
  margin: 1.35em 0 .45em; font-size: 17px; line-height: 1.5;
  font-weight: 650; color: #111;
}
.pr-reflow-para {
  margin: 0 0 .55em; text-indent: 2em;
  text-align: justify; text-justify: inter-character;
  font-size: calc(16px * var(--pr-reflow-scale, 1));
  line-height: 1.85; color: #111; overflow-wrap: break-word;
}
.pr-reflow-para[data-pending] { color: #6b7280; }
.pr-reflow-para[data-source] { color: #374151; }
.pr-reflow-caption {
  margin: .35em 0 1.1em; font-size: 13px; line-height: 1.65;
  color: #444; text-align: left; overflow-wrap: break-word;
}
.pr-reflow-caption[data-pending] { color: #6b7280; }
.pr-reflow-figure {
  margin: 18px auto 12px; max-width: 100%; text-align: center;
}
.pr-reflow-equation {
  margin: 16px auto 14px; max-width: 100%; text-align: center;
}
.pr-reflow-crop {
  display: block; width: 100%; height: auto; margin: 0 auto;
}
.pr-reflow-figure .pr-reflow-crop { margin: 0 auto; }
.pr-reflow-crop-ghost {
  height: 110px; border-radius: 4px;
  background: repeating-linear-gradient(90deg, #f6f7f9 0 22px, #eef0f3 22px 44px);
}
.pr-reflow-visual-missing {
  margin: 16px auto; padding: 18px 12px; border: 1px dashed #d1d5db;
  border-radius: 6px; color: #6b7280; font-size: 12px; text-align: center;
  font-family: var(--ds-font-family, sans-serif);
}
.pr-reflow-page-mark {
  margin: 26px 0 4px; text-align: center;
  color: #9ca3af; font-size: 11px; letter-spacing: .08em;
  font-family: var(--ds-font-family, sans-serif);
}
.pr-reflow-empty {
  margin: 12px 0 0; color: #9ca3af; font-size: 12.5px; text-align: center;
  font-family: var(--ds-font-family, sans-serif);
}
.pr-reflow-refs {
  margin-top: 34px; padding-top: 14px; border-top: 1px solid #e5e7eb;
  font-family: var(--ds-font-family, sans-serif);
}
.pr-reflow-refs summary {
  cursor: pointer; color: #374151; font-size: 13px; font-weight: 600;
  list-style: none;
}
.pr-reflow-refs summary::-webkit-details-marker { display: none; }
.pr-reflow-refs summary::before { content: '▸ '; color: #9ca3af; }
.pr-reflow-refs[open] summary::before { content: '▾ '; }
.pr-reflow-refs p {
  margin: .55em 0 0; font-size: 12px; line-height: 1.65; color: #4b5563;
  overflow-wrap: anywhere;
}
.pr-reflow-loading {
  padding: 60px 0; text-align: center; color: #6b7280; font-size: 13px;
  font-family: var(--ds-font-family, sans-serif);
}
@media (max-width: 760px) {
  .pr-reflow-root { padding: 14px 10px 32px; }
  .pr-reflow-sheet { padding: 30px 22px 44px; }
  .pr-reflow-head h1 { font-size: 24px; }
  .pr-reflow-h2 { font-size: 19px; }
  .pr-reflow-h3 { font-size: 16px; }
}

`
