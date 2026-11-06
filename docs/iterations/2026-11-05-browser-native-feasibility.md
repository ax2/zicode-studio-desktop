# Windows browser engine feasibility — 2026-11-05

Scope: native engine primitives, not completed P0 and not an installed browser UI. User's full two-part task book is retained in `docs/browser/requirements.md`; ADR `0007-browser-engine-boundary.md` remains Proposed until actual Studio integration and the rest of P0 are accepted. Pi is unchanged. No schedules, accounts, models, current user data or current Studio process were used.

## Source review and candidate

Initial local HEAD and remote main both resolved to `a974f661188611c7a37f64b0b096bada96896c75`; local worktree has extensive earlier changes, preserved. Locked Tauri2.11.2/Wry0.55.1/WebView2 was inspected, alongside React/vanilla shell, Rust Host/plugin broker, fixed data paths, default capabilities and Windows local-build/NSIS packaging. The existing tray/window/command system assumes one registered Tauri view per window. Plain `add_child` changes the window type recognized by those Tauri APIs.

The candidate uses native Wry child controls under the same native window, outside the privileged Tauri registry. It reuses the exact cached engine crates and system WebView2; no CEF/Electron distribution, unstable Tauri feature, new browser download, framework switch or version bump. `src-tauri/src/browser/` owns the adapter, network/site policy and native acceptance helpers. `src-tauri/src/bin/browser-engine-probe.rs` is a Windows debug-only acceptance runner; it does not start the application's Host/Pi, load the user's profile, or register production commands. It is an independent native harness, not yet the requested Studio main-view integration.

## Actual checks

Final runner built and executed on current Windows in two consecutive real processes, in an owned isolated directory under `.cache/task-scratch/browser-p0/`. The window stays hidden; no native mouse/keyboard input, foreground restore or current-profile debug listener. Native controllers were created, selected, resized, hidden and destroyed through actual APIs.

- Three simultaneous page controls, independent native IDs/titles/body/URL. Four activation transitions checked native visibility flags. Native bounds are positive after resizing; complete DPI/focus/UI-overlay acceptance remains pending.
- Native history back/forward/reload, blocked file navigation, native URL matching to extracted page context, selection text matching a real DOM range.
- Final adapter loads a real public HTTPS page and checks title, native URL and content. Second process references the matching first-process HTTPS evidence. This is not broad site, media, OAuth or login acceptance.
- No Studio/Tauri object or desktop token on pages. Native WebView2 message transport and host objects are false before navigation. A test-only positive control proves messages are observable when enabled; after disabling, three actual calls produce zero host deliveries. The browser's normal code never enables this channel.
- Exact owned-loopback fixture exception only. A second reachable loopback server received zero browser requests. This proves the tested literal-address HTTP request case, not complete DNS rebinding, redirect, worker, WebSocket, QUIC or private-network coverage.
- Popup interception and actual native download interception/cancellation. No files in owned staging. No automatic execution. A download manager, destination picker, progress/retry/cancel UI and real file upload remain pending.
- A second native process reads the first process's persistent cookie and localStorage. A separately created cookie profile starts empty, receives a different value, and retains that different value in the next process. Native peer profile reports private mode false. No cookies were copied, exported or manually re-injected.
- Three policy tests cover public navigation, credentials/custom/native schemes, private/loopback/special literals and exact probe-origin restriction. Strict all-target Rust check/clippy is required for final source; see the final check log. There are no frontend edits in this batch and no rendered browser chrome claim.

Evidence: session `outputs/browser-p0-native-acceptance.json`, final `browser-p0-acceptance-{report,observations,events}-{first,second}.json`, runtime logs, native build log and `work/browser-p0-acceptance-rust.log`. Exact source/executable digests are in the receipt. No frame screenshots are implied by this API-level validation.

## Failures that changed implementation

1. Wry injects an `ipc` shim even without an application handler. Checking only absent handler/property names was insufficient. Disable native WebView2 web messaging and host objects explicitly. Disabled web messages may be silently dropped rather than throw; measure actual host delivery with a positive control.
2. Initial download navigation aborted before the callback. An engine-owned existing default download staging directory made both Wry and native callbacks fire, with cancellation and no saved files. Relying on the OS default download directory was not reliable in this environment. Native cancellation is installed before network navigation; staging is not permission to save a file.
3. A cookie appeared in the page but disappeared on process restart. Passing Rust's verbatim canonical Windows path to WebView2 did not create persistent cookie storage correctly. Converting only the engine-facing path with the already-cached `dunce` helper made both cookie and localStorage restart checks pass. Filesystem ownership checks still use canonical paths.
4. Wry's default arguments disable SmartScreen for application shells. The browser adapter explicitly supplies arguments preserving SmartScreen. No remote debugging arguments are added.
5. A diagnostic event field conflicted with serde's internal tag during compilation; renamed, no warning suppression. The QA runner now propagates worker failure to its process exit code and retains partial observations on a late failure.

Keep the original runtime/compile failures, not just the green result. An automatic approval timeout delayed one static check by several hours; the permitted retry completed. The wait is not development progress.

## Remaining P0 and next implementation

Integrate a trusted built-in Browser view and Host-owned commands/events with owner-bound tab IDs; preserve the existing Tauri shell and native permission guards. Add address/tab controls and a fixed native preference store. Browser-first must be the default, with a setting to select the existing workspace; explicit notes/tool/file routes override it. Do not put this preference solely in localStorage tied to a random Host port. Use the fixed app data root, separate browser metadata SQLite and native engine profiles. Browser opening must not silently launch an AI session/model request.

Hide every native page control before switching apps, showing blocking dialogs or opening narrow-window overlays; native controls can cover HTML regardless of CSS z-index. Verify actual Chat/Notes/tool/plugin settings and restore/tray behavior in Studio. Add context read grants, document revisions, navigation-race protection and an explicit preview/draft handoff to the existing Pi session, without automatic paid generation. Real model responses/citations, account login, upload, robust private networking, renderer/browser-process recovery and other platforms remain unaccepted. P1–P6 remain in scope.

The earlier note-move attachment issue still has two preserved red regressions. This browser priority did not silently fix, skip or declare that issue complete. Cloud sync and the complete ZiDevTools catalog remain part of the active long-term Studio goal.
