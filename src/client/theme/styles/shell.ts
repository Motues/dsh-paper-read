/**
 * 页面头/体、卡片、列表、顶栏与可拖拽分栏。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const shell = String.raw`
/* ---------------------------------------------------------------- head */

.pr-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 24px 14px;
  flex: none;
}
.pr-head-title { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
.pr-head-title h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.012em; white-space: nowrap; }
.pr-head-sub { font-size: 12px; color: var(--pr-ink-3); white-space: nowrap; }
.pr-spacer { flex: 1 1 auto; min-width: 8px; }

.pr-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  min-width: 170px;
  max-width: 320px;
  flex: 1 1 200px;
  border: 1px solid var(--pr-line);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--pr-ink-3);
  transition: border-color .15s, box-shadow .15s;
}
.pr-search:focus-within { border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 12%, transparent); }
.pr-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--pr-ink); font: inherit; font-size: 12.5px; }
.pr-search input::placeholder { color: var(--pr-ink-3); }
.pr-kbd { font-size: 10.5px; color: var(--pr-ink-3); border: 1px solid var(--pr-line); border-radius: 4px; padding: 0 4px; line-height: 14px; }

.pr-btn {
  height: 32px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--pr-line);
  border-radius: 9px;
  background: transparent;
  color: var(--pr-ink);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, border-color .15s, opacity .15s;
}
.pr-btn:hover {
  background: color-mix(in srgb, var(--pr-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--pr-accent) 38%, var(--pr-line));
}
.pr-btn:active { transform: translateY(.5px); }
.pr-btn[data-primary] { background: var(--pr-accent-solid, #4176e6); border-color: transparent; color: var(--pr-on-accent); box-shadow: 0 1px 2px rgba(15,23,42,.16); }
.pr-btn[data-primary]:hover { filter: brightness(1.06); }
.pr-btn[data-ghost] { border-color: transparent; background: transparent; color: var(--pr-ink-2); }
.pr-btn[data-ghost]:hover { background: color-mix(in srgb, var(--pr-accent) 9%, transparent); color: var(--pr-ink); }
.pr-btn[data-icon] { width: 32px; padding: 0; justify-content: center; }
.pr-btn[data-sm] { height: 28px; font-size: 12px; padding: 0 10px; border-radius: 8px; }

.pr-seg { display: inline-flex; padding: 2px; gap: 1px; border: 1px solid var(--pr-line); border-radius: 9px; background: transparent; }
.pr-seg button {
  height: 26px; min-width: 28px; width: auto; padding: 0 9px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 6px; background: transparent; color: var(--pr-ink-3);
  font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer;
}
.pr-seg button[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 14%, transparent);
  color: color-mix(in srgb, var(--pr-accent) 78%, var(--pr-ink));
  box-shadow: none;
}

/* ---------------------------------------------------------------- body */

.pr-body { flex: 1 1 auto; min-height: 0; display: flex; }
.pr-rail {
  width: 198px;
  flex: none;
  padding: 0 10px 24px 20px;
  overflow: auto;
}
.pr-rail-group { margin-bottom: 14px; }
.pr-rail-label { font-size: 11.5px; font-weight: 600; letter-spacing: .04em; color: var(--pr-ink-3); text-transform: uppercase; padding: 10px 10px 5px; }
.pr-rail-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 29px; padding: 0 8px;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 12.5px; cursor: pointer; text-align: left;
}
.pr-rail-item:hover { background: var(--dsw-alias-bg-layer-2, #f4f5f7); color: var(--pr-ink); }
.pr-rail-item[data-on] { background: color-mix(in srgb, var(--pr-accent) 11%, transparent); color: var(--pr-ink); font-weight: 550; }
.pr-rail-item .pr-count { margin-left: auto; font-size: 11.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-rail-item[data-on] .pr-count { color: var(--pr-accent); }
.pr-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.pr-dot[data-s="todo"] { background: var(--pr-ink-3); }
.pr-dot[data-s="reading"] { background: #e0a020; }
.pr-dot[data-s="done"] { background: #2fa36b; }

.pr-main { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 0 24px 40px; }
.pr-section-head { display: flex; align-items: center; gap: 10px; margin: 2px 0 12px; }
.pr-section-head h2 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--pr-ink-2); }
.pr-section-head .pr-line { flex: 1; height: 1px; background: var(--pr-line); }

/* ---------------------------------------------------------------- cards */

.pr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(292px, 1fr)); gap: 13px; }
/* 一张卡片同时服务最近阅读与文献库；四行：状态行 / 标题 / 作者 / 页脚。 */
.pr-card {
  position: relative;
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 13px 10px;
  border: 1px solid var(--pr-line);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  cursor: pointer;
  transition: border-color .16s, box-shadow .16s, transform .16s;
}
.pr-card:hover { border-color: var(--pr-line-strong); box-shadow: var(--pr-shadow); transform: translateY(-1px); }
.pr-card-top { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11.5px; color: var(--pr-ink-3); }
.pr-card-state { display: inline-flex; align-items: center; gap: 5px; flex: none; }
.pr-card-state-label { white-space: nowrap; }
.pr-card-meta {
  margin-left: auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pr-card-title { font-size: 14px; font-weight: 600; line-height: 1.36; letter-spacing: -.008em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pr-card-authors { font-size: 11.5px; color: var(--pr-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-width: 0; }
/* 页脚贴底：同一行的卡片即使标题行数不同，进度条也能对齐。 */
.pr-card-foot {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  margin-top: auto; padding-top: 3px;
  font-size: 11px; color: var(--pr-ink-3);
}
.pr-tags { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; min-width: 0; overflow: hidden; }
.pr-tag {
  flex: none;
  font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 99px;
  color: var(--pr-ink-2);
  background: var(--dsw-alias-bg-layer-2, #f4f5f7);
  border: 1px solid transparent;
  white-space: nowrap;
}
.pr-tag[data-accent] { color: var(--pr-accent); background: color-mix(in srgb, var(--pr-accent) 10%, transparent); }
.pr-card .pr-tag { font-size: 10.5px; line-height: 17px; padding: 0 6px; max-width: 98px; overflow: hidden; text-overflow: ellipsis; }
.pr-card-read {
  margin-left: auto; display: flex; align-items: center; gap: 6px; flex: none;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pr-bar { width: 54px; height: 4px; border-radius: 99px; background: color-mix(in srgb, var(--pr-ink) 13%, transparent); overflow: hidden; }
.pr-bar i { display: block; height: 100%; background: #e0a020; border-radius: 99px; }
.pr-card[data-status="done"] .pr-bar i { background: #2fa36b; }

.pr-new {
  flex: none; display: inline-flex; align-items: center; height: 16px; padding: 0 6px;
  border-radius: 99px; font-size: 10px; line-height: 1;
  background: color-mix(in srgb, #2fa36b 14%, transparent); color: #2fa36b;
}

/* list view */
.pr-list { display: flex; flex-direction: column; border: 1px solid var(--pr-line); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #fff); }
.pr-list-head,
.pr-row {
  display: grid;
  grid-template-columns: var(--pr-list-cols);
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  min-width: 0;
}
.pr-list-head {
  min-height: 32px;
  border-bottom: 1px solid var(--pr-line);
  background: color-mix(in srgb, var(--pr-ink) 3%, transparent);
  color: var(--pr-ink-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
}
.pr-list-head-cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-row { min-height: 42px; cursor: pointer; border-top: 1px solid var(--pr-line); }
.pr-list-head + .pr-row { border-top: 0; }
.pr-row:hover { background: var(--dsw-alias-bg-layer-2, #f8f9fb); }
.pr-list-cell {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--pr-ink-2);
}
.pr-list-cell[data-col="title"] { font-size: 13px; font-weight: 550; color: var(--pr-ink); }
.pr-list-cell[data-col="year"] { color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-list-cell[data-col="status"] { display: flex; align-items: center; }
.pr-list-cell[data-align="end"] { text-align: right; }
.pr-status-cell { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.pr-status-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-status-cell .pr-card-flag { flex: none; }
.pr-row-action { justify-self: center; opacity: 0; transition: opacity 120ms ease; }
.pr-row:hover .pr-row-action,
.pr-row:focus-within .pr-row-action { opacity: 1; }

/* ---------------------------------------------------------------- top bar */

/* Back · tabs · tools. One row that survives tab switches; the paper title
   lives in its tab, not in a second header. */
.pr-topbar {
  display: flex; align-items: center; gap: 8px;
  height: 46px; padding: 0 10px; flex: none;
  border-bottom: 1px solid var(--pr-line);
}
.pr-tb-back {
  width: 28px; height: 28px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink-2); cursor: pointer;
  transition: background .15s, color .15s;
}
.pr-tb-back:hover:not(:disabled) { background: color-mix(in srgb, var(--pr-ink) 8%, transparent); color: var(--pr-ink); }
.pr-tb-back:disabled { opacity: .35; cursor: default; }

.pr-tabs {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 3px;
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; padding: 6px 1px;
}
.pr-tabs::-webkit-scrollbar { display: none; }
.pr-tab {
  display: flex; align-items: center; gap: 6px;
  height: 30px; flex: none; min-width: 84px; max-width: 208px;
  padding: 0 5px 0 9px;
  border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--pr-ink-2);
  font: inherit; font-size: 12.5px; cursor: pointer;
  overflow: hidden;
  transition: background .14s, border-color .14s, color .14s;
}
.pr-tab:hover { background: color-mix(in srgb, var(--pr-ink) 6%, transparent); color: var(--pr-ink); }
.pr-tab[data-on] {
  background: var(--dsw-alias-bg-layer-1, #fff);
  border-color: var(--pr-line);
  color: var(--pr-ink);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .06);
}
.pr-tab-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-tab-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--pr-ink-3); }
.pr-tab-dot[data-s="reading"] { background: #e0a020; }
.pr-tab-dot[data-s="done"] { background: #2fa36b; }
.pr-tab-close {
  width: 16px; height: 16px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 5px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer; opacity: 0;
  transition: opacity .12s, background .12s, color .12s;
}
.pr-tab:hover .pr-tab-close,
.pr-tab[data-on] .pr-tab-close { opacity: 1; }
.pr-tab-close:hover { background: color-mix(in srgb, var(--pr-ink) 10%, transparent); color: var(--pr-ink); }
.pr-tab-add {
  width: 26px; height: 26px; flex: none; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer;
}
.pr-tab-add:hover { background: color-mix(in srgb, var(--pr-ink) 8%, transparent); color: var(--pr-ink); }

.pr-layout-seg { flex: none; }
.pr-layout-seg button { width: 30px; padding: 0; }

/* ------------------------------------------------------- resizable panes */

/* Every side pane shares one width transition. The app sets data-resizing on
   the root while a pointer drag is live, so the divider follows the cursor
   exactly; programmatic changes (collapse, mode switch, keyboard) animate. */
.pr-nav, .pr-folders, .pr-rail, .pr-panel {
  transition: width 200ms cubic-bezier(.2, .8, .2, 1), opacity 160ms ease, border-color 160ms ease;
}
.pr-rail-inner, .pr-panel-inner {
  transition: width 200ms cubic-bezier(.2, .8, .2, 1);
}
.pr-nav, .pr-rail, .pr-panel { position: relative; }

.pr-resizer {
  position: absolute; top: 0; bottom: 0; z-index: 30;
  width: 7px; padding: 0; border: 0; background: transparent;
  cursor: col-resize; touch-action: none; outline: 0; user-select: none;
}
.pr-resizer[data-edge="right"] { right: 0; }
.pr-resizer[data-edge="left"] { left: 0; }
/* The nav and folder rail have no overflow clipping, so their hit area can sit
   half in the gap instead of covering the last few pixels of their content. */
.pr-nav > .pr-resizer[data-edge="right"],
.pr-folders > .pr-resizer[data-edge="right"] { right: -4px; }
.pr-resizer:focus-visible {
  border-radius: 4px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pr-accent) 32%, transparent);
}
.pr-root[data-resizing] .pr-nav,
.pr-root[data-resizing] .pr-folders,
.pr-root[data-resizing] .pr-rail,
.pr-root[data-resizing] .pr-panel,
.pr-root[data-resizing] .pr-rail-inner,
.pr-root[data-resizing] .pr-panel-inner { transition: none !important; }
.pr-root[data-resizing] { cursor: col-resize; user-select: none; }

`
