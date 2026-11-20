# Windows browser public-link tabs — 2026-11-06

Ordinary user-requested public HTTP(S) links that request a new window now open as independent Studio tabs immediately after their source. The original page remains intact. Automatic requests, hidden source pages and modal-covered pages remain denied. This increment is installed in the daily Windows runtime; it does not complete the browser task book.

## Implementation and boundary

The native WebView2 NewWindowRequested handler marks every request handled synchronously. It checks the real user-initiation flag, controller visibility, bounded URL and existing BrowserPolicy before sending an owner/lifetime-bound event to trusted chrome. Rejected URLs are suppressed. A focused frontend module checks current source identity and handles pending requests; the existing openSavedPage composition path rechecks current state after native creation and closes an orphan if persistence fails. No new top-level command, permission, schema or version is introduced. The small wiring addition in the existing large browser composition module reuses tab lifecycle and persistence instead of duplicating them.

These are independent tabs: window.open return-object/opener communication, login-linked popup flows, background dispositions and a complete context menu are not accepted. No unmanaged native popup is created. Wry's existing controller.Close teardown releases event-handler references.

## Actual validation

- All 55 frontend cases across 14 files passed; the native boundary case passed. Frontend/design, Pi alignment and strict Rust all-target checks/clippy passed; existing warnings and the formatting advisory remain recorded. Local debug build succeeded using the existing target. Translation coverage has zero missing keys.
- Two separate loopback CDP endpoints connected to the actual QA chrome and native webpage. A Playwright click on the owned target=_blank link produced a real native user-initiated event and a new selected Studio tab. Actual Host/native capture read Example Domain from the new page; source DOM remained unchanged.
- Automatic, private-loopback, hidden-source and modal-covered requests were denied by the real native handler. A second process restored the exact saved tabs and active linked page, and read its native body again. Both owned fixture tabs were then closed, retaining the original seven tabs, closed queue and two synthetic notes.
- The first harness attempt incorrectly assumed setContent left no transient user activation. The real native event reported userInitiated=true and opened a tab. The failure, activation diagnostic and exact owned-fixture cleanup are retained. The final harness waits for actual userActivation.isActive=false and uses raw CDP userGesture=false for the automatic-request case. Product policy was not relaxed.
- QA processes 109092 and 103584 exited normally; all four dynamically allocated debug endpoints were checked closed. Unrelated Edge port 9231 was untouched. Browser plugin was not available, so the existing bundled Playwright was used. No new dependency was installed.
- Computer Use remains stopped. No desktop input, activation or screenshot was resumed. A final read-only native window tree confirms a visible nonzero webpage container above Studio chrome. **Native webpage pixels were not screenshot-verified.**

## Daily installation and retained data

The receipt-verified owned previous daily process 104400 exited normally. EXE and matching built public assets were replaced together. The new installed process is 101204, SHA-256 `8cf06c03e90ccc0e92ed2128d275d00f0613b4ee1324cc067c7920e47de00657`. All 580 installed assets (9,393,917 bytes) match their manifest; five representative files also match through the actual daily HTTP Host. Daily startup is responsive, ordinary Medium integrity, single instance, tray registered, Host 57620, with no debug connection requested.

The fixed profile remains `D:\work\local-state\zicode-studio-desktop`. All 81 audited files, including 65 note/notebook/attachment files, remain exact. Database integrity, profile selector, workspace records and audited preference/paired-device digests pass. Both recorded Host workspace requests retain their six returned note objects and notebook metadata (not a claim of twelve distinct notes). All 43 plugin versions, enabled states and grants remain exact.

The original daily browser tab, active ID, URL/title, zoom/mute and closed queue remain exact after normal revision normalization. Preferences/bookmarks and all eight pre-update history rows remain; restart added one normal visit. Notes-only snapshots remain in `retained-backups/before-browser-popup-2026-11-06/{before,stopped}`. Prior EXE and frontend are retained as `.before-popup-20261106` and `public.before-popup-20261106`. No credentials were copied, no original data was restored/deleted, and no schedule was created.

## Evidence and remaining scope

Chat outputs: `browser-popup-acceptance.json`, `browser-popup-{create,restore}-native.json`, `browser-popup-{create,restore}-closure.json`, `browser-popup-{data,store,host}-{before,after}.json`, `browser-popup-assets-manifest.json`, `browser-popup-daily-assets.json`, `browser-popup-current-launch.json`, `browser-popup-normal-final.json`, `browser-popup-final-window-tree.json`, `browser-popup-budget-after.json`. Original failure and cleanup records remain under the same prefix. Check/build logs are in chat work under `browser-popup-*`.

Storage scans have zero unknown entries and adequate free space. Referenced scratch exceeds its advisory budget and was retained. No duplicate full runtime, forced process termination, model call, external message or publication occurred. Download/upload workflows, complex login popups, full P0-P6 acceptance, earlier note-move failures, cloud sync and remaining tool integration stay open.

Official references: [WebView2 NewWindowRequested semantics](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2newwindowrequestedeventargs?view=webview2-1.0.3800.47), [Playwright WebView2](https://playwright.dev/docs/webview2), [controller Close and handler lifetime](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2controller.close?view=webview2-dotnet-1.0.3296.44).
