# Live download updates beyond the first history page — 2026-11-12

An active download is included with the latest history page, even if its stored sequence is older than the newest 100 records. Once it becomes terminal it no longer receives this inclusion. The Downloads UI previously merged only the latest page, leaving an already displayed older row stuck in its previous active state.

The manager now subscribes to the existing, window-scoped native `downloadChanged` events. It updates only records already loaded in the current list. It does not insert unknown records, revive removed rows or bypass search. Events received while a list request is pending take precedence over that request's older snapshot. Closing the dialog releases its observer. The existing first-page polling and older-page cursor remain unchanged; this does not poll the entire journal.

`browser-app.js` remains a composition root: its four added wiring lines publish native events to the manager and manage the subscription. Record reconciliation, rendering and focus stay in the download module. No new Rust API, permissions or background service was needed.

## Verification

- Two new regressions failed before the fix. All 189 browser tests and `bun run check` passed afterward. They cover an older row receiving a terminal event, an older pending response not reverting it, unknown/removed rows staying absent and subscription release on close.
- Playwright attached to the existing isolated Windows Studio/WebView2 at 1,000 and 422 CSS px. At each width, a real HTTPS attachment created a Host-owned waiting download. The harness then inserted 100 newer, task-owned history rows into that isolated database.
- The actual first-page response contained all 100 newer records and the older active download. Keyboard cancellation reached the real Host. The next first-page response excluded the now-cancelled older download, while the UI retained that row, updated its state and focused Remove from list. Removing it focused Close. No file was saved.
- The original page document identity, unsubmitted input and single page request were retained. All task-created records were removed by exact identity/payload. Original download history, eleven tabs, seven notes and bookmark contents matched afterward. The owned Studio exited normally; the daily profile was untouched.
- Page identity, nonblank UI, framework-overlay absence, console/page-error checks and interactions passed. The Browser plugin was absent; existing Playwright was used. Only Windows was exercised, reusing the native executable and linked frontend; no rebuild or installation occurred.

Evidence in the task workspace: `outputs/browser-download-live-first-tests.log`, `outputs/browser-download-live-tests.log`, `outputs/browser-download-live-check.log`, `outputs/browser-download-live-native.json`, `outputs/browser-download-live-real-cancel-422.png`, and the storage audit receipts. This proves the listed cancellation boundary and event reconciliation, not every file-transfer or platform behavior.
