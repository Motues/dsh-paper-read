/**
 * 导入队列、旧设置开关与首页外壳/导航。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const queue = String.raw`
/* ── 队列 ─────────────────────────────────────────────────────── */
.pr-queue {
  position: fixed; right: 20px; bottom: 20px; z-index: 70;
  width: 380px; max-height: 56vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--pr-line-strong); border-radius: 12px;
  box-shadow: 0 44px 100px -36px rgba(15, 23, 42, .55);
  animation: pr-pop 160ms ease-out;
}
.pr-queue-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--pr-line); }
.pr-queue-head b { font-size: 12.5px; font-weight: 600; }
.pr-queue-sub { font-size: 11px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-queue-list { overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.pr-queue-item { padding: 8px 9px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2, #f6f7f9); }
.pr-queue-title { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.pr-queue-name { font-size: 12px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-queue-state { margin-left: auto; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-queue-state[data-s="done"] { color: #2fa36b; }
.pr-queue-state[data-s="failed"] { color: #d9534f; }
.pr-queue-step, .pr-queue-note { font-size: 11px; color: var(--pr-ink-3); }
.pr-queue-note[data-error] { color: #d9534f; }
.pr-queue-steps { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.pr-step { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; color: var(--pr-ink-3); }
.pr-step i { width: 7px; height: 7px; border-radius: 99px; border: 1px solid currentColor; display: inline-block; }
.pr-step[data-s="done"] { color: #2fa36b; }
.pr-step[data-s="running"] { color: var(--pr-accent); }
.pr-step[data-s="failed"] { color: #d9534f; }
.pr-step[data-s="skipped"] { opacity: .6; }
.pr-step b { font-weight: 500; }
.pr-step[data-s="running"] b { animation: pr-pulse 1.4s ease-in-out infinite; }
@keyframes pr-pulse { 50% { opacity: .45; } }

/* ── 设置 ─────────────────────────────────────────────────────── */
.pr-folder-list { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; max-height: 148px; overflow: auto; }
.pr-folder {
  display: flex; align-items: center; gap: 7px; padding: 5px 8px;
  border: 1px solid var(--pr-line); border-radius: 8px;
  font-size: 11.5px; color: var(--pr-ink-2); background: var(--dsw-alias-bg-layer-2, #f6f7f9);
}
.pr-folder span { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-folder-actions { display: flex; gap: 8px; margin-bottom: 8px; }
.pr-folder-add { display: flex; gap: 6px; margin-bottom: 14px; }
.pr-folder-add input {
  flex: 1 1 auto; height: 28px; padding: 0 11px;
  border: 1px solid var(--pr-line-strong); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 12px;
}
.pr-settings-row {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 0; border-top: 1px solid var(--pr-line);
}
.pr-settings-row > div { min-width: 0; flex: 1 1 auto; }
.pr-settings-row b { font-size: 12px; font-weight: 600; }
.pr-switch {
  flex: none; width: 34px; height: 20px; border-radius: 99px; padding: 2px;
  border: 1px solid var(--pr-line-strong); background: var(--dsw-alias-bg-layer-2, #eceef1);
  cursor: pointer; display: flex; align-items: center;
}
.pr-switch i { width: 14px; height: 14px; border-radius: 99px; background: var(--pr-ink-3); transition: transform 140ms ease, background 140ms ease; }
.pr-switch[data-on] { background: var(--pr-accent-solid); border-color: transparent; }
.pr-switch[data-on] i { background: #fff; transform: translateX(14px); }
.pr-dlg-error { margin-top: 8px; font-size: 11.5px; color: #d9534f; }

/* ── 副驾补充 ─────────────────────────────────────────────────── */
.pr-summary { border: 1px solid var(--pr-line); border-radius: 10px; padding: 10px; margin-bottom: 10px; background: var(--dsw-alias-bg-layer-2, #f6f7f9); }
.pr-summary-tldr { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; line-height: 1.6; color: var(--pr-ink); }
.pr-summary-list { margin: 7px 0 0; padding-left: 16px; font-size: 11.5px; line-height: 1.62; color: var(--pr-ink-2); }
.pr-section-sub { font-size: 11px; font-weight: 600; color: var(--pr-ink-3); margin-bottom: 6px; letter-spacing: .02em; }
.pr-note-body { font-size: 11.5px; line-height: 1.6; color: var(--pr-ink-2); margin-top: 5px; white-space: pre-wrap; }
.pr-note-edit { margin-top: 6px; }
.pr-note-edit textarea {
  width: 100%; resize: vertical; min-height: 48px; padding: 6px 8px;
  border: 1px solid var(--pr-line-strong); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 11.5px; line-height: 1.55;
}
.pr-note-actions { display: flex; gap: 6px; margin-top: 5px; }
.pr-dot[data-c="yellow"] { background: #f5c542; }
.pr-dot[data-c="blue"] { background: #4f8df5; }
.pr-dot[data-c="rose"] { background: #ef6a8c; }
.pr-dot[data-c="green"] { background: #3fae7a; }
.pr-dot[data-c="purple"] { background: #9b7bf0; }
.pr-dot[data-c="orange"] { background: #f08a3c; }
.pr-rel-mini {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  padding: 6px 4px; border: 0; border-radius: 7px; background: transparent;
  color: var(--pr-ink); font: inherit; cursor: pointer;
}
.pr-rel-mini:hover { background: var(--dsw-alias-bg-layer-1, #fff); }
.pr-rel-mini-title { font-size: 11.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-rel-mini-why { font-size: 11px; color: var(--pr-ink-3); }
.pr-link { border: 0; background: none; padding: 0; color: var(--pr-ink); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.pr-link:hover { color: var(--pr-accent); }

/* ── 新版首页：左内容 / 右导航 ─────────────────────────────────── */
.pr-shell { flex: 1 1 auto; min-height: 0; display: flex; min-width: 0; }

.pr-content { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }

.pr-page {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  padding: 4px 28px 44px 30px;
}
.pr-page-head {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 0 14px; flex-wrap: wrap;
}
.pr-page-head h1 { font-size: 17px; font-weight: 650; letter-spacing: -.01em; margin: 0; line-height: 1.3; }
.pr-page-head > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pr-page-sub { font-size: 11.5px; color: var(--pr-ink-3); }

.pr-nav {
  width: 224px; flex: none;
  display: flex; flex-direction: column; gap: 4px;
  padding: 18px 12px 16px;
  border-right: 1px solid var(--pr-line);
  background: transparent;
}
.pr-nav-import { width: 100%; height: 40px; justify-content: center; font-size: 13.5px; font-weight: 650; }
.pr-nav-sep { flex: none; height: 1px; border: 0; margin: 12px 4px 8px; background: var(--pr-line); }
.pr-nav-head { display: flex; align-items: baseline; gap: 9px; padding: 2px 12px 16px; }
.pr-nav-head b { font-size: 13.5px; font-weight: 650; letter-spacing: -.01em; }
.pr-nav-head span { font-size: 10.5px; color: var(--pr-ink-3); font-variant-numeric: tabular-nums; }
.pr-nav-group { display: flex; flex-direction: column; gap: 4px; }
.pr-nav-item {
  display: flex; align-items: center; gap: 10px;
  height: 40px; padding: 0 12px;
  border: 0; border-radius: 10px;
  background: transparent; color: var(--pr-ink-2);
  font: inherit; font-size: 13.5px; text-align: left; cursor: pointer;
  transition: background 130ms ease, color 130ms ease;
}
.pr-nav-item:hover { background: color-mix(in srgb, var(--pr-ink) 9%, transparent); color: var(--pr-ink); }
.pr-nav-item[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 13%, transparent);
  color: var(--pr-ink); font-weight: 560;
}
.pr-nav-item svg { color: currentColor; }
.pr-nav-count {
  margin-left: auto; font-size: 10.5px; color: var(--pr-ink-3);
  font-variant-numeric: tabular-nums; font-weight: 400;
}
.pr-nav-foot {
  margin-top: auto;
  padding: 20px 12px 2px;
  color: var(--pr-ink-3);
  font-size: 10.5px;
  letter-spacing: .01em;
  white-space: nowrap;
}

`
