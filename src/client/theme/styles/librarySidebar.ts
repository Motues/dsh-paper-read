/**
 * 文献库侧栏的对齐与标签。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const librarySidebar = String.raw`
/* ====================================================== 文献库侧栏：对齐与标签 */

/* One indent scale for the special rows, the folder tree, the create row and
   the tag list: 8px outer padding, a 16px glyph slot and a 16px step per level.
   Keeping these in one place stops the rail from looking hand-nudged. */
.pr-rail-section {
  height: 32px;
  margin-top: 8px;
  padding: 2px 4px 0 8px;
  border-top: 1px solid var(--pr-line);
}
.pr-rail-title {
  left: 0;
  max-width: none;
  font-size: 13.5px;
  line-height: 22px;
  letter-spacing: -.008em;
}
.pr-rail-special { gap: 1px; }
.pr-folder-row {
  height: 32px;
  gap: 10px;
  padding: 0 10px 0 8px;
  font-size: 13.5px;
}
.pr-tree { padding: 4px 0 10px; }
.pr-tree-row { padding-left: calc(8px + var(--pr-depth, 0) * 16px); }
.pr-tree-main {
  gap: 8px;
  padding: 0 8px 0 0;
  font-size: 13.5px;
}
.pr-tree-row[data-drop="before"]::before,
.pr-tree-row[data-drop="after"]::after {
  left: calc(8px + var(--pr-depth, 0) * 16px);
}
.pr-tree-create {
  gap: 8px;
  padding-left: calc(8px + var(--pr-depth, 0) * 16px);
}
.pr-tree-empty { padding: 6px 8px; }

.pr-rail-tags {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--pr-line);
}
.pr-rail-tags-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 4px 0 8px;
  min-width: 0;
}
.pr-rail-tags-title { flex: none; }
.pr-rail-tags-count {
  flex: none;
  font-size: 11px;
  color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums;
}
.pr-rail-tags-clear {
  margin-left: auto;
  flex: none;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--pr-accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.pr-rail-tags-clear:hover { background: color-mix(in srgb, var(--pr-accent) 11%, transparent); }
.pr-rail-tags-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 0 1 auto;
  min-height: 0;
  max-height: 174px;
  padding: 0 0 4px;
  overflow-y: auto;
}
.pr-tag-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 30px;
  padding: 0 10px 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--pr-ink-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pr-tag-row:hover {
  background: color-mix(in srgb, var(--pr-ink) 8%, transparent);
  color: var(--pr-ink);
}
.pr-tag-row[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 13%, transparent);
  color: var(--pr-ink);
  font-weight: 560;
}
.pr-tag-row svg { flex: none; color: var(--pr-ink-3); }
.pr-tag-row[data-on] svg { color: var(--pr-accent); }
.pr-tag-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pr-tag-row .pr-count {
  flex: none;
  font-size: 11.5px;
  color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums;
}
.pr-rail-tags-empty {
  padding: 4px 8px 8px;
  font-size: 11.5px;
  color: var(--pr-ink-3);
}

`
