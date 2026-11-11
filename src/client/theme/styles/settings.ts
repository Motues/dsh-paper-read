/**
 * 系统设置页。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const settings = String.raw`
/* ============================================================== 系统设置 */

.pr-settings-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.pr-settings-top {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 24px;
  padding: 16px 28px 14px;
  border-bottom: 1px solid var(--pr-line);
}
.pr-settings-heading { flex: 1 1 auto; min-width: 0; }
/* Same size as every other page title (see .pr-page-head h1). */
.pr-settings-heading h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -.01em;
  line-height: 1.3;
}
.pr-settings-save {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding-top: 3px;
  color: var(--pr-ink-3);
  font-size: 11.5px;
  white-space: nowrap;
}
.pr-settings-save[data-state="saved"] { color: var(--pr-ink-2); }
.pr-settings-save[data-state="saved"] svg { color: var(--pr-accent); }
.pr-settings-save-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pr-accent);
  animation: pr-pulse 1s ease-in-out infinite;
}

.pr-settings-notice {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 36px;
  border-bottom: 1px solid var(--pr-line);
  background: color-mix(in srgb, var(--pr-accent) 5%, transparent);
  color: var(--pr-ink-2);
  font-size: 11.5px;
  line-height: 1.55;
}
.pr-settings-notice[data-tone="error"] {
  color: #c04542;
  background: color-mix(in srgb, #d9534f 7%, transparent);
}
.pr-settings-notice > span { flex: 1 1 auto; min-width: 0; }
.pr-settings-notice-close {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 1px -4px 0 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  opacity: .65;
  cursor: pointer;
}
.pr-settings-notice-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--pr-ink) 7%, transparent);
}
.pr-settings-notice-close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--pr-accent) 45%, transparent);
  outline-offset: 1px;
}

.pr-settings-layout {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.pr-settings-nav {
  width: 216px;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 22px 14px 22px 36px;
  overflow-y: auto;
}
.pr-settings-nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pr-settings-nav-group + .pr-settings-nav-group { margin-top: 22px; }
.pr-settings-nav-title {
  padding: 0 10px 6px;
  color: var(--pr-ink-3);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.pr-settings-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--pr-ink-2);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease;
}
.pr-settings-nav-item:hover {
  background: color-mix(in srgb, var(--pr-ink) 5%, transparent);
  color: var(--pr-ink);
}
.pr-settings-nav-item[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 10%, transparent);
  color: var(--pr-ink);
  font-weight: 550;
}
.pr-settings-nav-icon {
  flex: none;
  width: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--pr-ink-3);
}
.pr-settings-nav-item[data-on] .pr-settings-nav-icon { color: var(--pr-accent); }
.pr-settings-nav-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pr-settings-nav-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pr-accent) 40%, transparent);
}

.pr-settings-scroll {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  padding: 26px 36px 72px 38px;
}
.pr-settings-main { max-width: 700px; }

.pr-settings-section { min-width: 0; }
.pr-settings-section-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -.01em;
  line-height: 1.35;
}
.pr-settings-section-head p {
  margin: 5px 0 0;
  color: var(--pr-ink-3);
  font-size: 12px;
  line-height: 1.65;
}
.pr-settings-rows { margin-top: 16px; }

.pr-setting {
  padding: 15px 0;
  border-top: 1px solid var(--pr-line);
}
.pr-setting-line {
  display: flex;
  align-items: center;
  gap: 28px;
}
.pr-setting-text { flex: 1 1 auto; min-width: 0; }
.pr-setting-text b {
  display: block;
  color: var(--pr-ink);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.45;
}
.pr-setting-desc {
  margin-top: 3px;
  color: var(--pr-ink-3);
  font-size: 11.5px;
  line-height: 1.6;
}
.pr-setting-desc > span { display: block; }
.pr-setting-desc > span + span { margin-top: 4px; }
.pr-setting-control {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.pr-setting-control[data-wide] { width: 340px; }
.pr-setting-body { margin-top: 12px; }

.pr-settings-hint {
  margin: 0;
  color: var(--pr-ink-3);
  font-size: 11.5px;
  line-height: 1.6;
}
.pr-settings-hint + .pr-settings-hint { margin-top: 6px; }
.pr-settings-hint[data-error] { color: #c04542; }
.pr-root[data-scheme="dark"] .pr-settings-hint[data-error] { color: #ff9b9b; }
.pr-settings-empty {
  padding: 7px 10px 9px;
  color: var(--pr-ink-3);
  font-size: 11.5px;
}

.pr-settings-page .pr-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
}
.pr-settings-page .pr-btn[data-primary] { box-shadow: none; }
.pr-settings-page .pr-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--pr-accent) 45%, transparent);
  outline-offset: 2px;
}

.pr-settings-page .pr-switch {
  width: 38px;
  height: 22px;
  padding: 2px;
  border: 0;
  border-radius: 99px;
  background: color-mix(in srgb, var(--pr-ink) 14%, transparent);
  box-shadow: none;
}
.pr-settings-page .pr-switch i {
  width: 18px;
  height: 18px;
  border-radius: 99px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .18);
  transition: transform 160ms ease, background 160ms ease;
}
.pr-settings-page .pr-switch[data-on] { background: var(--pr-accent-solid); }
.pr-settings-page .pr-switch[data-on] i { transform: translateX(16px); }
.pr-settings-page .pr-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 18%, transparent);
}
.pr-settings-page .pr-switch[data-disabled] {
  opacity: .45; cursor: not-allowed;
}

/* ── translation source settings ─────────────────────────────────────────── */
.pr-settings-input {
  height: 32px;
  width: 100%;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--pr-line);
  border-radius: 8px;
  background: var(--pr-paper);
  color: var(--pr-ink);
  font: inherit;
  font-size: 12px;
}
.pr-setting-control[data-wide] .pr-settings-input { flex: 1 1 auto; }
.pr-settings-number-input { width: 96px; text-align: center; }
.pr-settings-input::placeholder { color: var(--pr-ink-3); }
.pr-settings-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 12%, transparent);
}

.pr-translation-panel { display: flex; flex-direction: column; gap: 14px; }
.pr-translate-sources {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.pr-translate-source-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--pr-line);
  border-radius: 10px;
  background: transparent;
  color: var(--pr-ink-2);
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}
.pr-translate-source-card:hover { border-color: color-mix(in srgb, var(--pr-ink) 22%, var(--pr-line)); }
.pr-translate-source-card[data-on] {
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
  background: color-mix(in srgb, var(--pr-accent) 7%, transparent);
}
.pr-translate-source-card:disabled { opacity: .6; cursor: default; }
.pr-translate-source-card b { color: var(--pr-ink); font-size: 12px; font-weight: 600; line-height: 1.4; }
.pr-translate-source-card span { color: var(--pr-ink-3); font-size: 10.5px; line-height: 1.5; }
.pr-translate-source-card i {
  margin-top: 1px;
  color: var(--pr-accent);
  font-style: normal;
  font-size: 10px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.pr-translate-config { display: flex; flex-direction: column; }
.pr-translate-key { display: flex; align-items: center; gap: 8px; width: 100%; }
.pr-translate-key input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--pr-line);
  border-radius: 8px;
  background: var(--pr-paper);
  color: var(--pr-ink);
  font: inherit;
  font-size: 12px;
}
.pr-translate-key input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--pr-accent) 55%, var(--pr-line));
}
.pr-translate-models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  max-height: 170px;
  overflow-y: auto;
}
.pr-translate-test-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--pr-line);
}
.pr-translate-test-result {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--pr-ink-3);
  font-size: 11.5px;
  line-height: 1.5;
}
.pr-translate-test-result b { color: var(--pr-ink); font-size: 11.5px; }
.pr-translate-test-result[data-ok] b { color: #2f7d4f; }
.pr-translate-sample {
  margin-top: 2px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--pr-ink) 5%, transparent);
  color: var(--pr-ink-2);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pr-settings-hint[data-tone="warn"] { color: #a86412; }
.pr-root[data-scheme="dark"] .pr-settings-hint[data-tone="warn"] { color: #e7b36a; }

@media (max-width: 640px) {
  .pr-translate-sources { grid-template-columns: 1fr; }
}

`
