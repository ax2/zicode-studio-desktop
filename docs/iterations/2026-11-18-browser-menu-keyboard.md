# Browser tab-menu keyboard usability · 2026-11-18

Scope: [#10](https://github.com/ax2/zicode-studio-desktop/issues/10), v0.6.5. This increment changes the Studio tab context menu, not WebView2's page context menu.

## Delivered behavior

- A character key focuses the next enabled menu item beginning with that displayed character, cycling among matches. Matching ignores case and leading whitespace and supports displayed translated characters.
- Composition and Ctrl/Alt/Meta key combinations no longer move or dismiss this menu. This fixes an independently reproduced input guard gap: the previous handler intercepted composition ArrowDown/Escape and modified navigation keys.
- Existing Shift+F10 / ContextMenu opening, arrow/Home/End navigation, Escape focus restoration and ordinary button actions remain intact. Enter and Space retain native button behavior.

## Verification

No desktop program, real account, remote website, model or user profile was used. Vitest executes the production DOM menu and full browser-app module; native Host responses in the integration fixture are explicit test doubles, not a real WebView2 controller.

Commands use the repository's existing Bun, Vitest and dependencies with retries disabled:

- New menu suite before the change: 5 failures, showing the missing initial navigation and modifier/composition guard. The initial fixture also needed explicit English locale and fresh element references after menu reconstruction; those fixture errors were corrected before the retained red run.
- After the change: 5 menu cases, 13 existing shortcut cases and 6 existing browser recovery/activation cases passed (24 total).
- One new full browser-app integration case passed separately: Shift+F10 on a background tab → `m` focuses Mute tab → ordinary action dispatch targets only that background tab and persists its muted state while retaining the active tab and its unmuted setting. This checks routing and persistence, not audible output.
- Focused Biome lint on all three changed JS files and `git diff --check` passed. No CSS, markup, Rust, dependencies or generated assets changed; no new full build was needed.

## Remaining #10 scope

Actual Ctrl+wheel delivery and restart persistence, audible per-tab playback/muting, native WebView2 page-menu activation, native F11 and modified/middle-click link gestures, and authorized third-party login compatibility remain separate evidence gaps. Existing code or the DOM/native-response fixture is not evidence those native paths passed. Keep #10 open; do not add routine post-release validation or require a new desktop acceptance activity for this limited menu fix.
