/**
 * AI 面板、输入栏、对话管理、模型菜单与信息页签。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const chat = String.raw`
/* ---------------------------------------------------------------- AI panel */

.pr-panel {
  width: 366px; flex: none; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
  border-left: 1px solid var(--pr-line);
  background: transparent;
  opacity: 1;
}
/* Kept mounted while closed so drafts and expanded blocks survive; the outer
   box clips the fixed-width inner column during the 200ms slide. */
.pr-panel:not([data-open]) {
  opacity: 0; visibility: hidden; pointer-events: none;
  border-left-color: transparent;
  transition: width 200ms cubic-bezier(.2, .8, .2, 1), opacity 140ms ease, border-color 140ms ease, visibility 0s linear 200ms;
}
.pr-panel-inner {
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
}
/* The rail's view switch sits in the reader toolbar, next to its collapse
   toggle; the two icon buttons stay compact so the page number keeps its room. */
.pr-rail-mode button { width: 26px; min-width: 26px; padding: 0; }
.pr-panel-tabs { display: flex; gap: 2px; padding: 0 10px; flex: none; border-bottom: 1px solid var(--pr-line); }
.pr-panel-tab { height: 30px; padding: 0 9px; border: 0; background: transparent; color: var(--pr-ink-3); font: inherit; font-size: 12px; cursor: pointer; position: relative; display: inline-flex; align-items: center; gap: 5px; }
.pr-panel-tab[data-on] { color: var(--pr-ink); font-weight: 550; }
.pr-panel-tab[data-on]::after { content: ""; position: absolute; left: 6px; right: 6px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--pr-accent); }
.pr-context {
  margin: 9px 12px 0; padding: 7px 9px; border-radius: 8px; flex: none;
  background: color-mix(in srgb, var(--pr-accent) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--pr-accent) 16%, transparent);
  font-size: 11.5px; color: var(--pr-ink-2); line-height: 1.5;
  display: flex; gap: 6px; align-items: flex-start;
}
.pr-context .pr-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* The gutter stays reserved so the transcript does not reflow 8px sideways when
   the first answer arrives and the bar appears. */
.pr-thread { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 12px 4px; display: flex; flex-direction: column; gap: 12px; scrollbar-gutter: stable; }
.pr-msg { display: flex; flex-direction: column; gap: 5px; max-width: 100%; }
.pr-msg-role { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-msg-body { font-size: 12.5px; line-height: 1.68; white-space: pre-wrap; }
.pr-msg[data-role="user"] .pr-msg-body { background: var(--dsw-alias-bg-layer-2, #f4f5f7); padding: 8px 10px; border-radius: 9px; }
.pr-msg[data-role="summary"] .pr-msg-role { color: var(--pr-ink-3); }
.pr-msg[data-role="summary"] .pr-msg-body {
  font-size: 11.5px; color: var(--pr-ink-2); line-height: 1.6;
  padding: 8px 10px; border-radius: 9px; border: 1px dashed var(--pr-line-strong);
  background: color-mix(in srgb, var(--pr-accent) 5%, transparent);
}

/* Injected context: DSH's disclosure row — icon that becomes a chevron on hover,
   "title · summary", body inset below while expanded. */
.pr-inj { padding: 1px 0; }
.pr-inj-head {
  width: 100%; height: 24px; padding: 0 4px 0 0; border: 0; border-radius: 5px;
  display: flex; align-items: center; background: transparent;
  color: var(--pr-ink-3); font: inherit; font-size: 11.5px; text-align: left;
  cursor: pointer; transition: color .1s, background .1s;
}
.pr-inj-head:hover { color: var(--pr-ink-2); background: color-mix(in srgb, var(--pr-ink) 5%, transparent); }
.pr-inj-head:focus-visible { outline: 2px solid color-mix(in srgb, var(--pr-accent) 45%, transparent); outline-offset: 1px; }
.pr-inj-lead { width: 16px; height: 16px; margin-right: 6px; flex: none; display: inline-grid; place-items: center; }
.pr-inj-icon, .pr-inj-chev { grid-area: 1 / 1; display: inline-flex; align-items: center; justify-content: center; }
.pr-inj-chev { opacity: 0; transition: opacity .1s; }
.pr-inj[data-open] .pr-inj-icon,
.pr-inj-head:hover .pr-inj-icon,
.pr-inj-head:focus-visible .pr-inj-icon { opacity: 0; }
.pr-inj[data-open] .pr-inj-chev,
.pr-inj-head:hover .pr-inj-chev,
.pr-inj-head:focus-visible .pr-inj-chev { opacity: 1; }
.pr-inj-title { flex: none; }
.pr-inj-sep { flex: none; width: 2px; height: 2px; margin: 0 8px; border-radius: 1px; background: currentColor; opacity: .65; }
.pr-inj-sum { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-inj-body {
  margin: 2px 0 6px 6px; padding: 8px 10px; max-height: 280px; overflow: auto;
  border-left: 2px solid var(--pr-line-strong); border-radius: 0 6px 6px 0;
  background: color-mix(in srgb, var(--pr-ink) 3%, transparent);
  font-size: 11.5px; line-height: 1.62; color: var(--pr-ink-2);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.pr-empty { color: var(--pr-ink-3); font-size: 12px; display: flex; flex-direction: column; gap: 10px; padding: 10px 2px; }
.pr-suggest { display: flex; flex-direction: column; gap: 6px; }
.pr-suggest button { text-align: left; border: 1px solid var(--pr-line); background: transparent; color: var(--pr-ink-2); border-radius: 8px; padding: 7px 9px; font: inherit; font-size: 12px; cursor: pointer; }
.pr-suggest button:hover { border-color: var(--pr-line-strong); color: var(--pr-ink); background: var(--dsw-alias-bg-layer-2, #f8f9fb); }
.pr-composer { flex: none; padding: 8px 10px 10px; border-top: 1px solid var(--pr-line); }
.pr-input-wrap { border: 1px solid var(--pr-line-strong); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #fff); padding: 6px 8px 5px; transition: border-color .15s, box-shadow .15s; }
.pr-input-wrap:focus-within { border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 11%, transparent); }
.pr-composer-quote {
  margin: 0 0 6px; padding: 6px 7px 6px 8px;
  border-left: 2px solid color-mix(in srgb, var(--pr-accent) 62%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--pr-accent) 7%, transparent);
}
.pr-composer-quote-head { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-quote-x {
  margin-left: auto; width: 18px; height: 18px; flex: none; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 5px; background: transparent; color: var(--pr-ink-3); cursor: pointer;
}
.pr-quote-x:hover { background: color-mix(in srgb, var(--pr-ink) 7%, transparent); color: var(--pr-ink); }
.pr-composer-quote-text {
  margin-top: 3px; font-size: 11.5px; line-height: 1.5; color: var(--pr-ink-2);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere;
}
.pr-input-wrap textarea { width: 100%; border: 0; outline: 0; resize: none; background: transparent; color: var(--pr-ink); font: inherit; font-size: 12.5px; line-height: 1.55; max-height: 96px; }
.pr-composer-bar { display: flex; align-items: center; gap: 2px; margin-top: 2px; padding: 1px 0 0; }
/* Paper-plane send: a filled circle, sized to the bar. */
.pr-send {
  width: 28px; height: 28px; flex: none; padding: 0; border: 0; border-radius: 50%;
  background: var(--pr-accent-solid, #4176e6); color: var(--pr-on-accent);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: filter .15s, opacity .15s;
}
.pr-send svg { transform: translate(-1px, 1px); }
.pr-send:hover:not(:disabled) { filter: brightness(1.08); }
.pr-send:disabled { opacity: .38; cursor: default; }

/* Context occupancy: 14px ring + percentage, DSH's ContextMeter shape. */
.pr-meter { flex: none; display: inline-flex; position: relative; }
.pr-meter-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px;
  border: 0; border-radius: 6px; background: transparent; cursor: pointer;
  color: var(--pr-ink-3); font: inherit; font-size: 10.5px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pr-meter-btn:hover, .pr-meter-btn[aria-expanded="true"] { background: color-mix(in srgb, var(--pr-ink) 6%, transparent); color: var(--pr-ink-2); }
.pr-meter-track { fill: none; stroke: color-mix(in srgb, var(--pr-ink) 20%, transparent); stroke-width: 2; }
.pr-meter-fill { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.pr-meter-panel {
  position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 40;
  width: 244px; padding: 11px 12px 10px; border-radius: 12px;
  background-color: var(--pr-popover-base);
  background-image: linear-gradient(var(--dsw-alias-bg-overlay, transparent), var(--dsw-alias-bg-overlay, transparent));
  color: var(--pr-ink-2);
  border: 1px solid var(--pr-line); box-shadow: 0 10px 30px rgba(15, 23, 42, .16);
  font-size: 11.5px; line-height: 18px;
}
.pr-meter-head { display: flex; align-items: center; gap: 6px; }
.pr-meter-label { color: var(--pr-ink-3); }
.pr-meter-pct { color: var(--pr-ink); font-weight: 600; }
.pr-meter-figs { margin-left: auto; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-meter-bar { margin: 7px 0 6px; height: 4px; border-radius: 99px; background: color-mix(in srgb, var(--pr-ink) 10%, transparent); overflow: hidden; }
.pr-meter-bar span { display: block; height: 100%; border-radius: 99px; background: var(--pr-accent); transition: width .25s; }
.pr-meter-note { color: var(--pr-ink-3); font-size: 10.5px; line-height: 1.5; }
.pr-meter-actions { display: flex; gap: 6px; margin-top: 9px; }
.pr-meter-compact {
  flex: 1 1 0; min-width: 0; height: 26px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border: 1px solid var(--pr-line-strong); background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 11.5px; cursor: pointer;
  white-space: nowrap;
}
.pr-meter-compact:hover:not(:disabled) { border-color: var(--pr-accent); color: var(--pr-accent); }
.pr-meter-compact:disabled { opacity: .45; cursor: default; }

/* Conversation bar: active title on the left, history/new on the right. */
.pr-chat-head {
  flex: none; display: flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--pr-line);
}
.pr-chat-title {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11.5px; font-weight: 600; color: var(--pr-ink);
}
.pr-chat-icon {
  width: 24px; height: 24px; flex: none; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--pr-ink-3); cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.pr-chat-icon:hover:not(:disabled) {
  background: color-mix(in srgb, var(--pr-ink) 8%, transparent);
  color: var(--pr-ink);
}
.pr-chat-icon[data-on] {
  color: var(--pr-accent);
  background: color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-chat-icon:disabled { opacity: .35; cursor: default; }

/* Conversation manager: replaces the transcript inside the AI tab. */
.pr-history {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: 8px 10px 14px; display: flex; flex-direction: column;
}
.pr-history-list { display: flex; flex-direction: column; gap: 1px; }
.pr-history-note {
  margin-top: auto; padding: 12px 2px 0;
  font-size: 10.5px; line-height: 1.5; color: var(--pr-ink-3);
}
.pr-conv-item { display: flex; align-items: center; gap: 1px; border-radius: 8px; }
.pr-conv-item:hover { background: color-mix(in srgb, var(--pr-ink) 5%, transparent); }
.pr-conv-item[data-on] { background: color-mix(in srgb, var(--pr-accent) 10%, transparent); }
.pr-conv-main {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: column; gap: 1px;
  padding: 6px 7px; border: 0; border-radius: 8px;
  background: transparent; color: var(--pr-ink); font: inherit; text-align: left; cursor: pointer;
}
.pr-conv-main:disabled { cursor: default; }
.pr-conv-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-conv-meta { font-size: 10.5px; color: var(--pr-ink-3); }
.pr-conv-actions { flex: none; display: flex; gap: 1px; padding-right: 3px; opacity: 0; transition: opacity .12s; }
.pr-history .pr-conv-actions { opacity: 1; }
.pr-conv-item:hover .pr-conv-actions,
.pr-conv-item:focus-within .pr-conv-actions,
.pr-conv-item[data-on] .pr-conv-actions { opacity: 1; }
.pr-conv-mini {
  width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--pr-ink-3); cursor: pointer;
}
.pr-conv-mini:hover:not(:disabled) { background: color-mix(in srgb, var(--pr-ink) 8%, transparent); color: var(--pr-ink); }
.pr-conv-mini:disabled { opacity: .3; cursor: default; }
.pr-conv-rename { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 1px; padding: 3px 4px; }
.pr-conv-rename input {
  flex: 1 1 auto; min-width: 0; height: 24px; padding: 0 6px;
  border: 1px solid var(--pr-accent); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 11.5px; outline: none;
}
.pr-conv-sub {
  margin-top: 5px; padding: 7px 6px 3px;
  border-top: 1px solid var(--pr-line);
  font-size: 10.5px; color: var(--pr-ink-3);
}

/* Model switch, after DSH's own selector: a trigger that names the live route,
   a root pane of two cells (模型 / 思考强度), and one drilled pane per cell. */
.pr-model { flex: none; display: inline-flex; position: relative; min-width: 0; }
.pr-model-btn {
  display: inline-flex; align-items: center; gap: 4px; max-width: 190px;
  height: 22px; padding: 0 6px; border: 0; border-radius: 6px;
  background: transparent; color: var(--pr-ink-3); font: inherit; font-size: 10.5px; cursor: pointer;
}
.pr-model-btn:hover, .pr-model-btn[aria-expanded="true"] { background: color-mix(in srgb, var(--pr-ink) 6%, transparent); color: var(--pr-ink-2); }
.pr-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-model-effort { flex: none; color: var(--pr-ink-3); opacity: .8; }
.pr-model-chev { flex: none; transition: transform .12s; }
.pr-model-chev-open { transform: rotate(180deg); }
.pr-model-menu {
  position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 40;
  width: 236px; max-height: 340px; overflow: hidden auto;
  padding: 4px; border-radius: 12px;
  background-color: var(--pr-popover-base);
  background-image: linear-gradient(var(--dsw-alias-bg-overlay, transparent), var(--dsw-alias-bg-overlay, transparent));
  border: 1px solid var(--pr-line);
  box-shadow: 0 10px 30px rgba(15, 23, 42, .16);
}
/* A root cell: label on the left, current value right-aligned, chevron at the edge. */
.pr-cell {
  width: 100%; height: 30px; padding: 0 6px 0 8px; display: flex; align-items: center; gap: 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.pr-cell:hover { background: color-mix(in srgb, var(--pr-ink) 6%, transparent); }
.pr-cell-label { flex: none; white-space: nowrap; }
.pr-cell-value {
  flex: 1 1 auto; min-width: 0; text-align: right;
  color: var(--pr-ink-3); font-size: 11.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-cell-chevron { flex: none; color: var(--pr-ink-3); }
.pr-cell-back { height: 28px; color: var(--pr-ink-3); font-size: 11px; }
.pr-cell-back:hover { color: var(--pr-ink-2); }
.pr-cell-chevron-back { transform: rotate(180deg); }
.pr-menu-groups { max-height: 300px; overflow: hidden auto; }
/* Provider heading: the small label DSH puts above each provider's models. */
.pr-menu-group + .pr-menu-group { margin-top: 2px; }
.pr-menu-group-label {
  padding: 7px 8px 3px; font-size: 10px; font-weight: 600; letter-spacing: .04em;
  color: var(--pr-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pr-option {
  width: 100%; min-height: 30px; padding: 4px 8px; display: flex; align-items: center; gap: 6px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--pr-ink); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.pr-option:hover { background: color-mix(in srgb, var(--pr-ink) 6%, transparent); }
.pr-option-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-option-check { flex: 0 0 14px; display: grid; place-items: center; color: var(--pr-accent); }
.pr-model-empty { padding: 10px 8px; font-size: 11.5px; color: var(--pr-ink-3); }

.pr-notes { flex: 1 1 auto; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
/* 关联页：独立页签，每篇相关论文一张卡。 */
.pr-rels { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 12px 16px; display: flex; flex-direction: column; gap: 2px; }
.pr-rels-summary { font-size: 11px; color: var(--pr-ink-3); padding: 0 4px 8px; font-variant-numeric: tabular-nums; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pr-rels-summary .pr-btn { height: 24px; font-size: 11px; }
.pr-rel-mini-head { display: flex; align-items: center; gap: 6px; }
.pr-rel-mini-dir { font-size: 10.5px; color: var(--pr-ink-3); white-space: nowrap; }
.pr-rel-mini-year { margin-left: auto; font-size: 10.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-note { border: 1px solid var(--pr-line); border-radius: 9px; padding: 8px 9px; background: var(--dsw-alias-bg-base, #fff); }
.pr-note-q { font-size: 11.5px; color: var(--pr-ink-2); line-height: 1.5; display: flex; gap: 6px; }
.pr-note-meta { margin-top: 6px; display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--pr-ink-3); }

/* 文献信息页签 */
.pr-info { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 11px 12px 18px; display: flex; flex-direction: column; gap: 16px; }
.pr-info-block { display: flex; flex-direction: column; gap: 5px; }
.pr-info-label { font-size: 11px; font-weight: 600; letter-spacing: .03em; color: var(--pr-ink-3); }
.pr-info-label span { font-weight: 400; color: var(--pr-ink-3); }
.pr-info-abstract { margin: 0; font-family: inherit; font-size: 12px; line-height: 1.68; color: var(--pr-ink-2); text-align: justify; }
.pr-info-rows { display: flex; flex-direction: column; }
.pr-info-row { display: flex; gap: 9px; padding: 5px 0; border-top: 1px solid var(--pr-line); font-size: 11.5px; line-height: 1.55; }
.pr-info-row:first-child { border-top: 0; padding-top: 0; }
.pr-info-key { width: 66px; flex: none; color: var(--pr-ink-3); }
.pr-info-value { flex: 1 1 auto; min-width: 0; color: var(--pr-ink-2); overflow-wrap: anywhere; }
.pr-info-value a, .pr-ref-link { color: var(--pr-accent); text-decoration: none; }
.pr-info-value a:hover, .pr-ref-link:hover { text-decoration: underline; }
.pr-info-note { font-size: 10.5px; color: var(--pr-ink-3); }
.pr-info-empty { font-size: 11.5px; color: var(--pr-ink-3); }
.pr-refs { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; }
.pr-ref { padding: 8px 0; border-top: 1px solid var(--pr-line); }
.pr-ref:first-child { border-top: 0; }
.pr-ref-title {
  font-size: 11.5px; line-height: 1.55; color: var(--pr-ink);
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}
.pr-ref-meta { margin-top: 2px; font-size: 10.5px; line-height: 1.5; color: var(--pr-ink-3); }
.pr-ref-link { display: inline-block; margin-top: 2px; font-size: 10.5px; overflow-wrap: anywhere; }

/* ---------------------------------------------------------------- 导读页 */

.pr-guide {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: 12px; display: flex; flex-direction: column; gap: 12px;
}
.pr-guide-head { display: flex; align-items: flex-start; gap: 8px; }
.pr-guide-heading { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pr-guide-heading b { font-size: 13px; }
.pr-guide-heading span { font-size: 10.5px; color: var(--pr-ink-3); }
.pr-guide-actions { flex: none; display: flex; gap: 6px; }
.pr-guide-body { display: flex; flex-direction: column; gap: 14px; }
.pr-guide-tldr {
  display: flex; gap: 7px; padding: 9px 10px; border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--pr-accent) 18%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-accent) 7%, transparent);
  font-size: 12px; line-height: 1.65; color: var(--pr-ink);
}
.pr-guide-tldr svg { flex: none; margin-top: 2px; color: var(--pr-accent); }
.pr-guide-section { display: flex; flex-direction: column; gap: 5px; }
.pr-guide-label { font-size: 10.5px; font-weight: 600; letter-spacing: .03em; color: var(--pr-ink-3); }
.pr-guide-list {
  margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px;
  font-size: 12px; line-height: 1.62; color: var(--pr-ink-2);
}
.pr-guide-list .pr-para, .pr-guide-tldr .pr-para { margin: 0; }
.pr-guide-empty { font-size: 11.5px; color: var(--pr-ink-3); }
.pr-guide-related { display: flex; flex-direction: column; gap: 4px; }
.pr-guide-related-row {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border: 1px solid var(--pr-line); border-radius: 8px; background: transparent;
  color: var(--pr-ink-2); font: inherit; font-size: 11.5px; text-align: left; cursor: pointer;
}
.pr-guide-related-row:hover {
  background: color-mix(in srgb, var(--pr-ink) 4%, transparent);
  border-color: var(--pr-line-strong);
}
.pr-guide-related-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-guide-foot {
  display: flex; flex-wrap: wrap; gap: 8px; padding-top: 8px;
  border-top: 1px solid var(--pr-line); font-size: 10.5px; color: var(--pr-ink-3);
}
.pr-guide-empty-state {
  flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 24px 14px; text-align: center;
  color: var(--pr-ink-3); font-size: 11.5px; line-height: 1.6;
}
.pr-guide-empty-state b { font-size: 13px; color: var(--pr-ink); }
.pr-guide-empty-state svg { color: var(--pr-accent); }
.pr-guide-form { display: flex; flex-direction: column; gap: 10px; }
.pr-guide-field, .pr-info-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--pr-ink-2); }
.pr-guide-field > span, .pr-info-field > span { font-size: 10.5px; color: var(--pr-ink-3); }
.pr-guide-field textarea,
.pr-info-field input,
.pr-info-field textarea {
  width: 100%; box-sizing: border-box; padding: 7px 9px;
  border: 1px solid var(--pr-line-strong); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 12px; line-height: 1.55; outline: none; resize: vertical;
}
.pr-guide-field textarea:focus,
.pr-info-field input:focus,
.pr-info-field textarea:focus { border-color: var(--pr-accent); }
.pr-guide-form-actions, .pr-info-form-actions { display: flex; gap: 8px; padding-top: 2px; }
.pr-guide-confirm {
  display: flex; flex-direction: column; gap: 7px; padding: 9px 10px;
  border-radius: 9px; border: 1px solid color-mix(in srgb, #d9534f 22%, var(--pr-line));
  background: color-mix(in srgb, #d9534f 6%, transparent);
  font-size: 11.5px; color: var(--pr-ink-2);
}
.pr-guide-confirm-actions { display: flex; gap: 6px; }

/* ------------------------------------------------------------ 文献信息编辑 */

.pr-info-head { display: flex; align-items: flex-start; gap: 8px; }
.pr-info-heading { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pr-info-heading b { font-size: 13px; }
.pr-info-heading span { font-size: 10.5px; color: var(--pr-ink-3); }
.pr-info-form { display: flex; flex-direction: column; gap: 10px; }
.pr-info-form-row { display: flex; gap: 8px; flex-wrap: wrap; }
.pr-info-form-row .pr-info-field { flex: 1 1 90px; min-width: 0; }
.pr-info-abstract .pr-para { margin: 0 0 6px; }
.pr-info-abstract .pr-para:last-child { margin-bottom: 0; }

/* ------------------------------------------------------------ AI 关闭提示 */

.pr-ai-off {
  flex: none; display: flex; align-items: flex-start; gap: 7px;
  margin: 9px 12px 0; padding: 8px 10px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, #d9534f 20%, var(--pr-line));
  background: color-mix(in srgb, #d9534f 7%, transparent);
  color: var(--pr-ink-2); font-size: 11px; line-height: 1.55;
}
.pr-ai-off svg { flex: none; margin-top: 2px; color: #c04542; }

/* ---------------------------------------------------------------- 公式 */

.pr-math-inline { display: inline-block; max-width: 100%; vertical-align: baseline; }
.pr-math-block { max-width: 100%; overflow-x: auto; overflow-y: hidden; padding: 2px 0 4px; }
.pr-math-display { display: block; min-width: 0; }
.pr-math-block .katex-display { margin: 0; }
.pr-math-inline .katex { font-size: 1.02em; }

`
