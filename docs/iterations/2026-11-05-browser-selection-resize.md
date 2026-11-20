# Browser selection, compact navigation and native resize — 2026-11-05

## Implementation

- Browser options move the startup selector out of the address row; the menu also offers an explicit Select all page text action. This fixed action changes the native selection and is separate from content extraction; no arbitrary evaluation command is exposed.
- Reload/Stop share one loading-aware button. Read page uses a named book icon. Narrow windows submit addresses with Enter and hide the redundant Go button. Preview opens centered on an opaque surface, with selected text at the top and Close initially focused.
- Native owner retirement is queued if COM callbacks arrive while the registry is borrowed. Cleanup runs on success/error and drops native values outside the registry borrow. Two focused tests cover re-entrant retirement and destructor-triggered peer retirement.
- Every raw Wry page now has its own inert native child container. Wry 0.55.1 `InnerWebView::drop` unconditionally detaches its parent's resize/focus subclass, although child creation does not install that subclass. Giving it Studio's HWND caused closing a tab to detach the privileged shell's resize handler. Container ownership keeps that removal local; the Wry view is destroyed before its container. Container bounds follow the browser viewport and current DPI; both container and controller hide for overlays.

## Preserved failure

The initial native selection/close test passed, but subsequent width acceptance failed. The real Tauri parent became 2100 physical pixels wide at 175% DPI while the shell stayed 421 CSS pixels wide. Owned-window inventory and Tauri innerSize established this was an application regression, not the test choosing the wrong window. The failure receipt and diagnostic are retained (`browser-selection-refine-first-failure.json`, `browser-selection-reload-diagnostic.json`). This motivated the independent container fix; a JavaScript resize workaround or broader Tauri permissions was not added.

## Validation so far

Before container repair, real Studio captured Example Domain's native title/URL and 917 selected characters after the explicit Select All action. Preview showed selection; its actual WebView2 controller hid. Closing an ephemeral tab during navigation/capture rejected stale reads and preserved the six prior tabs. This proves integrated explicit whole-page selection; manual partial selection and model consumption are not established.

Two menu tests, one loading-state navigation test, eight focused browser Rust tests, frontend checks and 3782-key i18n coverage passed. Container repair passed Rust all-target check and strict clippy; repository formatting drift remains advisory. The local debug build completed successfully.

The rebuilt Studio passed three create/close cycles, each followed by actual 1200/421 CSS-pixel resizing. Parent physical dimensions and shell CSS dimensions agreed within DPI rounding; all six baseline tab IDs/URLs remained. The narrow address field now measures approximately 175 pixels (868 at wide size), with no document overflow. The native selection preview is centered, opaque, starts at scrollTop 0, focuses Close and hides actual native controllers. Screenshots were visually inspected. These show Studio chrome/preview, not separate native webpage pixels.

The existing synthetic note was read through the real Notes Host after rebuild/restart and exactly matched its prior saved content. Its toolbar remained inside the shared header at 421 pixels; switching to Notes hid native controllers, and switching back restored the webpage. No note writes were needed.

The initial regression harness read selection and persistence at different points and failed its new-tab/close assertions; these failures are retained. The corrected harness waits on real Host state, closes the newly added tab by its verified position and checks every baseline ID/URL after each cycle. Only the three known empty tabs left by those failed attempts were cleaned up; no baseline tab was deleted.

Evidence: `outputs/browser-container-native.json`, `browser-selection-refined-native.json`, `browser-container-notes.json`; final chrome screenshots `browser-selection-final-menu-{1200,420}.png` and `browser-selection-final-preview.png`. Logs: `work/browser-container-rust.log`, `browser-container-build.log`, earlier `browser-selection-ui-tests.log`, `browser-navigation-test.log`, `browser-lifecycle-tests.log`, `browser-selection-refine-check.log`, `browser-selection-i18n.log`. Browser P0 remains incomplete; these are bounded regressions, not a whole-repository test pass.

User profile and installed daily runtime remain untouched. Only identity-checked owned isolated instances are closed normally. No schedules or model calls are used. Complete P0/P1–P6 remain open, including full focus/tray/occlusion, real login/uploads/downloads, DNS/worker/WebSocket isolation and actual model reasoning. Re-entrant teardown is covered by deterministic Rust tests, not an injected real COM destruction event.
