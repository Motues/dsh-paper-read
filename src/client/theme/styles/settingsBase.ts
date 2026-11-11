/**
 * 设置页头部与基础卡片。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const settingsBase = String.raw`
/* 设置页 */
.pr-settings { display: flex; flex-direction: column; gap: 14px; max-width: 780px; }
.pr-card-panel {
  border: 1px solid var(--pr-line); border-radius: 12px;
  padding: 14px 16px 16px; background: var(--pr-paper);
}
.pr-panel-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; margin-bottom: 7px;
}
.pr-panel-note { font-size: 11.5px; line-height: 1.62; color: var(--pr-ink-3); margin: 0 0 8px; }
.pr-panel-note:last-child { margin-bottom: 0; }
.pr-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; word-break: break-all; }
.pr-number { display: flex; align-items: center; gap: 6px; color: var(--pr-ink-3); font-size: 11.5px; }
.pr-number input {
  width: 68px; height: 26px; padding: 0 7px; text-align: right;
  border: 1px solid var(--pr-line-strong); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 12px;
}
.pr-field-row { display: flex; gap: 10px; margin-top: 6px; }
.pr-field-row .pr-field { flex: 1 1 0; min-width: 0; }
.pr-field > input {
  width: 100%; height: 30px; padding: 0 11px;
  border: 1px solid var(--pr-line-strong); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 12px; outline: none;
}
.pr-field > input:focus { border-color: var(--pr-accent); }
.pr-settings-message {
  font-size: 11.5px; color: var(--pr-ink-2);
  padding: 8px 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
}
.pr-missing { margin-top: 8px; border-top: 1px solid var(--pr-line); padding-top: 8px; }
.pr-missing-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 11.5px; }
.pr-missing-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-missing-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

/* 文本回退提示 */
.pr-fallback-note {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 14px; padding: 8px 10px;
  border: 1px solid var(--pr-line); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
  font-size: 11.5px; color: var(--pr-ink-2); line-height: 1.5;
}
.pr-fallback-note span { flex: 1 1 auto; min-width: 0; }

`
