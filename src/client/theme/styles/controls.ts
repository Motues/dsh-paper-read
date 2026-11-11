/**
 * Shared form controls: one custom select for every picker.
 *
 * Native `<select>` popups are painted by the OS, so they cannot follow the
 * plugin's light / dark / glass themes. The trigger, menu, search field and
 * options live here so the library filters, settings fields, the organize
 * dialog and the task filters all look and behave identically.
 */
export const controls = String.raw`
/* ── Select ─────────────────────────────────────────────────────── */
.pr-select-wrap { position: relative; min-width: 0; }
.pr-select-trigger {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 36px; padding: 0 10px;
  border: 1px solid var(--pr-line-strong); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--pr-ink);
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.pr-select-trigger[data-size="sm"] {
  height: 30px; padding: 0 9px; border-radius: 8px; font-size: 11.5px;
}
.pr-select-trigger:hover { border-color: color-mix(in srgb, var(--pr-accent) 38%, var(--pr-line-strong)); }
.pr-select-trigger[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--pr-accent) 60%, var(--pr-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
/* The host draws its own focus outline; keep one custom ring instead. */
.pr-select-trigger:focus,
.pr-select-trigger:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--pr-accent) 60%, var(--pr-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pr-accent) 12%, transparent);
}
.pr-select-trigger:disabled { opacity: .55; cursor: not-allowed; }
.pr-select-value {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-select-chevron { flex: none; color: var(--pr-ink-3); transition: transform .15s ease; }
.pr-select-trigger[aria-expanded="true"] .pr-select-chevron { transform: rotate(180deg); }

.pr-select-menu {
  position: fixed; z-index: 120;
  display: flex; flex-direction: column;
  min-width: 180px;
  border: 1px solid var(--pr-line-strong); border-radius: 10px;
  background-color: var(--pr-popover-base, #fff);
  background-image: linear-gradient(
    var(--dsw-alias-bg-overlay, transparent),
    var(--dsw-alias-bg-overlay, transparent)
  );
  box-shadow: 0 16px 36px -20px rgba(15, 23, 42, .42);
  overflow: hidden;
}
.pr-select-menu:focus { outline: none; }
.pr-select-search {
  display: flex; align-items: center; gap: 6px; flex: none;
  height: 34px; padding: 0 10px;
  border-bottom: 1px solid var(--pr-line); color: var(--pr-ink-3);
}
.pr-select-search input {
  flex: 1 1 auto; min-width: 0; border: 0; outline: 0;
  background: transparent; color: var(--pr-ink); font: inherit; font-size: 12px;
}
.pr-select-search input::placeholder { color: var(--pr-ink-3); }
.pr-select-list {
  flex: 1 1 auto; min-height: 0;
  max-height: 280px; overflow-y: auto; padding: 4px;
}
.pr-select-group {
  padding: 7px 8px 3px;
  color: var(--pr-ink-3); font-size: 10.5px; font-weight: 600;
  letter-spacing: .02em;
}
.pr-select-option {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 30px; padding: 5px 8px;
  border: 0; border-radius: 6px; background: transparent; color: var(--pr-ink);
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.pr-select-option[data-active],
.pr-select-option:hover {
  background: var(--dsw-alias-bg-layer-2, #f6f7f9);
}
.pr-select-option[data-on] {
  background: color-mix(in srgb, var(--pr-accent) 11%, transparent);
  font-weight: 550;
}
.pr-select-option:disabled { opacity: .45; cursor: not-allowed; }
.pr-select-option-name {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pr-select-option-path {
  flex: 0 1 auto; min-width: 0; max-width: 45%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--pr-ink-3); font-size: 11px;
}
.pr-select-check { flex: none; margin-left: 2px; color: var(--pr-accent); }
.pr-select-empty { padding: 13px 8px; font-size: 11.5px; color: var(--pr-ink-3); text-align: center; }

/* Settings rows use a slightly shorter trigger. */
.pr-settings-select .pr-select-trigger { height: 32px; border-color: var(--pr-line); }
.pr-settings-select .pr-select-menu { min-width: 220px; }

/* Library filter row. */
.pr-lib-filter .pr-select-wrap { width: 100%; }
.pr-lib-filter .pr-select-trigger { height: 30px; border-radius: 8px; font-size: 11.5px; }

/* Task filter row. */
.pr-tasks-filter .pr-select-wrap { min-width: 128px; }
.pr-tasks-filter .pr-select-trigger { height: 32px; }
`
