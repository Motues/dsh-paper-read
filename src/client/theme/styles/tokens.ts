/**
 * 主题变量、暗色覆盖、基础重置与滚动条。
 *
 * Split from the former single stylesheet for readability. Rule order is
 * significant and fixed by ./index.ts; keep every rule in this file in its
 * original sequence.
 */
export const tokens = String.raw`
.pr-root {
  --pr-line: var(--dsw-alias-border-l1, #e6e7ea);
  --pr-line-strong: var(--dsw-alias-border-l2, #d4d6db);
  --pr-ink: var(--dsw-alias-label-primary, #1f2328);
  --pr-ink-2: var(--dsw-alias-label-secondary, #6b7280);
  --pr-ink-3: var(--dsw-alias-label-tertiary, #9ca3af);
  /* The accent, composed from the live cascade — no snapshot copy, no re-render.
     Three sources, most "contractual" first:

     1. --pr-accent-host. Written by index.tsx from the theme snapshot whenever a
        theme layer actually set an accent token (the built-in light/dark themes
        ship an EMPTY token map, so anything there came from a plugin). This is
        the documented path: ctx.theme.overrideTokens() / ctx.theme.register()
        → composed snapshot → written inline on <body>. Any colour plugin that
        recolours the shell has to go through it, so we follow whatever token
        that plugin happened to pick (brand-primary, state-business-primary or
        button-primary-fill) instead of hard-coding one.

     2. --we-accent. The desktop appearance plugin (dsh-plugin-wallpaper-engine,
        "全局配色") publishes its choice as this body-level variable. It is not a
        hosted token: its own remaps are SCOPED to host anchors
        (body[data-we-glass-page] [data-composer-seat] for the send button,
        [data-presented-file] for links, the settings dialog, the left rail), so
        a page outside those anchors gets nothing from them and has to read the
        variable itself. Disabling that plugin removes the variable and this rung
        drops out.

     3. --dsw-alias-state-business-primary. The stock host accent: blue out of
        the box (#4176e6 light / #7aaaff dark, the composer send-button shade)
        and the focus-ring colour, so a token layer usually rewrites it too.
        --dsw-alias-brand-primary cannot lead here: stock resolves it to the
        monochrome #0f1115 / #f9fafb, i.e. a white button on a dark theme.
        --dsw-alias-button-info-fill is a static alias of the deepseek primitive
        that no accent layer rewrites, so it stays stock blue after the user
        picks pink.

     Values resolve at use site, so a theme or accent switch recomputes every
     rule below with no re-render. */
  --pr-accent: var(--pr-accent-host, var(--we-accent, var(--dsw-alias-state-business-primary, #4176e6)));
  /* Ink on a filled accent surface. --pr-ink-host is computed from the same
     accent when the value came from the snapshot; --we-accent-ink is the
     appearance plugin's WCAG pick for its own variable. An accent fill wants
     one of those rather than --dsw-alias-label-primary-foreground, which flips
     to near-black on dark regardless of the fill. */
  --pr-on-accent: var(--pr-ink-host, var(--we-accent-ink, #fff));
  /* Alias kept so every fill reads one knob. */
  --pr-accent-solid: var(--pr-accent);
  --pr-paper: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 88%, #ffffff 12%);
  --pr-hl: color-mix(in srgb, #f5c542 34%, transparent);
  --pr-hl-blue: color-mix(in srgb, #4f8df5 26%, transparent);
  --pr-hl-rose: color-mix(in srgb, #ef6a8c 24%, transparent);
  --pr-hl-green: color-mix(in srgb, #3fae7a 24%, transparent);
  --pr-hl-purple: color-mix(in srgb, #9b7bf0 24%, transparent);
  --pr-hl-orange: color-mix(in srgb, #f08a3c 26%, transparent);
  --pr-shadow: 0 18px 44px -22px rgba(15, 23, 42, .38);
  /* Solid base for popovers. The theme's surface tokens can be translucent under
     the glass/wallpaper themes, so the menus paint this first and layer the
     overlay token on top: never see-through, still themed when the token is
     opaque. */
  --pr-popover-base: #ffffff;
  --pr-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  /* Relation graph palette: six distinguishable cluster hues per scheme. */
  --pr-g1: #3f7eee;
  --pr-g2: #1f9d78;
  --pr-g3: #d08a1f;
  --pr-g4: #8a63e8;
  --pr-g5: #d9536b;
  --pr-g6: #0f93a5;
  /* Year ramp (old → new). Only used when the graph is switched to year mode. */
  /* Old → new. The light end stays legible on paper: a near-white first step
     made 2017 papers disappear, which is the exact failure mode of CP's ramp. */
  --pr-y1: #b7c8dd;
  --pr-y2: #93abc9;
  --pr-y3: #6c88ae;
  --pr-y4: #4a6890;
  --pr-y5: #2b4b7d;
  /* Relation kinds. 引用/同方法/同问题/应用/相反 are fixed hues; 基于 borrows the
     accent, because it is the relation the user most often cares about. */
  --pr-k-cites: #8a94a6;
  --pr-k-builds: var(--pr-accent);
  --pr-k-method: #2f9e76;
  --pr-k-problem: #c98324;
  --pr-k-uses: #8a6be0;
  --pr-k-contra: #d15a72;

  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: 0;
  background: transparent;
  color-scheme: light;
  color: var(--pr-ink);
  font-family: var(--ds-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.pr-root *, .pr-root *::before, .pr-root *::after { box-sizing: border-box; }
.pr-root[data-scheme="dark"] {
  /* Keep the brand fill; only the paper and shadows need a dark-specific value. */
  color-scheme: dark;
  --pr-paper: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #1b1c1f) 92%, #ffffff 8%);
  --pr-shadow: 0 18px 44px -22px rgba(0, 0, 0, .72);
  --pr-popover-base: #1e1f22;
  --pr-g1: #7aa7ff;
  --pr-g2: #4dd4a4;
  --pr-g3: #f0b455;
  --pr-g4: #b595ff;
  --pr-g5: #ff8fa3;
  --pr-g6: #45c7d8;
  --pr-y1: #59677a;
  --pr-y2: #6f8199;
  --pr-y3: #8aa2bf;
  --pr-y4: #a9c4e2;
  --pr-y5: #cfe3ff;
  --pr-k-cites: #9aa4b6;
  --pr-k-method: #45c79a;
  --pr-k-problem: #e6a94e;
  --pr-k-uses: #a98cf5;
  --pr-k-contra: #ef7d93;
}
.pr-root[data-scheme="dark"] .pr-sheet {
  box-shadow: 0 26px 62px -30px rgba(0, 0, 0, .85), 0 2px 6px rgba(0, 0, 0, .38);
}
/* The full-width .pr-sheet is only a layout wrapper in PDF mode. Without this
   dark-mode override its shadow survives the data-pdf reset and reads as a
   shadow on the whole reading column instead of on the PDF page. */
.pr-root[data-scheme="dark"] .pr-sheet[data-pdf] { box-shadow: none; }
.pr-root[data-scheme="dark"] .pr-pdfpage {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, .1),
    0 1px 2px rgba(0, 0, 0, .46),
    0 12px 32px rgba(0, 0, 0, .58);
}
/* Scrollbars: one quiet, buttonless bar for the rails and every scrolling pane
   in the panel. Chromium ignores ::-webkit-scrollbar as soon as a non-auto
   scrollbar-width / scrollbar-color is in force (the desktop shell and the
   wallpaper theme both set one), so those are reset to "auto" here and the
   standard properties are restored only for engines without the pseudo-elements
   (Firefox), whose thin bar has no step buttons anyway. */
.pr-thumbs,
.pr-root [data-scroll] {
  scrollbar-width: auto;
  scrollbar-color: auto;
}
.pr-thumbs::-webkit-scrollbar,
.pr-root [data-scroll]::-webkit-scrollbar {
  width: 8px; height: 8px; background: transparent;
}
/* Drop the native up/down step buttons: keep the track and the thumb only. */
.pr-thumbs::-webkit-scrollbar-button,
.pr-root [data-scroll]::-webkit-scrollbar-button {
  display: none; width: 0; height: 0; background: transparent;
}
.pr-thumbs::-webkit-scrollbar-track,
.pr-root [data-scroll]::-webkit-scrollbar-track,
.pr-thumbs::-webkit-scrollbar-corner,
.pr-root [data-scroll]::-webkit-scrollbar-corner { background: transparent; }
.pr-thumbs::-webkit-scrollbar-thumb,
.pr-root [data-scroll]::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--pr-ink-3) 32%, transparent);
  background-image: none;
  border-radius: 99px;
  border: 2px solid transparent;
  background-clip: padding-box;
  min-height: 28px;
}
.pr-thumbs:hover::-webkit-scrollbar-thumb,
.pr-root [data-scroll]:hover::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--pr-ink-3) 46%, transparent);
}
.pr-thumbs::-webkit-scrollbar-thumb:active,
.pr-root [data-scroll]::-webkit-scrollbar-thumb:active {
  background-color: color-mix(in srgb, var(--pr-ink-3) 58%, transparent);
}
@supports not selector(::-webkit-scrollbar) {
  .pr-thumbs,
  .pr-root [data-scroll] {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--pr-ink-3) 34%, transparent) transparent;
  }
}

`
