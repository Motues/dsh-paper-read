/**
 * Task list page: active work and durable history.
 *
 * A row is a five-column grid on desktop and a two-column card on narrow
 * screens. State, time and token spend are separate cells so the list can be
 * scanned without reading every title.
 */
export const tasks = String.raw`
/* ── 任务列表 ─────────────────────────────────────────────────── */
.pr-tasks-page { display: flex; flex-direction: column; }

.pr-tasks-toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: -2px 0 16px;
}
.pr-tasks-search { flex: 1 1 240px; max-width: 360px; }
.pr-tasks-filter { flex: 0 0 auto; }
.pr-tasks-count {
  flex: none; font-size: 11px; color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums;
}

.pr-tasks-section { display: flex; flex-direction: column; gap: 8px; margin-bottom: 22px; }
.pr-tasks-section:last-child { margin-bottom: 0; }
.pr-tasks-section-head {
  display: flex; align-items: baseline; gap: 8px;
  padding: 0 2px;
}
.pr-tasks-section-head h2 {
  margin: 0; font-size: 12.5px; font-weight: 650; color: var(--pr-ink-2);
  letter-spacing: .01em;
}
.pr-tasks-section-head span {
  font-size: 11px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums;
}

.pr-task-table {
  display: flex; flex-direction: column;
  border: 1px solid var(--pr-line); border-radius: 11px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  overflow: hidden;
}
.pr-task-head,
.pr-task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px 172px 196px 82px;
  gap: 12px; align-items: center;
  padding: 10px 14px;
}
.pr-task-head {
  padding-top: 8px; padding-bottom: 8px;
  border-bottom: 1px solid var(--pr-line);
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
  font-size: 10.5px; font-weight: 600; color: var(--pr-ink-3);
  letter-spacing: .02em;
}
.pr-task-row {
  border-top: 1px solid var(--pr-line);
  transition: background .14s ease;
}
.pr-task-row:first-child { border-top: 0; }
.pr-task-row[data-clickable] { cursor: pointer; }
.pr-task-row[data-clickable]:hover { background: var(--dsw-alias-bg-layer-2, #f6f7f9); }
.pr-task-row[data-clickable]:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--pr-accent) 45%, transparent);
  outline-offset: -2px;
}
.pr-task-row[data-active] { background: color-mix(in srgb, var(--pr-accent) 4%, transparent); }

.pr-task-what { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.pr-task-icon {
  flex: none; width: 30px; height: 30px; border-radius: 8px;
  display: grid; place-items: center;
  color: var(--pr-ink-2);
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
  border: 1px solid var(--pr-line);
}
.pr-task-icon[data-kind="translation"] { color: var(--pr-accent); }
.pr-task-icon[data-kind="chat"] { color: #7c5cd6; }
.pr-task-icon[data-kind="relations"] { color: #2fa36b; }
.pr-task-icon[data-kind="summary"] { color: #c58b18; }
.pr-task-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pr-task-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
.pr-task-kind {
  flex: none; font-size: 9.5px; font-weight: 600; line-height: 1;
  padding: 3px 5px; border-radius: 5px;
  color: var(--pr-ink-3);
  border: 1px solid var(--pr-line);
}
.pr-task-title {
  font-size: 12.5px; font-weight: 600; color: var(--pr-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-task-sub {
  font-size: 11px; color: var(--pr-ink-3); line-height: 1.45;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-task-sub[data-error] { color: #d9534f; }
.pr-task-bar {
  height: 3px; border-radius: 99px; background: var(--pr-line);
  overflow: hidden; margin-top: 3px;
}
.pr-task-bar i {
  display: block; height: 100%; border-radius: 99px;
  background: var(--pr-accent); transition: width .2s;
}

.pr-task-state-cell { min-width: 0; }
.pr-task-state {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px;
  border-radius: 99px; border: 1px solid var(--pr-line);
  font-size: 10.5px; font-weight: 600; color: var(--pr-ink-3);
  white-space: nowrap;
}
.pr-task-state[data-state="running"] {
  color: var(--pr-accent);
  border-color: color-mix(in srgb, var(--pr-accent) 32%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-accent) 8%, transparent);
}
.pr-task-state[data-state="done"] {
  color: #2f9a6c;
  border-color: color-mix(in srgb, #2f9a6c 30%, var(--pr-line));
  background: color-mix(in srgb, #2f9a6c 8%, transparent);
}
.pr-task-state[data-state="failed"] {
  color: #d9534f;
  border-color: color-mix(in srgb, #d9534f 30%, var(--pr-line));
  background: color-mix(in srgb, #d9534f 7%, transparent);
}
.pr-task-state[data-state="queued"] {
  color: #b47a12;
  border-color: color-mix(in srgb, #b47a12 30%, var(--pr-line));
  background: color-mix(in srgb, #b47a12 7%, transparent);
}
.pr-task-dot {
  width: 6px; height: 6px; border-radius: 99px;
  background: currentColor; animation: pr-pulse 1.4s ease-in-out infinite;
}

.pr-task-time-cell,
.pr-task-cost-cell {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0; font-size: 10.5px; color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums;
}
.pr-task-cost-cell b { font-size: 11.5px; font-weight: 600; color: var(--pr-ink-2); }
.pr-task-models {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%; font-size: 10px; color: var(--pr-ink-3);
}
.pr-task-action { display: flex; align-items: center; justify-content: flex-end; gap: 6px; color: var(--pr-ink-3); }
.pr-task-action .pr-btn { flex: none; }

.pr-tasks-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  min-height: 190px; padding: 26px 20px;
  border: 1px dashed var(--pr-line-strong); border-radius: 11px;
  color: var(--pr-ink-3); text-align: center;
}
.pr-tasks-empty svg { opacity: .55; }
.pr-tasks-empty b { font-size: 13px; color: var(--pr-ink-2); font-weight: 600; }
.pr-tasks-empty span { max-width: 430px; font-size: 11.5px; line-height: 1.65; }

.pr-tasks-error {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 14px; padding: 9px 12px;
  border: 1px solid color-mix(in srgb, #d9534f 32%, var(--pr-line));
  border-radius: 9px;
  background: color-mix(in srgb, #d9534f 6%, transparent);
}
.pr-tasks-error b { font-size: 12px; color: #d9534f; }
.pr-tasks-error span { flex: 1 1 220px; font-size: 11px; color: var(--pr-ink-3); overflow-wrap: anywhere; }

.pr-tasks-more { align-self: center; margin-top: 4px; }

@media (max-width: 1080px) {
  .pr-task-head,
  .pr-task-row { grid-template-columns: minmax(0, 1fr) 86px 150px 168px 64px; gap: 10px; }
}

@media (max-width: 860px) {
  .pr-task-head { display: none; }
  .pr-task-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 10px;
    padding: 11px 12px;
  }
  .pr-task-what { grid-column: 1 / -1; }
  .pr-task-state-cell { grid-column: 1; grid-row: 2; }
  .pr-task-time-cell { grid-column: 2; grid-row: 2; text-align: right; }
  .pr-task-cost-cell {
    grid-column: 1 / -1; grid-row: 3;
    flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;
  }
  .pr-task-action { grid-column: 2; grid-row: 3; }
  .pr-task-action svg { display: none; }
  .pr-task-time-cell span:nth-child(2) { display: none; }
}

@media (max-width: 560px) {
  .pr-tasks-search { flex-basis: 100%; max-width: none; }
  .pr-tasks-count { display: none; }
}
`
