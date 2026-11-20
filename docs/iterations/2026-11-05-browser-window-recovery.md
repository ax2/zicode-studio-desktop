# Native browser event lifetime and window recovery — 2026-11-05

## Change

Each native page now owns an event lifetime independent of its tab ID. Closing the page retires its callbacks before WebView2 controller destruction. Destroying the engine retires all pages before closing any controller, because COM teardown may pump callbacks from other pages. Failed construction also drops the lifetime. Existing permission, popup, download and navigation decisions still run; this guard suppresses delivery to Studio, not security enforcement.

Two deterministic tests cover a late old callback after a new page reuses the same logical identity, and a failed page's callback without disabling a live peer. The guard applies to callbacks reaching the emitter after retirement. It does not retroactively recall events already dispatched to the UI, and does not establish cross-thread cancellation guarantees: native engine operations remain confined to the UI thread.

## Verification

Rust all-target check/strict clippy passed (existing formatting drift remains advisory). Ten focused browser tests passed, including the two new event-lifetime tests and existing retirement/capture/policy/surface/startup tests; 831 unrelated tests were filtered out. The reusable local debug build succeeded. This is not a whole-suite pass.

Actual Windows acceptance used an identity-checked owned isolated process. Three tab-create/close cycles passed with 1200/421 width transitions and all six baseline tab IDs/URLs preserved. Two normal WM_CLOSE cycles exercised close-to-tray; a third cycle exercised native minimization. Secondary launches with the same isolated profile exercised the same `show_workspaces` recovery function used by the tray. Each restored the original HWND/process, kept the active document revision and page body, preserved exact saved tabs and unsent address text, and allowed address-bar typing afterward. This is not a physical tray-menu click test or a native webpage keyboard-focus test. No website form, model call or user note mutation was involved.

The first restore harness stalled in its PowerShell helper with no secondary Studio process observed. The main Studio was responsive and hidden. Only that identity-checked owned helper was intentionally terminated; the existing Studio remained running. Direct process startup with the same executable/profile restored it successfully, and the complete three-cycle test then passed. This harness failure is retained, not erased or reported as an application pass.

Evidence: `outputs/browser-lifetime-tabs-native.json`, `browser-close-restore-native.json`, `browser-close-restore-helper-failure.json`, `browser-restore-helper-cancelled.json`. Logs: `work/browser-lifetime-rust.log`, `browser-lifetime-tests.log`, `browser-lifetime-build.log`. Event suppression after retirement is established by deterministic tests and actual lifecycle regression; delayed native callbacks were not forcibly injected into WebView2.

Full P0 and P1–P6 remain open. Manual partial selection, keyboard focus within arbitrary websites, complete native occlusion/tray/DPI coverage, real login/uploads/downloads, DNS/worker/WebSocket boundaries and model consumption are separate acceptance scopes. The installed daily runtime and user data remain untouched.
