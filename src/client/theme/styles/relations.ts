/**
 * 关联页、图谱、列表、检查器、共享样式与骨架。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const relations = String.raw`
/* ================================================================ relations */

.pr-relpage { display: flex; flex-direction: column; overflow: hidden; padding: 0 24px 16px 26px; }
.pr-relpage .pr-page-head { padding: 14px 0 10px; }

.pr-viewtoggle {
  display: inline-flex; padding: 2px; gap: 2px;
  border: 1px solid var(--pr-line); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2, #f4f5f7);
}
.pr-viewtoggle button {
  height: 26px; padding: 0 9px; display: inline-flex; align-items: center; gap: 5px;
  border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink-3); font: inherit; font-size: 11.5px; cursor: pointer;
  transition: color .15s, background .15s, box-shadow .15s;
}
.pr-viewtoggle button:hover { color: var(--pr-ink-2); }
.pr-viewtoggle button[data-on] {
  color: var(--pr-ink); background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 1px 3px rgba(15, 23, 42, .12);
}

.pr-rel-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 6px; }
.pr-rel-search { flex: 1 1 360px; max-width: none; height: 36px; border-radius: 10px; }
.pr-rel-search input { font-size: 12.5px; }
.pr-search-clear {
  flex: none; border: 0; background: transparent; color: var(--pr-ink-3);
  width: 20px; height: 20px; border-radius: 6px; cursor: pointer;
  font: inherit; font-size: 16px; line-height: 1; display: grid; place-items: center;
}
.pr-search-clear:hover { color: var(--pr-ink); background: color-mix(in srgb, var(--pr-ink) 8%, transparent); }

.pr-kindchips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pr-kindchip {
  display: inline-flex; align-items: center; gap: 5px; height: 27px; padding: 0 8px;
  border-radius: 8px; border: 1px solid var(--pr-line); background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 11.5px; cursor: pointer;
  transition: background .15s, border-color .15s, opacity .15s, color .15s;
}
.pr-kindchip i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.pr-kindchip b { color: var(--pr-ink-3); font-weight: 600; font-variant-numeric: tabular-nums; font-size: 10.5px; }
.pr-kindchip:hover { border-color: var(--pr-line-strong); color: var(--pr-ink); }
.pr-kindchip[data-on] {
  color: var(--pr-ink); border-color: color-mix(in srgb, var(--pr-ink) 24%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
}
.pr-kindchip[data-on] b { color: var(--pr-accent); }
.pr-kindchip[data-empty] { opacity: .42; }
.pr-kindchip[data-clear] { border-style: dashed; color: var(--pr-ink-3); }
.pr-rel-hint { flex-basis: 100%; min-height: 14px; font-size: 10.5px; line-height: 1.4; color: var(--pr-ink-3); }
.pr-rel-hint:empty { display: none; }

.pr-rel-clusters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-bottom: 10px; }
.pr-cluster-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 25px; padding: 0 9px;
  border-radius: 99px; border: 1px solid var(--pr-line); background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 11.5px; cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
}
.pr-cluster-chip i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pr-cluster-chip b { color: var(--pr-ink-3); font-weight: 600; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.pr-cluster-chip:hover { border-color: var(--pr-line-strong); color: var(--pr-ink); }
.pr-cluster-chip[data-on] {
  color: var(--pr-ink); border-color: color-mix(in srgb, var(--pr-accent) 48%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-accent) 10%, transparent);
}
.pr-cluster-chip[data-on] b { color: var(--pr-accent); }
.pr-cluster-chip[data-solo] { color: var(--pr-ink-3); }
.pr-cluster-chip[data-pending] { border-color: color-mix(in srgb, var(--pr-k-problem) 45%, var(--pr-line)); color: var(--pr-k-problem); }
.pr-cluster-chip[data-pending] b { color: var(--pr-k-problem); }
.pr-rel-count { font-size: 10.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }

.pr-rel-body { flex: 1 1 auto; min-height: 0; display: flex; gap: 14px; }
.pr-insp-wrap { width: 344px; flex: none; min-height: 0; display: flex; }

/* ---------------------------------------------------------------- graph */
.pr-graph-wrap {
  position: relative; flex: 1 1 auto; min-width: 0; min-height: 0;
  border: 1px solid var(--pr-line); border-radius: 14px;
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--pr-accent) 7%, transparent), transparent 62%),
    radial-gradient(80% 60% at 82% 100%, color-mix(in srgb, var(--pr-accent) 5%, transparent), transparent 70%),
    var(--dsw-alias-bg-layer-1, #fff);
  overflow: hidden; isolation: isolate;
}
.pr-graph-wrap::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(color-mix(in srgb, var(--pr-ink) 14%, transparent) 1px, transparent 1px);
  background-size: 18px 18px; opacity: .35;
}
.pr-root[data-scheme="dark"] .pr-graph-wrap::before { opacity: .22; }
.pr-graph-svg {
  position: relative; width: 100%; height: 100%; display: block;
  touch-action: none; cursor: grab; user-select: none;
}
.pr-graph-svg:active { cursor: grabbing; }

.pr-gedge { stroke-width: 1.1; opacity: .5; transition: opacity .15s, stroke-width .15s; }
.pr-gedge[data-status="suggested"] { stroke-dasharray: 4 4; opacity: .3; }
.pr-gedge[data-hidden] { display: none; }
.pr-gedge[data-dim] { opacity: .06; }
.pr-gedge[data-near] { opacity: .92; stroke-width: 1.7; }
.pr-gedge[data-path] {
  opacity: 1; stroke-width: 2.4; stroke-dasharray: 7 5;
  animation: pr-dash .9s linear infinite;
}
@keyframes pr-dash { to { stroke-dashoffset: -12; } }

.pr-gnode {
  cursor: pointer;
  /* backwards, not both: a retained final keyframe (opacity: 1) would
     override the [data-dim] rules below and silently break focus dimming. */
  animation: pr-node-in .55s ease backwards;
  transition: opacity .22s ease;
}
@keyframes pr-node-in { from { opacity: 0; } to { opacity: 1; } }
.pr-gnode-halo { opacity: .12; transition: opacity .2s; }
.pr-gnode-core {
  stroke: var(--pr-paper); stroke-width: 1.6;
  transition: stroke .15s, filter .15s;
}
.pr-gnode-label {
  font-size: 10.5px; fill: var(--pr-ink-2); pointer-events: none;
  paint-order: stroke; stroke: var(--pr-paper); stroke-width: 3px; stroke-linejoin: round;
}
.pr-gnode-dup { fill: none; stroke: var(--pr-k-problem); stroke-width: 1.2; stroke-dasharray: 3 3; opacity: .9; }
.pr-gnode-dashed { fill: none; stroke: var(--pr-ink-3); stroke-width: 1.2; stroke-dasharray: 3 3; }
.pr-gnode[data-isolated] .pr-gnode-halo { opacity: .06; }
.pr-gnode[data-hidden] { display: none; }
.pr-gnode[data-dim] { opacity: .14; }
.pr-gnode[data-near] .pr-gnode-halo { opacity: .22; }
.pr-gnode[data-near] .pr-gnode-label { fill: var(--pr-ink); }
.pr-gnode[data-hover] .pr-gnode-halo { opacity: .34; }
.pr-gnode[data-hover] .pr-gnode-core { stroke: var(--pr-ink); }
.pr-gnode[data-selected] .pr-gnode-halo { opacity: .34; animation: pr-halo-pulse 2.6s ease-in-out infinite; }
.pr-gnode[data-selected] .pr-gnode-core { stroke: var(--pr-accent); stroke-width: 2.4; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--pr-accent) 55%, transparent)); }
.pr-gnode[data-selected] .pr-gnode-label { fill: var(--pr-ink); font-weight: 600; }
.pr-gnode[data-path] .pr-gnode-core { stroke: var(--pr-accent); stroke-width: 2; }
@keyframes pr-halo-pulse { 0%, 100% { opacity: .24; } 50% { opacity: .46; } }

.pr-graph-hud {
  position: absolute; top: 10px; right: 10px; display: flex; gap: 4px;
  padding: 3px; border-radius: 9px; border: 1px solid var(--pr-line);
  background: color-mix(in srgb, var(--pr-paper) 88%, transparent);
  backdrop-filter: blur(6px); box-shadow: 0 6px 18px -12px rgba(15, 23, 42, .5);
}
.pr-hud-btn {
  width: 26px; height: 26px; display: grid; place-items: center;
  border: 0; border-radius: 7px; background: transparent; color: var(--pr-ink-2);
  cursor: pointer; font: inherit;
}
.pr-hud-btn:hover { background: color-mix(in srgb, var(--pr-ink) 8%, transparent); color: var(--pr-ink); }
.pr-hud-btn:disabled { opacity: .38; cursor: default; }
.pr-hud-btn:disabled:hover { background: transparent; color: var(--pr-ink-2); }
.pr-hud-btn[data-on] { background: color-mix(in srgb, var(--pr-accent) 12%, transparent); color: var(--pr-accent); }
.pr-hud-label { font-size: 10.5px; font-weight: 650; letter-spacing: .01em; }

.pr-graph-path {
  position: absolute; left: 12px; top: 12px; max-width: 62%;
  padding: 5px 9px; border-radius: 8px; border: 1px solid var(--pr-line);
  background: color-mix(in srgb, var(--pr-paper) 90%, transparent);
  backdrop-filter: blur(6px);
  font-size: 11px; color: var(--pr-ink-2); line-height: 1.45;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-graph-path b { color: var(--pr-accent); }

.pr-graph-legend {
  position: absolute; left: 12px; bottom: 10px; display: flex; gap: 9px; flex-wrap: wrap;
  padding: 5px 9px; border-radius: 8px; border: 1px solid var(--pr-line);
  background: color-mix(in srgb, var(--pr-paper) 86%, transparent);
  backdrop-filter: blur(6px); font-size: 10px; color: var(--pr-ink-3);
}
.pr-graph-legend span { display: inline-flex; align-items: center; gap: 4px; }
.pr-graph-legend i { width: 9px; height: 2px; border-radius: 1px; }

.pr-year-legend {
  position: absolute; right: 12px; bottom: 10px; display: flex; align-items: center; gap: 6px;
  padding: 5px 9px; border-radius: 8px; border: 1px solid var(--pr-line);
  background: color-mix(in srgb, var(--pr-paper) 86%, transparent);
  backdrop-filter: blur(6px); font-size: 10px; color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums;
}
.pr-year-legend i {
  width: 92px; height: 6px; border-radius: 3px;
  background: linear-gradient(90deg, var(--pr-y1), var(--pr-y2), var(--pr-y3), var(--pr-y4), var(--pr-y5));
}
.pr-graph-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  padding: 24px; text-align: center; pointer-events: none;
}
.pr-graph-empty b { font-size: 13px; font-weight: 650; }
.pr-graph-empty span { max-width: 320px; font-size: 11.5px; line-height: 1.65; color: var(--pr-ink-3); }

/* Focus ranking and prior/derivative lists: both are plain reading lists, so
   they stay quieter than the relation rows they sit above. */
.pr-rank-list { display: flex; flex-direction: column; gap: 2px; }
.pr-rank-row {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; gap: 8px; align-items: center;
  padding: 6px 7px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--pr-ink); font: inherit; text-align: left; cursor: pointer;
}
.pr-rank-row:hover { background: color-mix(in srgb, var(--pr-ink) 5%, transparent); }
.pr-rank-row > b { font-size: 10px; font-weight: 600; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-rank-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
.pr-rank-row > em { font-style: normal; font-size: 10px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-rank-score { font-size: 10px; font-weight: 650; color: var(--pr-accent); font-variant-numeric: tabular-nums; }

.pr-lineage { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pr-lineage-col { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pr-lineage-label { font-size: 9.5px; letter-spacing: .06em; color: var(--pr-ink-3); }
.pr-lineage-row {
  display: flex; gap: 6px; align-items: baseline; justify-content: space-between;
  padding: 5px 7px; border-radius: 7px; border: 1px solid var(--pr-line);
  background: transparent; color: var(--pr-ink); font: inherit; font-size: 11px;
  text-align: left; cursor: pointer;
}
.pr-lineage-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-lineage-row b { flex: none; font-size: 10px; font-weight: 600; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-lineage-row:hover { border-color: var(--pr-line-strong); background: color-mix(in srgb, var(--pr-ink) 4%, transparent); }
.pr-lineage-empty { font-style: normal; font-size: 10.5px; color: var(--pr-ink-3); padding: 4px 2px; }

.pr-graph-tip {
  position: absolute; left: 0; top: 0; width: 236px; z-index: 5;
  display: flex; flex-direction: column; gap: 4px;
  padding: 9px 10px; border-radius: 10px;
  border: 1px solid var(--pr-line-strong);
  background: var(--pr-popover-base); color: var(--pr-ink);
  box-shadow: 0 16px 38px -20px rgba(15, 23, 42, .6);
  pointer-events: none;
}
.pr-graph-tip b { font-size: 11.5px; font-weight: 600; line-height: 1.45; }
.pr-graph-tip-meta, .pr-graph-tip-tags { font-size: 10.5px; color: var(--pr-ink-3); line-height: 1.5; }
.pr-graph-tip-hint { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--pr-ink-3); }
.pr-graph-tip-hint svg { transform: rotate(-90deg); }

/* ---------------------------------------------------------------- list */
.pr-list-grid {
  flex: 1 1 auto; min-width: 0; min-height: 0; display: grid;
  grid-template-columns: minmax(230px, 318px) minmax(0, 1fr); gap: 14px;
}
.pr-list-papers, .pr-list-rels {
  min-height: 0; overflow: auto; padding: 10px;
  border: 1px solid var(--pr-line); border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 72%, transparent);
}
/* The relations list keeps its own header class: it used to share
   .pr-list-head with the literature table, and this later flex rule silently
   overrode that table's grid header. */
.pr-rel-head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 8px; }
.pr-rel-head h3 { margin: 0; font-size: 12px; font-weight: 650; color: var(--pr-ink-2); }
.pr-rel-head > span { font-size: 10.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-rel-head .pr-btn { margin-left: auto; }
.pr-list-focus { font-size: 11.5px; color: var(--pr-ink-3); padding: 0 4px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pr-paper-row {
  width: 100%; display: flex; align-items: flex-start; gap: 9px; padding: 8px 8px;
  border: 1px solid transparent; border-radius: 10px; background: transparent;
  color: var(--pr-ink); font: inherit; text-align: left; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.pr-paper-row:hover { background: color-mix(in srgb, var(--pr-ink) 5%, transparent); }
.pr-paper-row[data-on] {
  border-color: color-mix(in srgb, var(--pr-accent) 40%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-accent) 8%, transparent);
}
.pr-paper-row > i { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex: none; }
.pr-paper-row-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pr-paper-row-body b { font-size: 12px; font-weight: 550; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pr-paper-row-meta, .pr-paper-row-tags { font-size: 10.5px; color: var(--pr-ink-3); line-height: 1.4; }
.pr-paper-row-tags { color: var(--pr-accent); }

.pr-lgroup { margin-bottom: 12px; }
.pr-lgroup-head { display: flex; align-items: center; gap: 7px; padding: 2px 2px 6px; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-lrow {
  display: flex; align-items: stretch; gap: 6px; margin-bottom: 6px;
  border: 1px solid var(--pr-line); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #fff);
}
.pr-lrow[data-status="suggested"] { border-style: dashed; }
.pr-lrow-main {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px;
  padding: 9px 10px; border: 0; border-radius: 10px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.pr-lrow-main:hover { background: color-mix(in srgb, var(--pr-accent) 5%, transparent); }
.pr-lrow-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pr-lrow-title { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-lrow-pair { display: inline-flex; align-items: center; gap: 5px; }
.pr-lrow-pair > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-lrow-pair em { color: var(--pr-accent); font-style: normal; flex: none; }
.pr-lrow-head em { font-style: normal; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-lrow-reason { font-size: 11.5px; color: var(--pr-ink-2); line-height: 1.55; }
.pr-lrow-foot { display: flex; align-items: center; gap: 6px; }
.pr-lrow-actions { display: flex; align-items: center; gap: 2px; padding-right: 6px; }

/* ---------------------------------------------------------- inspector */
.pr-insp {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: 2px 4px 28px 16px; border-left: 1px solid var(--pr-line);
  display: flex; flex-direction: column; gap: 14px;
}
.pr-insp-head { display: flex; align-items: baseline; gap: 7px; padding: 2px 2px 0; }
.pr-insp-head h2 { margin: 0; font-size: 13.5px; font-weight: 650; }
.pr-insp-head h3 { margin: 0; font-size: 12px; font-weight: 650; color: var(--pr-ink-2); }
.pr-insp-count { font-size: 10.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-insp-sub { margin-left: auto; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-insp-section { display: flex; flex-direction: column; gap: 7px; }
.pr-insp-hint { margin: 0; font-size: 11px; color: var(--pr-ink-3); line-height: 1.55; }
.pr-insp-subhead { padding-top: 6px; font-size: 10.5px; color: var(--pr-k-problem); }

.pr-insp-focus { display: flex; align-items: center; gap: 8px; }
.pr-insp-back {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 7px;
  border: 1px solid var(--pr-line); border-radius: 7px; background: transparent;
  color: var(--pr-ink-3); font: inherit; font-size: 10.5px; cursor: pointer;
}
.pr-insp-back:hover { color: var(--pr-ink); border-color: var(--pr-line-strong); }
.pr-cluster-pill {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px;
  border-radius: 99px; border: 1px solid var(--pr-line); background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 10.5px; cursor: pointer; margin-left: auto;
}
.pr-cluster-pill i { width: 7px; height: 7px; border-radius: 50%; }
.pr-insp-title { margin: 0; font-size: 15.5px; font-weight: 650; line-height: 1.42; letter-spacing: -.01em; }
.pr-insp-meta { margin-top: -8px; font-size: 11px; color: var(--pr-ink-3); }
.pr-insp-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.pr-insp-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pr-insp-banner {
  display: flex; align-items: flex-start; gap: 7px; padding: 9px 10px;
  border-radius: 9px; border: 1px dashed color-mix(in srgb, var(--pr-k-problem) 45%, var(--pr-line));
  color: var(--pr-ink-2); background: color-mix(in srgb, var(--pr-k-problem) 6%, transparent);
  font-size: 11px; line-height: 1.55;
}
.pr-insp-banner svg { color: var(--pr-k-problem); flex: none; margin-top: 2px; }

.pr-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.pr-stat {
  display: flex; flex-direction: column; gap: 1px; padding: 7px 6px;
  border: 1px solid var(--pr-line); border-radius: 9px; background: transparent;
  color: inherit; font: inherit; text-align: left;
}
.pr-stat[type="button"] { cursor: pointer; }
.pr-stat:hover { border-color: var(--pr-line-strong); }
.pr-stat b { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; }
.pr-stat span { font-size: 9.5px; color: var(--pr-ink-3); }

.pr-cluster-list { display: flex; flex-direction: column; gap: 2px; }
.pr-cluster-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 7px;
  border: 0; border-radius: 8px; background: transparent; color: var(--pr-ink);
  font: inherit; font-size: 11.5px; text-align: left; cursor: pointer;
}
.pr-cluster-row:hover { background: color-mix(in srgb, var(--pr-ink) 5%, transparent); }
.pr-cluster-row i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pr-cluster-row b { flex: 1 1 auto; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-cluster-row span { font-size: 10px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }

.pr-pair {
  display: flex; flex-direction: column; gap: 4px; padding: 9px 10px;
  border: 1px solid var(--pr-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.pr-pair:hover { transform: translateY(-1px); border-color: var(--pr-line-strong); box-shadow: 0 8px 20px -16px rgba(15, 23, 42, .5); }
.pr-pair-head { display: flex; align-items: center; gap: 6px; }
.pr-pair-head .pr-conf { margin-left: auto; }
.pr-pair-titles { font-size: 11.5px; font-weight: 550; line-height: 1.5; color: var(--pr-ink); }
.pr-pair-titles em { font-style: normal; color: var(--pr-accent); margin: 0 2px; }
.pr-pair-reason { font-size: 11px; color: var(--pr-ink-2); line-height: 1.55; }

.pr-rel-row2 {
  display: flex; flex-direction: column; gap: 5px; padding: 9px 10px;
  border: 1px solid var(--pr-line); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #fff);
}
.pr-rel-row2[data-status="suggested"] { border-style: dashed; background: transparent; }
.pr-rel-row2-head { display: flex; align-items: center; gap: 6px; }
.pr-rel-row2-head .pr-conf { margin-left: auto; }
.pr-rel-dir { font-size: 10px; color: var(--pr-ink-3); white-space: nowrap; }
.pr-rel-row2-title {
  border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer;
  color: var(--pr-ink); font: inherit; font-size: 12px; font-weight: 550; line-height: 1.5;
}
.pr-rel-row2-title:hover { color: var(--pr-accent); }
.pr-rel-row2-title em { font-style: normal; font-size: 10.5px; color: var(--pr-ink-3); margin-left: 5px; font-weight: 400; }
.pr-rel-reason { margin: 0; font-size: 11px; color: var(--pr-ink-2); line-height: 1.55; }
.pr-rel-row2-foot { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pr-rel-row2-foot .pr-spacer { flex: 1 1 auto; }

.pr-insight {
  display: flex; flex-direction: column; gap: 7px; padding: 11px 12px;
  border-radius: 11px; border: 1px solid color-mix(in srgb, var(--pr-accent) 26%, var(--pr-line));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--pr-accent) 7%, transparent), transparent 62%),
    var(--dsw-alias-bg-layer-1, #fff);
}
.pr-insight-head { display: flex; align-items: center; gap: 6px; color: var(--pr-accent); }
.pr-insight-head b { font-size: 11.5px; color: var(--pr-ink); font-weight: 650; }
.pr-insight-head .pr-btn { height: 24px; font-size: 10.5px; }
.pr-insight-text { margin: 0; font-size: 12px; line-height: 1.7; color: var(--pr-ink-2); }
.pr-insight-bullets { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }
.pr-insight-bullets li { font-size: 11px; line-height: 1.55; color: var(--pr-ink-2); }
.pr-insight-bullets li::marker { color: var(--pr-accent); }
.pr-insight-foot { font-size: 9.5px; color: var(--pr-ink-3); }
.pr-insight-skeleton { display: flex; flex-direction: column; gap: 6px; }
.pr-insight-skeleton i {
  display: block; height: 9px; border-radius: 5px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--pr-ink) 7%, transparent), color-mix(in srgb, var(--pr-ink) 14%, transparent), color-mix(in srgb, var(--pr-ink) 7%, transparent));
  background-size: 200% 100%; animation: pr-shimmer 1.4s linear infinite;
}
.pr-insight-skeleton i:nth-child(2) { width: 88%; }
.pr-insight-skeleton i:nth-child(3) { width: 64%; }
@keyframes pr-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.pr-hit-list { display: flex; flex-direction: column; gap: 6px; }
.pr-hit {
  display: flex; flex-direction: column; gap: 4px; padding: 8px 9px;
  border: 1px solid var(--pr-line); border-radius: 9px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.pr-hit:hover { border-color: var(--pr-line-strong); background: color-mix(in srgb, var(--pr-accent) 5%, transparent); }
.pr-hit-head { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--pr-ink-2); min-width: 0; }
.pr-hit-head b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-hit-head em { margin-left: auto; font-style: normal; font-size: 10px; color: var(--pr-ink-3); white-space: nowrap; }
.pr-hit-quote { font-size: 11px; line-height: 1.55; color: var(--pr-ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pr-hit-reason { font-size: 10px; color: var(--pr-ink-3); }

/* ---------------------------------------------------------------- shared */
.pr-kbadge {
  display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 7px;
  border-radius: 6px; border: 1px solid color-mix(in srgb, var(--pr-kind) 38%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-kind) 9%, transparent);
  color: var(--pr-ink-2); font-size: 10.5px; white-space: nowrap;
}
.pr-kbadge i { width: 6px; height: 6px; border-radius: 50%; background: var(--pr-kind); }
.pr-kbadge em { font-style: normal; font-size: 9px; color: var(--pr-k-problem); }
.pr-kbadge[data-status="suggested"] { border-style: dashed; color: var(--pr-ink-3); }
.pr-kbadge[data-compact] { height: 18px; font-size: 10px; padding: 0 6px; }

.pr-signals { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.pr-signal {
  font-size: 9.5px; color: var(--pr-ink-3); padding: 1px 6px; border-radius: 99px;
  background: color-mix(in srgb, var(--pr-ink) 6%, transparent); white-space: nowrap;
}

.pr-conf { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.pr-conf-track { width: 44px; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--pr-ink) 12%, transparent); overflow: hidden; }
.pr-conf-track i { display: block; height: 100%; border-radius: 2px; background: var(--pr-accent); }
.pr-conf[data-low] .pr-conf-track i { background: var(--pr-k-problem); }
.pr-conf b { font-size: 9.5px; font-weight: 600; color: var(--pr-ink-3); }

.pr-rempty {
  display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
  padding: 14px; border: 1px dashed var(--pr-line-strong); border-radius: 11px;
  color: var(--pr-ink-2); background: transparent;
}
.pr-rempty-icon { color: var(--pr-ink-3); }
.pr-rempty b { font-size: 12px; font-weight: 600; }
.pr-rempty p { margin: 0; font-size: 11px; line-height: 1.6; color: var(--pr-ink-3); }
.pr-rempty-action { margin-top: 2px; }

.pr-tag[data-warn] {
  color: var(--pr-k-problem);
  border-color: color-mix(in srgb, var(--pr-k-problem) 40%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-k-problem) 8%, transparent);
}

/* ---------------------------------------------------------- skeleton */
.pr-rel-skeleton { flex: 1 1 auto; display: flex; gap: 14px; min-width: 0; }
.pr-rel-skeleton-nav, .pr-rel-skeleton-canvas {
  border: 1px solid var(--pr-line); border-radius: 14px; padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 60%, transparent);
}
.pr-rel-skeleton-nav { width: 240px; }
.pr-rel-skeleton-canvas { flex: 1 1 auto; justify-content: center; align-items: center; }
.pr-rel-skeleton i {
  display: block; height: 11px; border-radius: 6px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--pr-ink) 6%, transparent), color-mix(in srgb, var(--pr-ink) 13%, transparent), color-mix(in srgb, var(--pr-ink) 6%, transparent));
  background-size: 200% 100%; animation: pr-shimmer 1.4s linear infinite;
}
.pr-rel-skeleton-nav i:nth-child(1) { width: 88%; height: 26px; }
.pr-rel-skeleton-nav i:nth-child(2) { width: 72%; }
.pr-rel-skeleton-nav i:nth-child(3) { width: 80%; }
.pr-rel-skeleton-nav i:nth-child(4) { width: 64%; }
.pr-rel-skeleton-canvas i { width: 42%; height: 42%; border-radius: 50%; opacity: .7; }

@media (max-width: 1180px) {
  .pr-insp-wrap { width: 300px; }
  .pr-list-grid { grid-template-columns: minmax(210px, 270px) minmax(0, 1fr); }
}
@media (max-width: 980px) {
  .pr-relpage { overflow: auto; }
  .pr-rel-body { flex-direction: column; }
  .pr-graph-wrap { min-height: 420px; }
  .pr-insp-wrap { width: auto; min-height: 0; }
  .pr-insp { border-left: 0; padding-left: 2px; max-height: none; }
  .pr-list-grid { grid-template-columns: 1fr; }
  .pr-list-papers { max-height: 280px; }
}
@media (prefers-reduced-motion: reduce) {
  .pr-gnode, .pr-gedge, .pr-insight-skeleton i, .pr-rel-skeleton i { animation: none !important; }
  .pr-gnode[data-selected] .pr-gnode-halo { animation: none !important; opacity: .3; }
  .pr-gedge[data-path] { animation: none !important; }
  .pr-nav, .pr-folders, .pr-rail, .pr-panel, .pr-rail-inner, .pr-panel-inner { transition: none !important; }
  .pr-thumb[data-preview="1"]::before { animation: none; }
  .pr-pdf-loading, .pr-anno-ring { animation: none !important; }
}

`
