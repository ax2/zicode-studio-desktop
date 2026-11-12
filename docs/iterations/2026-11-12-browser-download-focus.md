# Download action focus — 2026-11-12

Downloads now moves keyboard focus to the next available control in the same row when an action becomes hidden. Save can lead to Pause, Pause/Continue retains the same control, completion leads to Show in File Explorer, cancellation leads to Remove from list, and removing the row leads to Close. A rejected operation restores its original button if the user has not moved focus elsewhere. Search and other deliberate focus changes are retained.

Validation used Playwright against the existing isolated Windows Studio/WebView2 candidate at 1,000 and 422 CSS px. Browser plugin was not available. The shell identity was the local `/app/workspaces/` route and the native fixture title was `Download Focus QA`.

- Actual WebView2 rendering with controlled state responses passed save, pause, continue, completion, row removal, failed-operation recovery and preserving deliberate search focus. These controlled responses test UI state transitions, not download transport.
- At both widths, a real HTTPS attachment in the native webpage created a Host-owned waiting download. Keyboard cancellation reached the real Host, then focus moved to Remove from list. Removing that history entry moved focus to Close. No file was saved.
- The original document identity, unsent input and one-request page count were retained. The eleven original tabs, seven isolated notes and exact bookmark contents matched after cleanup. No application errors or framework overlay were observed. Both owned test processes exited normally without forced termination.
- All 187 browser frontend tests passed, as did `bun run check`. Three new regression tests cover state/focus transitions; two failed against the original implementation. This frontend-only change reused the existing executable and linked resources; no native rebuild or installer was needed.

The first native run passed the wide-window interactions but failed a document-revision assertion after clicking the attachment. The engine intentionally increments its source revision on navigation start even when an attachment leaves the DOM intact. The final harness separately verifies document identity, unsent text and page request count, and retains the new revision after that navigation. No application behavior was changed to bypass this assertion. Both failure receipts remain available.

Evidence in the task workspace: `outputs/browser-download-focus-first-tests.log`, `outputs/browser-download-focus-native.json`, `outputs/browser-download-focus-final-native.json`, `outputs/browser-download-focus-final-422.png`, `outputs/browser-download-focus-final-real-cancel-422.png`, `outputs/browser-download-focus-browser-tests.log` and `outputs/browser-download-focus-check.log`.

Scope: Windows development candidate. Other platforms, physical input devices, actual file saving/resuming and a newly installed daily build are not newly certified by this change; their earlier acceptance remains separate. The daily user profile was untouched.
