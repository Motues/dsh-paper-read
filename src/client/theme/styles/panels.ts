/**
 * 关联页签、导入卡、对话框与使用指南。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const panels = String.raw`
/* ---------------------------------------------------------------- relations */

.pr-rel-wrap { padding: 0 24px 40px; overflow: auto; flex: 1; min-height: 0; }
.pr-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 18px; }
.pr-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;
  border-radius: 99px; border: 1px solid var(--pr-line); background: var(--dsw-alias-bg-layer-1, #fff);
  font-size: 12px; color: var(--pr-ink-2); cursor: pointer;
}
.pr-chip:hover { border-color: var(--pr-line-strong); color: var(--pr-ink); }
.pr-chip b { font-weight: 600; color: var(--pr-accent); font-size: 11px; }

/* ---------------------------------------------------------------- import */

.pr-import {
  position: fixed; right: 20px; bottom: 20px; width: 336px; z-index: 70;
  border-radius: 12px; border: 1px solid var(--pr-line-strong);
  background: var(--dsw-alias-bg-overlay, #fff); box-shadow: 0 28px 70px -26px rgba(15,23,42,.5);
  padding: 13px 14px;
}
.pr-import-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.pr-import-head b { font-size: 12.5px; }
.pr-import-file { font-size: 11.5px; color: var(--pr-ink-2); display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #f4f5f7); margin-bottom: 9px; }
.pr-steps { display: flex; flex-direction: column; gap: 6px; }
.pr-step { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--pr-ink-3); }
.pr-step[data-on] { color: var(--pr-ink); }
.pr-step[data-done] { color: var(--pr-ink-2); }
.pr-step .pr-spin { width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, var(--pr-accent) 30%, transparent); border-top-color: var(--pr-accent); animation: pr-spin .7s linear infinite; }
@keyframes pr-spin { to { transform: rotate(360deg); } }
.pr-progress-line { height: 2px; border-radius: 2px; background: var(--pr-line); margin-top: 10px; overflow: hidden; }
.pr-progress-line i { display: block; height: 100%; background: var(--pr-accent); transition: width .35s ease; }

/* ---------------------------------------------------------------- dialog */

.pr-overlay {
  position: fixed; inset: 0; z-index: 90;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, #0b1220 44%, transparent);
  backdrop-filter: blur(2px);
  animation: pr-fade .14s ease-out;
}
@keyframes pr-fade { from { opacity: 0 } }

.pr-dialog {
  width: min(560px, 100%);
  border-radius: 14px;
  border: 1px solid var(--pr-line-strong);
  background: var(--dsw-alias-bg-overlay, #fff);
  box-shadow: 0 44px 100px -36px rgba(0, 0, 0, .6);
  overflow: hidden;
  animation: pr-pop .16s ease-out;
}
@keyframes pr-pop { from { opacity: 0; transform: translateY(6px) scale(.99) } }

.pr-dlg-head { display: flex; align-items: flex-start; gap: 10px; padding: 16px 16px 12px; }
.pr-dlg-head b { font-size: 14px; font-weight: 600; }
.pr-dlg-sub { font-size: 11.5px; color: var(--pr-ink-3); margin-top: 3px; line-height: 1.5; }
.pr-dlg-icon {
  width: 30px; height: 30px; border-radius: 9px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
  color: var(--pr-accent);
}
/* 整理论文：图标和标题同一行，论文标题单独占一行。 */
.pr-dlg-head[data-stacked] { flex-direction: column; align-items: stretch; gap: 7px; }
.pr-dlg-head-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pr-dlg-title {
  font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--pr-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.pr-dlg-tabs { display: flex; gap: 2px; padding: 0 16px; border-bottom: 1px solid var(--pr-line); }
.pr-dlg-tabs button {
  height: 34px; padding: 0 10px; border: 0; background: transparent;
  color: var(--pr-ink-3); font: inherit; font-size: 12.5px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; position: relative;
}
.pr-dlg-tabs button[data-on] { color: var(--pr-ink); font-weight: 550; }
.pr-dlg-tabs button[data-on]::after {
  content: ""; position: absolute; left: 6px; right: 6px; bottom: -1px; height: 2px;
  border-radius: 2px; background: var(--pr-accent);
}

.pr-dlg-body { padding: 14px 16px 4px; }
.pr-dlg-note { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--pr-ink-3); margin-top: 10px; }
.pr-dlg-foot { display: flex; align-items: center; gap: 8px; padding: 14px 16px 16px; }
.pr-dlg-hint { font-size: 11px; color: var(--pr-ink-3); flex: 1; min-width: 0; }

/* ---------------------------------------------------------------- guide */
/* The relation guide is a two-column cheat sheet: wide enough to scan, never
   taller than the window, body scrolls instead of the page. */
.pr-guide {
  width: min(780px, 100%);
  max-height: min(86vh, 760px);
  display: flex;
  flex-direction: column;
}
.pr-guide .pr-dlg-head { border-bottom: 1px solid var(--pr-line); }
.pr-guide .pr-dlg-body { overflow: auto; padding-bottom: 12px; }
.pr-guide .pr-dlg-foot { border-top: 1px solid var(--pr-line); }
.pr-guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.pr-guide-card {
  min-width: 0;
  border: 1px solid var(--pr-line); border-radius: 10px; padding: 10px 11px 9px;
  background: color-mix(in srgb, var(--pr-ink) 2.5%, transparent);
}
.pr-guide-card h4 {
  margin: 0 0 6px; font-size: 11.5px; font-weight: 650; color: var(--pr-ink);
  display: flex; align-items: center; gap: 5px;
}
.pr-guide-card ul { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 4px; }
.pr-guide-card li { font-size: 11px; line-height: 1.62; color: var(--pr-ink-2); }
.pr-guide-card li b { color: var(--pr-ink); font-weight: 600; }
.pr-guide .pr-kbd { font-family: inherit; font-size: 10px; line-height: 15px; white-space: nowrap; }
.pr-guide-prefixes { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px; }
.pr-guide-auto { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--pr-ink-3); cursor: pointer; }
.pr-guide-auto input { accent-color: var(--pr-accent); margin: 0; }
@media (max-width: 720px) {
  .pr-guide-grid { grid-template-columns: minmax(0, 1fr); }
  .pr-guide { max-height: 92vh; }
}

.pr-drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  padding: 26px 18px; border-radius: 12px; text-align: center; cursor: pointer;
  border: 1.5px dashed var(--pr-line-strong);
  background: color-mix(in srgb, var(--pr-ink-3) 4%, transparent);
  transition: border-color .15s, background .15s;
}
.pr-drop:hover, .pr-drop[data-drag="true"] {
  border-color: color-mix(in srgb, var(--pr-accent) 60%, var(--pr-line-strong));
  background: color-mix(in srgb, var(--pr-accent) 7%, transparent);
}
.pr-drop[data-filled="true"] {
  border-style: solid;
  border-color: color-mix(in srgb, var(--pr-accent) 38%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-accent) 6%, transparent);
}
.pr-drop-icon {
  width: 38px; height: 38px; border-radius: 11px; margin-bottom: 3px;
  display: flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: 1px solid var(--pr-line); color: var(--pr-ink-2);
}
.pr-drop-title { font-size: 13px; font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-drop-hint { font-size: 11.5px; color: var(--pr-ink-3); }
.pr-drop-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
.pr-drop[aria-disabled="true"] { opacity: .68; cursor: default; }
.pr-upload-progress { height: 3px; border-radius: 99px; background: var(--pr-line); overflow: hidden; margin-top: 12px; }
.pr-upload-progress i { display: block; height: 100%; background: var(--pr-accent); transition: width .2s ease; }

.pr-field-label { display: block; font-size: 11.5px; color: var(--pr-ink-2); margin-bottom: 6px; }
.pr-field-input {
  display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 10px;
  border-radius: 9px; border: 1px solid var(--pr-line-strong);
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink-3);
  transition: border-color .15s, box-shadow .15s;
}
.pr-field-input:focus-within {
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-field-input[data-invalid="true"] { border-color: color-mix(in srgb, #e5484d 55%, var(--pr-line-strong)); }
.pr-field-input input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--pr-ink); font: inherit; font-size: 12.5px; }
.pr-field-input input::placeholder { color: var(--pr-ink-3); }
.pr-field-clear {
  width: 20px; height: 20px; border: 0; border-radius: 5px; background: transparent;
  color: var(--pr-ink-3); display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.pr-field-clear:hover { background: var(--dsw-alias-bg-layer-2, #f4f5f7); color: var(--pr-ink); }

.pr-examples { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; font-size: 11px; color: var(--pr-ink-3); }
.pr-examples button {
  border: 1px solid var(--pr-line); background: transparent; color: var(--pr-ink-2);
  border-radius: 99px; padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer;
}
.pr-examples button:hover { border-color: var(--pr-line-strong); color: var(--pr-ink); }

.pr-btn:disabled { opacity: .45; cursor: default; }

`
