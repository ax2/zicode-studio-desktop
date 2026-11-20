# Notes nested navigation and narrow-window acceptance — 2026-11-13

Tracking: [Issue #22](https://github.com/ax2/zicode-studio-desktop/issues/22), Project #4, v0.5.10. This is a scoped development acceptance, not a final release or full Issue completion.

## Fix

With a root notebook collapsed and its descendants remembering their open state, ArrowDown, ArrowUp and End included hidden descendants. In Windows WebView2 focus stayed on the current root. The old visibility helper only inspected the closest notebook/parent notebook. The replacement walks every ancestor, while keeping a collapsed notebook's own summary reachable. NotesApp imports the focused helper instead of growing its orchestration logic.

## Verification

- Before fix: three real navigation regressions reproduced both in unit tests and the running native Windows Studio. Four focused tests now pass, including reopening the ancestor and retaining descendant state.
- Main frontend Notes suite: 193 tests in nine files pass. TypeScript and `bun run check` pass; existing unrelated lint/design advisories remain.
- Rebuilt only `public/native/react/notes.js` with the repository esbuild feature settings. No Rust rebuild, package/version change, other-platform build or full React resource overwrite.
- Native WebView2, actual 1200 and 422 CSS-pixel windows: all three keyboard cases pass; hovering reduces title width without overlapping actions; management menu stays in the viewport and Escape closes it; no horizontal page/sidebar overflow.
- Normal restart preserves five nested notebook expansion states, including an open descendant under a closed root. Repeated keyboard checks pass. Both launches retain all 128 pre-existing synthetic Notes files byte-for-byte (mutable global changes log and lock excluded explicitly).
- At 422px, actual mouse wheel scroll moves the list; selecting the synthetic note and dismissing the sidebar overlay exposes its exact body. Page width remains 422px.
- Page identity, meaningful content and absence of framework overlays checked; no page errors. A tray creation warning `-2147467259` was captured on the separate background test desktop. This is retained, not claimed as successful tray acceptance. Native exit cleanup warning 1412 remains in launch logs.
- All three owned native instances were identity-checked and exited normally; no forced termination or personal data/selector access. Runtime then handed to the visual-assets chat for its #41 matrix.

## Build and evidence

- EXE SHA256: `969FE04C475A4DCCFEB5C56A9618C1FB8EF12DDD6BEDB377CDC91562D06DEB63` (existing development 0.5.3).
- Notes bundle SHA256: `F9B721C5213DD773033D3769DB45174F6D93AFCE7C3347463E535B751982F10C`.
- Visual-assets bundle unchanged: `DAA6D8E1AF8B0E8185AC9F2D0AF5D71055B4C07D4DD2A88B49B5A9F071C10CC6`.
- Root chat evidence: `outputs/notes-tree-{navigation-before,navigation-after,suite,typecheck,check}.log`, `outputs/notes-narrow-{before,after,restart}-native.json`, width-specific screenshots and `outputs/notes-narrow-scroll-overlay.json`.
- Browser plugin not available; existing Playwright attached only to the owned native WebView2. No dependency installation.
- Preserved harness failures: native/client pixel calibration, summary icon targeting, ambiguous sidebar selector, and a generic editor-text assertion replaced by the observed exact synthetic body. Product assertions were not relaxed.

Remaining: full Issue scope and final v0.5.10 candidate/upgrade verification remain separate. No release, installer or personal-data migration performed. Project priorities, dates and Milestones unchanged; no automation created.
