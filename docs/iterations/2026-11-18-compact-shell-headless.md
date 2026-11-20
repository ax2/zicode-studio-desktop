# Compact shell: keyboard fixes and headless theme/locale matrix

Tracked by [#35](https://github.com/ax2/zicode-studio-desktop/issues/35). The historical acceptance remains under v0.6.5; **the two new fixes target v0.6.6**, on `integration/v0.6.6`. Frozen v0.6.5 sources/packages are unchanged. Initial base was `f543a7c7`; the v0.6.6 target base `fe9b5b44` has no differences in the modified window/command modules, so this scoped proof remains reusable.

## Two actual rendered defects

1. With the shared window Close button keyboard-focused, CSS expands all three controls. Native Shift+Tab briefly clears `:focus-visible`; maximize/minimize become `display:none` during the transfer and focus falls to body. The exact sequence reproduced twice in the actual rendered module. `window-chrome.js` now retains a keyboard expansion attribute across focus transfers within the group, clearing it on exit. The existing hover/default appearance and native command interface are retained.
2. At 360 CSS px, More → Commands opens the panel from a navigation item which immediately becomes hidden. Escape tried returning to the hidden item or hidden Composer launcher, leaving focus on body. The command palette now restores only a visible connected target; it falls back to the visible command or More button. Existing focused inputs retain precedence. The added regression covers the hidden-launcher case and the actual headless keyboard loop passes.

## Environment and checks

Browser plugin was absent. The existing Playwright library and its dedicated cached Chromium were used with `headless:true`, fresh contexts and a loopback-only static server; no browser dependencies were installed. The test loads the real shipped index/CSS, PluginShell/ActivityBar, Browser, Composer, compact header, window controls and command palette. Only the native Host adapter is a fixed in-memory fixture. Native webpage pixels and actual OS window actions are explicitly excluded; screenshots label that substitute.

- **48/48** combinations: six real themes (night, dawn, midnight, clean, terracotta, sage), English/Chinese, 1280/360 CSS px, device scale factors 1/1.5.
- **6/6** additional cases: English/Chinese at 768/769/900 CSS px, scale factor 2. These also assert actual `devicePixelRatio`, localized window labels, Ctrl+T/Ctrl+W and preservation of all 18 original tab identities.
- Every case exercises address focus, next tab, page find/Escape, default/hover/keyboard window controls, synthetic maximize/restore, command palette Tab trap/Escape with a visible return target, and bookmark open/Escape with restored adapter surface. The document never horizontally overflows, all tab icons remain, and native-scrollbar replacement is retained. Captured page/console errors and external requests are zero. Representative narrow dark and desktop light screenshots were visually reviewed.
- **23** focused unit regressions pass across command palette, window chrome, compact header and sidebar lifecycle. Frontend TypeScript and `bun run check` pass with the existing warning baseline; only the affected command-palette bundle and CSS preparation were generated. No Rust/full application/Pi build or model request was made.

The compact [receipt](evidence/2026-11-18-compact-shell-headless.json) records scopes, source hashes and screenshot checksums. Full isolated matrix, failure receipts, fixture/runner and screenshots remain in the main-session workbench `outputs/issue35-shell/` and `work/issue35-shell-*`. Initial API/selector and unsettled-hover harness failures are separately retained; they are not product failures. Both product failures have pre-fix DOM/geometry evidence; no production budget or timeout was widened.

## Earlier native evidence reused

- [Single default workspace](2026-11-02-single-default-workspace.md): actual Windows hidden project/root concepts, 360px layout, native callbacks and retained file/Notes evidence.
- [Narrow tool overlay](2026-10-27-narrow-tool-overlay.md): actual native overlay teardown/responsiveness, lifecycle injection, unchanged data and real Host/Worker use.
- [Bookmarks](2026-11-05-browser-bookmarks.md): real native modal hide/restore at 1200/421 CSS px, persistent bookmark library and original tabs/Notes retained.
- [Window/tray recovery](2026-11-05-browser-window-recovery.md) and [tray/data preservation](2026-10-26-windows-tray-and-persistence.md): actual registered tray, locale and same-process restore evidence, with physical-menu boundaries preserved.

This batch does not repeat or expand those native claims. Headless pixel-ratio emulation does not prove physical Windows DPI changes or mixed-monitor behavior. Full native keyboard focus on arbitrary websites, physical tray menu use, comprehensive screen-reader/contrast acceptance and every application remain outside this scoped matrix. Keep #35's historical scope/remaining native acceptance visible for consolidated main-session verification; this targeted follow-up must not delay v0.6.5 publication. No user desktop, daily data, real credentials, paid/local models or schedules were touched.
