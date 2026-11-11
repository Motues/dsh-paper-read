/**
 * 用量页：汇总、区间、矩阵与分解。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const usage = String.raw`
/* ============================================================== 用量 */

.pr-usage { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.pr-usage-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
}
.pr-usage-total { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pr-usage-total-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--pr-ink);
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.pr-usage-total-value span {
  color: var(--pr-ink-3);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
}
.pr-usage-total-sub { color: var(--pr-ink-3); font-size: 11.5px; }
.pr-usage-ranges {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  padding: 2px;
  border: 1px solid var(--pr-line);
  border-radius: 9px;
  background: color-mix(in srgb, var(--pr-ink) 3%, transparent);
}
.pr-usage-range {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--pr-ink-3);
  font: inherit;
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
}
.pr-usage-range:hover {
  color: var(--pr-ink);
  background: color-mix(in srgb, var(--pr-ink) 6%, transparent);
}
.pr-usage-range[data-on] {
  color: var(--pr-ink);
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .08);
  font-weight: 550;
}
.pr-usage-custom {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--pr-ink-3);
  font-size: 11.5px;
}
.pr-usage-custom label { display: inline-flex; align-items: center; gap: 6px; }
.pr-usage-custom input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--pr-line);
  border-radius: 7px;
  background: transparent;
  color: var(--pr-ink-2);
  font: inherit;
  font-size: 11.5px;
  outline: 0;
}
.pr-usage-custom input:focus {
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-usage-stats {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-top: 1px solid var(--pr-line);
  border-bottom: 1px solid var(--pr-line);
}
.pr-usage-stats > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 12px 12px 12px 0;
}
.pr-usage-stats > div + div {
  padding-left: 12px;
  border-left: 1px solid var(--pr-line);
}
.pr-usage-stats span { color: var(--pr-ink-3); font-size: 10.5px; }
.pr-usage-stats b {
  color: var(--pr-ink);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pr-usage-caption { font-size: 10.5px; color: var(--pr-ink-3); line-height: 1.5; padding: 8px 0 2px; }
.pr-usage-chart { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pr-usage-scroll { min-width: 0; overflow-x: auto; padding-bottom: 2px; }
.pr-usage-months {
  display: flex;
  gap: 2px;
  width: max-content;
  min-width: 100%;
  height: 16px;
  overflow: visible;
  color: var(--pr-ink-3);
  font-size: 10px;
}
.pr-usage-months span { flex: none; overflow: hidden; white-space: nowrap; }
.pr-usage-body { display: flex; gap: 6px; min-width: max-content; padding-bottom: 0; }
.pr-usage-weekdays {
  flex: none;
  display: grid;
  grid-template-rows: repeat(7, 10px);
  gap: 2px;
  width: 20px;
  color: var(--pr-ink-3);
  font-size: 9.5px;
  line-height: 10px;
  text-align: right;
}
.pr-usage-weekdays span { height: 10px; }
.pr-usage-weeks { display: flex; gap: 2px; }
.pr-usage-week { display: grid; grid-template-rows: repeat(7, 10px); gap: 2px; }
.pr-usage-cell {
  width: 10px;
  height: 10px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
  cursor: default;
}
.pr-usage-cell[data-level="1"] { background: color-mix(in srgb, var(--pr-accent) 20%, transparent); }
.pr-usage-cell[data-level="2"] { background: color-mix(in srgb, var(--pr-accent) 40%, transparent); }
.pr-usage-cell[data-level="3"] { background: color-mix(in srgb, var(--pr-accent) 65%, transparent); }
.pr-usage-cell[data-level="4"] { background: var(--pr-accent-solid); }
.pr-usage-cell[data-outside] { background: transparent; }
.pr-usage-cell:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--pr-accent) 55%, transparent);
  outline-offset: 1px;
}
.pr-usage-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  color: var(--pr-ink-3);
  font-size: 10px;
}
.pr-usage-legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
}
.pr-usage-legend i[data-level="1"] { background: color-mix(in srgb, var(--pr-accent) 20%, transparent); }
.pr-usage-legend i[data-level="2"] { background: color-mix(in srgb, var(--pr-accent) 40%, transparent); }
.pr-usage-legend i[data-level="3"] { background: color-mix(in srgb, var(--pr-accent) 65%, transparent); }
.pr-usage-legend i[data-level="4"] { background: var(--pr-accent-solid); }
.pr-usage-legend-label { margin: 0 4px; }
.pr-usage-detail {
  min-height: 16px;
  color: var(--pr-ink-3);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.pr-usage-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 22px 0 8px;
  border-top: 1px solid var(--pr-line);
  color: var(--pr-ink-3);
  font-size: 11.5px;
}
.pr-usage-empty b { color: var(--pr-ink-2); font-size: 12.5px; font-weight: 600; }
.pr-usage-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--pr-line);
}
.pr-usage-subhead {
  color: var(--pr-ink-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
}
.pr-usage-models { display: flex; flex-direction: column; gap: 5px; }
.pr-usage-model {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(60px, 2fr) auto;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
}
.pr-usage-model-name {
  overflow: hidden;
  color: var(--pr-ink-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pr-usage-model-bar {
  height: 5px;
  overflow: hidden;
  border-radius: 99px;
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
}
.pr-usage-model-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pr-accent-solid);
}
.pr-usage-model-total {
  color: var(--pr-ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.pr-usage-sources { display: flex; flex-wrap: wrap; gap: 5px; }
.pr-usage-source {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--pr-line);
  border-radius: 999px;
  color: var(--pr-ink-3);
  font-size: 10.5px;
}
.pr-usage-source b {
  color: var(--pr-ink-2);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 760px) {
  .pr-usage-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pr-usage-stats > div:nth-child(4) { padding-left: 0; border-left: 0; }
  .pr-usage-stats > div:nth-child(n + 4) { border-top: 1px solid var(--pr-line); }
}

@media (max-width: 640px) {
  .pr-usage-head { align-items: flex-start; }
  .pr-usage-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pr-usage-stats > div:nth-child(odd) { padding-left: 0; border-left: 0; }
  .pr-usage-stats > div:nth-child(even) { padding-left: 12px; border-left: 1px solid var(--pr-line); }
  .pr-usage-stats > div:nth-child(n + 3) { border-top: 1px solid var(--pr-line); }
  .pr-usage-model { grid-template-columns: minmax(0, 1fr) auto; }
  .pr-usage-model-bar { display: none; }
}


.pr-settings-folder-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}
.pr-settings-folder {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--pr-ink-2);
  font-size: 12px;
  transition: background 120ms ease;
}
.pr-settings-folder:hover { background: color-mix(in srgb, var(--pr-ink) 5%, transparent); }
.pr-settings-folder > svg { flex: none; color: var(--pr-ink-3); }
.pr-settings-folder-path {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pr-settings-folder-remove {
  flex: none;
  margin-left: auto;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--pr-ink-3);
  cursor: pointer;
  opacity: 1;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}
@media (hover: hover) {
  .pr-settings-folder-remove { opacity: 0; }
  .pr-settings-folder:hover .pr-settings-folder-remove,
  .pr-settings-folder-remove:focus-visible { opacity: 1; }
}
.pr-settings-folder-remove:hover {
  background: color-mix(in srgb, #d9534f 10%, transparent);
  color: #d9534f;
}
.pr-settings-folder-remove:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--pr-accent) 45%, transparent);
  outline-offset: 1px;
}

.pr-settings-folder-add {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.pr-settings-folder-add input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--pr-line);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--pr-ink);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.pr-settings-folder-add input::placeholder { color: var(--pr-ink-3); }

.pr-settings-number {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--pr-ink-3);
  font-size: 11.5px;
}
.pr-settings-number input {
  width: 76px;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--pr-line);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--pr-ink);
  font: inherit;
  font-size: 12px;
  text-align: center;
  outline: none;
  appearance: textfield;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.pr-settings-number input::-webkit-outer-spin-button,
.pr-settings-number input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.pr-settings-select {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.pr-settings-folder-add input:focus,
.pr-settings-number input:focus {
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 12%, transparent);
}

.pr-settings-path {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10.8px;
  color: var(--pr-ink-2);
  overflow-wrap: anywhere;
}

.pr-settings-missing { margin-top: 2px; }
.pr-settings-missing-list { display: flex; flex-direction: column; gap: 1px; }
.pr-settings-missing-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--pr-ink-2);
  font-size: 12px;
}
.pr-settings-missing-row:hover { background: color-mix(in srgb, var(--pr-ink) 4%, transparent); }
.pr-settings-missing-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pr-settings-missing-year {
  flex: none;
  color: var(--pr-ink-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.pr-settings-missing-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.pr-settings-missing-actions .pr-settings-hint {
  flex: 1 1 auto;
  min-width: 200px;
}

.pr-settings-notice[data-tone="error"],
.pr-settings-save[data-state="error"] { color: #c04542; }
.pr-root[data-scheme="dark"] .pr-settings-notice[data-tone="error"],
.pr-root[data-scheme="dark"] .pr-settings-save[data-state="error"] { color: #ff9b9b; }

@media (max-width: 1080px) {
  .pr-settings-top { padding: 16px 22px 14px; }
  .pr-settings-notice { padding: 9px 22px; }
  .pr-settings-layout { flex-direction: column; }
  .pr-settings-nav {
    width: 100%;
    flex-direction: row;
    gap: 2px;
    padding: 10px 16px;
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid var(--pr-line);
    scrollbar-width: none;
  }
  .pr-settings-nav::-webkit-scrollbar { display: none; }
  .pr-settings-nav-group { flex-direction: row; gap: 2px; }
  .pr-settings-nav-group + .pr-settings-nav-group { margin-top: 0; }
  .pr-settings-nav-title { display: none; }
  .pr-settings-nav-item {
    width: auto;
    flex: none;
    height: 32px;
    padding: 0 10px;
  }
  .pr-settings-scroll { padding: 22px 22px 64px; }
  .pr-settings-main { max-width: none; }
}

@media (max-width: 640px) {
  .pr-settings-top { flex-wrap: wrap; gap: 8px; }
  .pr-settings-save { min-height: 0; padding-top: 0; }
  .pr-setting-line { flex-direction: column; align-items: stretch; gap: 10px; }
  .pr-setting-control { justify-content: flex-start; }
  .pr-setting-control[data-wide] { width: 100%; }
  .pr-settings-folder-add { flex-wrap: wrap; }
  .pr-settings-folder-add input { flex-basis: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .pr-settings-nav-item,
  .pr-settings-folder,
  .pr-settings-folder-remove,
  .pr-settings-page .pr-switch,
  .pr-settings-page .pr-switch i { transition: none; }
  .pr-settings-save-dot { animation: none; }
}
`
