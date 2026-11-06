# Windows browser blank-page correction — 2026-11-06

The user reported a completely blank webpage in the daily installation. An actual native screenshot reproduced the failure even though the URL, title, body extraction and native visibility flag worked. Earlier content/visibility checks were insufficient to establish visible pixels; the original failure and acceptance qualification are retained.

## Correction and scope

Read-only native sibling-window enumeration found the full-window Studio chrome above the webpage container in the installed build. `native_view.rs` now presents that container using `HWND_TOP` with `SWP_NOACTIVATE`, retaining the existing modal/application hide rules and avoiding focus activation.

The first candidate run also exposed a separate resize race: native creation rejected stale bounds, leaving the selected page uncreated. A dedicated frontend helper retries only the exact viewport-fit error, at most three times, remeasuring on the next animation frame. Presentation rechecks tab/modal state and fresh geometry after creation. Creation errors now participate in surface-error recovery. Host bounds validation and resource limits are unchanged. This is a small wiring change in the browser composition module plus a focused retry module; no new command, schema or data location is introduced.

## Validation

- Strict Rust all-target check/clippy passed, retaining the pre-existing formatting advisory; `build:local` succeeded using the existing target. Final frontend/design checks passed with existing warnings. All 49 browser tests in 13 files passed, including bounded retry, unrelated-error rejection and cancellation cases.
- The real QA Studio/Host/WebView2 passed Example page loading and body extraction, preview-modal hiding, closing-modal restoration, Notes hiding and Browser restoration. The seven original tabs and closed queue were retained, and the original active tab was restored.
- Native window-tree records show the old webpage at sibling index 1 behind full-window chrome index 0; the fixed candidate and daily installation put the visible webpage at index 0 above chrome, with nonzero matching bounds throughout its nested WebView children.
- Computer Use was stopped by the user's Escape action after the failure was reproduced. No native input, activation or screenshot was resumed. Later window diagnostics were read-only. **Post-fix rendered pixels have not been screenshot-verified.** These checks establish corrected native stacking and functional page behavior, not a complete visual or browser-stage acceptance.

## Daily installation and preservation

The fixed EXE SHA-256 is `6a252f085269a5e0f9c1f3fb43bd5712c8cbf56d486df288e3c26622d5831848`. Only the receipt-verified owned QA process 98232 and daily process 68932 were normally exited. Hidden daily shutdown used its checked event-loop thread without restoring/activating the window; no forced termination was used. The existing installed EXE's bytes were replaced while retaining its Medium ACL. The current normal process is 70936 at `D:\work\apps\zicode-studio-desktop\zicode-studio-desktop.exe`, using the unchanged fixed profile `D:\work\local-state\zicode-studio-desktop`. It responds normally, is the single installed instance, has a registered tray icon and owned Host port 57620, and runs at ordinary Medium integrity. Validation ports 9227/9233/9234 are closed; unrelated port 9231 was not touched.

All 81 audited original data files, including 65 notebook/note/attachment files, remain exact. The fixed profile selector, registered workspaces and audited preference/paired-device table digests remain exact; database integrity checks pass. Real Host reads preserve complete note-object and notebook metadata hashes for both recorded workspace requests (six returned notes per request, not a claim of twelve distinct notes). All 43 plugin versions/enabled states/grants are unchanged.

The daily browser retains its original tab, active ID, URL, title, zoom, mute state and closed queue exactly; preferences/bookmarks and all four prior history rows remain. Restart added one normal history visit. The first full-payload comparison failed because it retained the nested session revision counter despite excluding the SQL counter. A separate diagnostic reproduced the **original fingerprint exactly**, changing only the current nested revision 15 back to 13; every other session field is therefore proven unchanged. The original failed comparison is preserved, not overwritten.

Note snapshots are retained at `retained-backups/before-browser-blank-2026-11-06/{before,stopped}` under the fixed profile. Exact prior EXE bytes are retained as `.before-blank-fix-20261106`; the previous stable rollback file remains. No original data was restored or deleted, and no authentication/model credentials were copied. This audits specified data roots rather than all caches/logs. Backup restoration itself remains untested.

## Evidence and remaining work

Chat outputs: `browser-blank-{page,modal,close-modal,notes,browser,finish}.json`; `browser-blank-{installed,page}-window-tree.json`; `browser-blank-installed-final-window-tree.json`; `browser-blank-delivery-data-{before,stopped,after}.json`; `browser-blank-delivery-host-{before,after}.json`; `browser-blank-store-{before,stopped,after}.json`; `browser-blank-revision-proof.json`; `browser-blank-{first,daily}-closure.json`; `browser-blank-current-launch.json`; `browser-blank-normal-final.json`; `browser-blank-acceptance.json`; `browser-blank-budget-after.json`. Failed candidate/viewport diagnostics remain alongside the passing records.

Storage scan completed with zero unknown entries and adequate free space; referenced QA/profile scratch exceeds its advisory budget and is retained. No cache cleanup, version bump, duplicate full runtime, schedule, paid model request, external message or publication occurred.

The installed debug runtime still serves frontend assets from repository `public`; isolating daily assets from future development remains a delivery follow-up. Post-fix pixels, complete browser P0–P6, earlier note-move regressions, cloud sync and remaining tool integration remain open. This correction does not complete the broader Studio goal.
