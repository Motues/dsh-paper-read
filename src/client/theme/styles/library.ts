/**
 * 文献库、卡片、文件夹树、回收站与整理对话框。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const library = String.raw`
/* 文献库：文件夹树 + 内容 */
.pr-lib { display: flex; gap: 20px; align-items: flex-start; padding-top: 12px; }
.pr-folders {
  width: 202px; flex: none;
  display: flex; flex-direction: column; gap: 6px;
  position: sticky; top: 0;
  max-height: calc(100vh - 10px);
  min-height: 0;
  padding-bottom: 8px;
}
.pr-lib-head { display: flex; flex-direction: column; gap: 2px; flex: none; padding: 0 2px 2px 8px; min-width: 0; }
.pr-lib-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.pr-lib-head h1 { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -.012em; line-height: 1.3; }
.pr-lib-head .pr-page-sub { font-size: 11.5px; color: var(--pr-ink-3); }
.pr-rail-special { display: flex; flex-direction: column; gap: 1px; flex: none; }
/* 「文件夹」分区标题固定在树上方：三个操作按钮跟着标题走，不随树滚动消失。搜索展开时标题与右侧按钮一起收窄，输入框在同一行铺开，DSH 用 180ms 过渡。 */
.pr-rail-section {
  display: flex; align-items: center; gap: 4px;
  flex: none; min-width: 0;
  height: 32px; margin-top: 4px; padding: 0 4px 0 10px;
  overflow: hidden;
  transition: gap 180ms var(--ds-ease-in-out, ease), padding 180ms var(--ds-ease-in-out, ease);
}
.pr-rail-section[data-search-open] { gap: 0; }
.pr-rail-title {
  position: relative; left: -1px;
  flex: none; max-width: 45%; min-width: 0;
  margin: 0; overflow: hidden; white-space: nowrap;
  font-size: 14px; font-weight: 650; letter-spacing: -.01em; line-height: 20px;
  color: var(--pr-ink);
  opacity: 1; visibility: visible;
  transition: max-width 180ms var(--ds-ease-in-out, ease), margin-right 180ms var(--ds-ease-in-out, ease), opacity 120ms var(--ds-ease-in-out, ease), transform 180ms var(--ds-ease-in-out, ease), visibility 0s linear;
}
.pr-rail-title[data-hidden] {
  max-width: 0; margin-right: -4px; opacity: 0; transform: translateX(-4px);
  visibility: hidden; transition-delay: 0s, 0s, 0s, 0s, 180ms;
}
.pr-rail-search {
  flex: 1 1 auto; max-width: 28px; min-width: 0;
  display: flex; align-items: center; gap: 0;
  height: 28px; margin-left: auto; padding: 0;
  border: 0 solid transparent; border-radius: 7px;
  background: transparent; color: var(--pr-ink-3);
  cursor: pointer; overflow: hidden;
  transition: max-width 180ms var(--ds-ease-in-out, ease), padding 180ms var(--ds-ease-in-out, ease), border-width 180ms var(--ds-ease-in-out, ease), border-color 180ms var(--ds-ease-in-out, ease), background-color 180ms var(--ds-ease-in-out, ease);
}
.pr-rail-search[data-open] {
  max-width: 100%;
  padding: 0 3px 0 1px;
  border-width: 1px;
  border-color: var(--pr-line-strong);
  background: var(--dsw-alias-bg-layer-1, #fff);
  cursor: text;
}
.pr-rail-search button {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 5px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer;
}
.pr-rail-search .pr-rail-search-toggle {
  width: 28px; height: 100%; border-radius: 6px;
  color: var(--pr-ink-3);
}
.pr-rail-search[data-open] .pr-rail-search-toggle { color: var(--pr-ink-2); }
.pr-rail-search button:hover { background: color-mix(in srgb, var(--pr-ink) 9%, transparent); color: var(--pr-ink); }
.pr-rail-search-input {
  flex: 1 1 auto; width: 0; min-width: 0;
  border: 0; outline: 0; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12px;
  opacity: 0; pointer-events: none;
  transition: opacity 120ms var(--ds-ease-in-out, ease);
}
.pr-rail-search[data-open] .pr-rail-search-input {
  opacity: 1; pointer-events: auto; margin-left: 2px;
}
.pr-rail-search-clear {
  max-width: 0; opacity: 0; visibility: hidden; pointer-events: none;
  transition: max-width 120ms var(--ds-ease-in-out, ease), opacity 120ms var(--ds-ease-in-out, ease), visibility 0s linear 120ms;
}
.pr-rail-search-clear[data-show] {
  max-width: 22px; opacity: 1; visibility: visible; pointer-events: auto;
  transition-delay: 0s;
}
.pr-rail-actions {
  flex: none; display: flex; align-items: center; gap: 1px;
  max-width: 52px; opacity: 1; overflow: hidden; visibility: visible;
  transition: max-width 180ms var(--ds-ease-in-out, ease), opacity 120ms var(--ds-ease-in-out, ease), transform 180ms var(--ds-ease-in-out, ease), visibility 0s linear;
}
.pr-rail-actions[data-hidden] {
  max-width: 0; opacity: 0; transform: translateX(4px);
  visibility: hidden; pointer-events: none;
  transition-delay: 0s, 0s, 0s, 180ms;
}
.pr-rail-actions .pr-icon-btn { width: 24px; height: 24px; border-radius: 6px; }

/* 文件夹树：滚动区独立，菜单固定在视口里（菜单不会被裁掉） */
.pr-tree {
  display: flex; flex-direction: column; gap: 1px;
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  /* Room for the drag insert marker above the first / below the last row. */
  padding: 8px 0 10px;
}
.pr-folder-row {
  display: flex; align-items: center; gap: 9px;
  height: 32px; padding: 0 10px;
  border: 0; border-radius: 8px;
  background: transparent; color: var(--pr-ink-2);
  font: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pr-folder-row:hover { background: color-mix(in srgb, var(--pr-ink) 9%, transparent); color: var(--pr-ink); }
.pr-folder-row[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 13%, transparent);
  color: var(--pr-ink); font-weight: 560;
}
.pr-folder-row[data-trash] svg { color: inherit; }
.pr-folder-row .pr-count { margin-left: auto; font-size: 11.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }

.pr-tree-branch { display: flex; flex-direction: column; }
/* A branch's children animate their intrinsic height (0fr -> 1fr). The inner
   wrapper clips; visibility keeps a closed subtree out of the tab order and AT
   until the collapse finishes. */
.pr-tree-children {
  display: grid;
  grid-template-rows: 0fr;
  min-height: 0;
  visibility: hidden;
  transition:
    grid-template-rows 180ms var(--ds-ease-in-out, ease),
    visibility 0s linear 180ms;
}
.pr-tree-children[data-open] {
  grid-template-rows: 1fr;
  visibility: visible;
  transition:
    grid-template-rows 180ms var(--ds-ease-in-out, ease),
    visibility 0s;
}
.pr-tree-children-inner {
  min-height: 0;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .pr-tree-children { transition: none; }
}
.pr-tree-row {
  position: relative; display: flex; align-items: center;
  height: 32px; border-radius: 8px;
  padding-left: calc(2px + var(--pr-depth, 0) * 18px);
  color: var(--pr-ink-2);
  transition: background 120ms ease, color 120ms ease;
}
.pr-tree-row:hover { background: color-mix(in srgb, var(--pr-ink) 8%, transparent); color: var(--pr-ink); }
.pr-tree-row[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 13%, transparent);
  color: var(--pr-ink); font-weight: 560;
}
/* Drag source fades back; the hovered row shows where the drop lands. */
.pr-tree-row[data-dragging] { opacity: .45; }
.pr-tree-row[data-dragging] .pr-tree-main { cursor: grabbing; }
.pr-tree-row[data-drop="inside"] {
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pr-accent) 55%, transparent);
  color: var(--pr-ink);
}
.pr-tree-row[data-drop="inside"] .pr-tree-glyph { color: var(--pr-accent); }
/* Same insert marker as DSH's session rows: a chevron plus a 2px rule. */
.pr-tree-row[data-drop="before"]::before,
.pr-tree-row[data-drop="after"]::after {
  content: ''; position: absolute; z-index: 2; pointer-events: none;
  left: calc(2px + var(--pr-depth, 0) * 18px); right: 4px; height: 12px;
  background:
    linear-gradient(
      55deg,
      transparent calc(50% - 1px),
      var(--pr-accent) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    ) 0 0 / 5px 7px no-repeat,
    linear-gradient(
      125deg,
      transparent calc(50% - 1px),
      var(--pr-accent) calc(50% - 1px) calc(50% + 1px),
      transparent calc(50% + 1px)
    ) 0 5px / 5px 7px no-repeat,
    linear-gradient(var(--pr-accent) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;
}
.pr-tree-row[data-drop="before"]::before { top: -7px; }
.pr-tree-row[data-drop="after"]::after { bottom: -7px; }
.pr-tree-main {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  height: 100%; padding: 0 8px 0 2px;
  border: 0; background: transparent; color: inherit;
  font: inherit; font-size: 14px; text-align: left; cursor: pointer;
}
/* Leading slot: the folder glyph, swapped for the expand arrow while hovered. */
.pr-tree-glyph {
  flex: none; width: 16px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
}
.pr-tree-folder { flex: none; }
.pr-tree-arrow { display: none; flex: none; transition: transform 180ms var(--ds-ease-in-out, ease); }
.pr-tree-row[data-open] .pr-tree-arrow { transform: rotate(90deg); }
@media (hover: hover) {
  .pr-tree-row[data-branch]:hover .pr-tree-folder { display: none; }
  .pr-tree-row[data-branch]:hover .pr-tree-arrow { display: inline-flex; }
}
.pr-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-tree-main .pr-count { flex: none; font-size: 11.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
/* Row actions stay out of the way until the pointer is on the row (or the
   row's menu is open), never merely because the row is selected. Keyboard
   focus still reveals them, so they remain reachable. */
.pr-tree-actions {
  position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
  display: flex; align-items: center; gap: 1px;
  opacity: 0; visibility: hidden; pointer-events: none;
}
.pr-tree-row[data-menu] .pr-tree-actions,
.pr-tree-row:has(:focus-visible) .pr-tree-actions {
  opacity: 1; visibility: visible; pointer-events: auto;
}
.pr-tree-row[data-menu] .pr-tree-main,
.pr-tree-row:has(:focus-visible) .pr-tree-main { padding-right: 52px; }
.pr-tree-row[data-menu] .pr-tree-main .pr-count,
.pr-tree-row:has(:focus-visible) .pr-tree-main .pr-count { visibility: hidden; }
@media (hover: hover) {
  .pr-tree-row:hover .pr-tree-actions { opacity: 1; visibility: visible; pointer-events: auto; }
  .pr-tree-row:hover .pr-tree-main { padding-right: 52px; }
  .pr-tree-row:hover .pr-tree-main .pr-count { visibility: hidden; }
}
/* The drag source never reveals actions, even while the pointer is on it. */
.pr-tree-row[data-dragging] .pr-tree-actions { opacity: 0; visibility: hidden; pointer-events: none; }
.pr-tree-row[data-dragging] .pr-tree-main { padding-right: 8px; }
.pr-tree-row[data-dragging] .pr-tree-main .pr-count { visibility: visible; }
.pr-tree-actions .pr-icon-btn { width: 23px; height: 23px; border-radius: 6px; }
.pr-tree-actions .pr-icon-btn:hover { background: color-mix(in srgb, var(--pr-ink) 12%, transparent); color: var(--pr-ink); }
.pr-tree-input {
  flex: 1 1 auto; min-width: 0; height: 26px; margin-right: 8px; padding: 0 8px;
  border: 1px solid var(--pr-accent); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 13px; outline: none;
}
.pr-tree-create {
  display: flex; align-items: center; gap: 8px;
  height: 32px; margin: 1px 0;
  /* Leading slot matches the folder rows: icon at the level's indent, input
     where the folder name sits. */
  padding-left: calc(4px + var(--pr-depth, 0) * 18px); padding-right: 4px;
  color: var(--pr-ink-3);
}
.pr-tree-create input {
  flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 8px;
  border: 1px solid var(--pr-accent); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 12.5px; outline: none;
}
.pr-tree-empty { padding: 6px 10px; font-size: 11.5px; color: var(--pr-ink-3); }

/* 文件夹「更多」菜单 */
.pr-menu {
  z-index: 60; width: 182px; padding: 4px 4px 6px;
  border: 1px solid var(--pr-line-strong); border-radius: 10px;
  background: var(--pr-popover-base, #fff);
  box-shadow: 0 18px 42px -22px rgba(15, 23, 42, .48);
}
.pr-menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 30px; padding: 0 8px;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.pr-menu-item:hover { background: color-mix(in srgb, var(--pr-ink) 8%, transparent); }
.pr-menu-item[data-danger] { color: #d9534f; }
.pr-menu-item[data-danger]:hover,
.pr-menu-item[data-confirm] { background: color-mix(in srgb, #d9534f 12%, transparent); color: #d9534f; }
.pr-menu-sep { height: 1px; margin: 4px 6px; background: var(--pr-line); }
.pr-menu-note { padding: 4px 8px 2px; font-size: 10.5px; line-height: 1.5; color: var(--pr-ink-3); }

.pr-icon-btn {
  width: 20px; height: 20px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 5px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer;
}
.pr-icon-btn:hover { background: color-mix(in srgb, var(--pr-ink) 9%, transparent); color: var(--pr-ink); }
.pr-icon-btn[data-danger] { color: #d9534f; }
.pr-icon-btn[data-danger]:hover,
.pr-icon-btn[data-danger][data-confirm] { background: color-mix(in srgb, #d9534f 13%, transparent); color: #d9534f; }

.pr-lib-main { flex: 1 1 auto; min-width: 0; }
.pr-lib-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  min-height: 56px; padding: 0 0 14px;
}
.pr-lib-count { font-size: 11.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-dlg-target {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 6px; padding: 2px 8px;
  border-radius: 99px; font-size: 11px;
  color: color-mix(in srgb, var(--pr-accent) 72%, var(--pr-ink));
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-dlg-target b { font-weight: 600; }
.pr-chips-inline { margin-bottom: 12px; }
.pr-subfolders { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0 0 12px; }
.pr-subfolders-label {
  display: inline-flex; align-items: center; gap: 5px;
  margin-right: 2px; font-size: 11px; color: var(--pr-ink-3);
}
.pr-folder-chip { display: inline-flex; align-items: center; gap: 5px; }
.pr-folder-chip b { font-weight: 500; opacity: .7; }

/* 回收站 */
.pr-trash { padding-top: 2px; }
.pr-trash-head { display: flex; align-items: center; gap: 12px; padding: 4px 0 12px; }
.pr-trash-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pr-trash-title h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.pr-trash-list { display: flex; flex-direction: column; gap: 6px; }
.pr-trash-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pr-line); border-radius: 10px;
  transition: background 130ms ease, border-color 130ms ease;
}
.pr-trash-row:hover { background: color-mix(in srgb, var(--pr-ink) 4%, transparent); border-color: var(--pr-line-strong); }
.pr-trash-icon {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 8px;
  background: color-mix(in srgb, var(--pr-ink) 6%, transparent); color: var(--pr-ink-3);
}
.pr-trash-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pr-trash-main b {
  font-size: 13px; font-weight: 560; color: var(--pr-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-trash-meta {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  font-size: 11px; color: var(--pr-ink-3);
}
.pr-trash-meta i { font-style: normal; opacity: .6; }
.pr-trash-meta em { font-style: normal; color: var(--pr-ink-2); }
.pr-trash-actions { flex: none; display: flex; align-items: center; gap: 6px; }
.pr-trash-actions .pr-btn[data-danger] { color: #d9534f; }
.pr-trash-actions .pr-btn[data-danger]:hover,
.pr-trash-actions .pr-btn[data-confirm] {
  border-color: color-mix(in srgb, #d9534f 42%, transparent);
  background: color-mix(in srgb, #d9534f 12%, transparent);
  color: #d9534f;
}

/* 卡片补充 */
.pr-card-more { margin-left: 2px; opacity: 0; transition: opacity 120ms ease; }
.pr-card:hover .pr-card-more,
.pr-card:focus-within .pr-card-more { opacity: 1; }
.pr-card-flag {
  display: inline-flex; align-items: center; height: 16px; padding: 0 5px;
  border-radius: 99px; white-space: nowrap; font-size: 10px; line-height: 1;
  color: var(--pr-ink-3); background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
}
.pr-card-flag[data-auth="1"] {
  color: color-mix(in srgb, var(--pr-accent) 72%, var(--pr-ink));
  background: color-mix(in srgb, var(--pr-accent) 13%, transparent);
}
.pr-tag[data-group] {
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
  color: color-mix(in srgb, var(--pr-accent) 75%, var(--pr-ink));
}
.pr-tag[data-removable] {
  display: inline-flex; align-items: center; gap: 3px;
  border: 1px solid var(--pr-line-strong); cursor: pointer;
}
.pr-tag[data-removable]:hover { border-color: #d9534f; color: #d9534f; }
.pr-dot[data-s="missing"] { background: #d9534f; }

/* 空态 */
.pr-empty-lg { gap: 10px; padding: 64px 20px; }
.pr-empty-lg b { font-size: 14px; font-weight: 600; color: var(--pr-ink); }
.pr-empty-lg span { max-width: 400px; text-align: center; line-height: 1.7; font-size: 12px; }
.pr-empty-actions { display: flex; gap: 8px; margin-top: 6px; }

/* 整理对话框 */
.pr-dialog[data-narrow] { width: min(440px, calc(100vw - 40px)); overflow: visible; }
.pr-pick-list { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow-y: auto; }
.pr-pick {
  display: flex; align-items: center; gap: 8px;
  height: 30px; padding: 0 9px;
  border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--pr-ink);
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.pr-pick:hover { background: var(--dsw-alias-bg-layer-2, #f6f7f9); }
.pr-pick[data-on] { border-color: var(--pr-line-strong); background: var(--dsw-alias-bg-layer-2, #f6f7f9); }
.pr-tag-edit { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.pr-tag-edit input {
  flex: 1 1 130px; min-width: 110px; height: 24px; padding: 0 7px;
  border: 1px dashed var(--pr-line-strong); border-radius: 6px;
  background: transparent; color: var(--pr-ink); font: inherit; font-size: 11.5px; outline: none;
}
.pr-tag-edit input:focus { border-style: solid; border-color: var(--pr-accent); }
.pr-dlg-foot[data-inline] {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  margin-top: 14px; padding: 12px 0 16px; border-top: 1px solid var(--pr-line);
}
/* The recycle-bin reminder shares the action row instead of owning a line of
   its own; it wraps inside the free space and keeps the buttons right-aligned. */
.pr-dlg-foot-note {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; line-height: 1.4; color: var(--pr-ink-3);
  overflow-wrap: anywhere;
}
.pr-dlg-foot-note svg { flex: none; }
.pr-btn[data-danger] { color: #d9534f; border-color: color-mix(in srgb, #d9534f 38%, var(--pr-line)); }
.pr-btn[data-danger]:hover { background: color-mix(in srgb, #d9534f 10%, transparent); }
.pr-btn[data-danger][data-solid] {
  background: #d9534f; border-color: transparent; color: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .16);
}
.pr-btn[data-danger][data-solid]:hover { background: #d9534f; filter: brightness(1.06); }

/* 文献库筛选行 */
.pr-lib-filter-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: -4px 0 14px;
}
.pr-lib-filter-label { font-size: 11px; color: var(--pr-ink-3); }
.pr-lib-filter { flex: 0 1 160px; min-width: 0; }
.pr-lib-filter[data-narrow] { flex-basis: 108px; }
.pr-lib-filter[data-wide] { flex-basis: 190px; }
.pr-lib-filter .pr-select-trigger { width: 100%; }
.pr-lib-search-state {
  font-size: 11px; color: var(--pr-ink-3); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

`
