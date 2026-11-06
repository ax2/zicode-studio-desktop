# Browser integration requirements and acceptance ledger

The user's two-part 2026-11-04 browser task book is the baseline. This ledger preserves the whole requested product. A stage is not complete because one component or a native probe passes. No entry below is accepted yet unless linked to actual runtime evidence. No schedules or project/scene UI are restored.

| Stage | Required behavior | Evidence required / current state |
|---|---|---|
| Global | Browser-first default, configurable workspace entry; explicit deep links honored | [Actual Windows startup accepted](../iterations/2026-11-05-browser-compact-shell.md): Browser default without Pi, saved Workspace restart and explicit Tools precedence. Other deep-link regressions remain separate. [Page-search acceptance](../iterations/2026-11-05-browser-find.md) observed one unexplained initial Notes route despite a Browser URL; the next fresh launch opened Browser correctly. A later natural launch and three reloads did not reproduce it (outputs/browser-startup-trace.json); this is still unresolved, not a claimed fix. |
| Global | Fixed browser storage, no notes/data loss, no data path tied to app versions | Fixed-root browser storage and exact synthetic note/tab persistence passed across isolated process restarts and rebuilds ([evidence](../iterations/2026-11-05-browser-selection-resize.md)); [Daily Windows upgrade/data preservation verified](../iterations/2026-11-06-browser-blank.md): 81 audited data files, original browser session and 43 plugin entries retained. Backup restoration remains pending. |
| P0 | Recheck current local and main versions, framework/runtime, Host, router, plugins, permissions, packaging/platforms | Source review complete for initial local/main a974f661188611c7a37f64b0b096bada96896c75; extensive local work preserved; native report records scope |
| P0 | Compare Tauri/WebView2, CEF, Electron, external connection; ADR + technical report + runnable prototype | ADR 0007 remains proposed. Native probe and [actual Studio prototype](../iterations/2026-11-05-browser-studio-native.md) run; long-term route/platform acceptance remains open. |
| P0 | Browser opens inside Studio, HTTPS access, 3+ concurrent tabs, switch/create/destroy | Native probe: 3 controls and HTTPS passed. [Actual Studio](../iterations/2026-11-05-browser-studio-native.md) navigation/switching and [three close/resize cycles](../iterations/2026-11-05-browser-selection-resize.md) passed. This does not establish complete P0. |
| P0 | Address input, back/forward/reload/stop, window size and focus | Native API history/reload/stop and actual address UI passed. [Rebuilt Studio widths 1200/421 at 175% DPI](../iterations/2026-11-05-browser-selection-resize.md) passed, including after tab close. [Native-page Control+F/L and search-dismissal focus restoration](../iterations/2026-11-06-browser-focus.md) passed with actual Windows HWND checks and scoped native key messages in two processes. Full focus/tray/multi-DPI coverage remains pending. |
| P0 | No webpage IPC, native files/credentials/Pi access; tab identity cannot be forged | Native messaging/host objects disabled before navigation; real positive/negative delivery control passed; 0 forbidden literal-loopback requests. Complete frame/worker/DNS/WebSocket/private-network acceptance pending |
| P0 | Cookie/login durability, popup handling, download interception, file upload | Cookie/localStorage across 2 real processes and 2 independent profiles passed; initial popup/download denial recorded 0 saved files. [Ordinary user-requested public links now open independent native tabs](../iterations/2026-11-06-browser-popups.md); automatic/hidden/modal popup requests remain denied. Full opener/login-popup compatibility, real login/upload and complete download workflows remain pending |
| P0 | Native title/URL/selection/body -> current Pi session without stale tab context; existing Chat/plugins survive | [Actual native title/URL/body and unsent current Chat draft](../iterations/2026-11-05-browser-compact-shell.md) passed; [explicit Select All selection](../iterations/2026-11-05-browser-selection-resize.md) passed. Manual partial selection and actual Pi model consumption remain pending. |
| P1 | Tabs: create/close, drag reorder, mute, zoom, fullscreen, loading/error state, context menu, open link in tab | [Actual pointer/keyboard reordering, edge scrolling and restart persistence](../iterations/2026-11-05-browser-tab-order.md) accepted without active-page recreation. [Native zoom and per-tab mute settings, closed-tab and process-restart persistence](../iterations/2026-11-05-browser-page-controls.md) accepted. Audible playback and keyboard/wheel-only zoom persistence remain unverified. [User-requested public links in independent native tabs and restart persistence](../iterations/2026-11-06-browser-popups.md) passed and are installed. [Actual native context-menu construction, retained page background for menus, command palette and relocated shared controls](../iterations/2026-11-06-browser-overlays.md) are installed. Fullscreen, complete context-menu selection coverage, full shortcuts, background dispositions and opener/login-popup compatibility remain pending. |
| P1 | Downloads manager, upload picker, page find | [Actual native page find](../iterations/2026-11-05-browser-find.md) accepted through menu/trusted-chrome Ctrl+F: counters, previous/next, case, close/switch and narrow layout. [Native-page shortcut forwarding and Escape/close focus restoration](../iterations/2026-11-06-browser-focus.md) passed in two real processes at wide/narrow widths. PDF/complex frames remain open. Download save/progress/cancel/failure + no automatic execution and upload picker remain pending. |
| P1 | History, bookmarks/folders, closed-tab reopen, session/startup restore, multiwindow | [Last 50 closed tabs reopen across actual process restart](../iterations/2026-11-05-browser-reopen-tabs.md), preserving position and baseline tabs/notes. Session/startup restore accepted above. [Bookmarks and nested folders across actual process restart](../iterations/2026-11-05-browser-bookmarks.md) accepted for local create/edit/move/delete/open, with original tabs and synthetic note retained. [Native successful-navigation history](../iterations/2026-11-05-browser-history.md) accepted for search/open/remove/confirmed clear and restart; late visits survive clearing. Multiwindow, same-document SPA history and bookmark import/export/sync remain pending. |
| P2 | Read active tab title/native URL/body/selection, links/tables/images/metadata | Bounded title/native URL/body/explicit whole-page selection with identity/source/time/version checks passed in [actual Studio](../iterations/2026-11-05-browser-selection-resize.md). Links/tables/images/expanded metadata remain pending. |
| P2 | Collapsible AI sidebar, summary/explain/search/analyze/translate/questions | Existing Pi flow, explicit sharing and current-tab checks; pending |
| P2 | Compare 2+ pages with source citations, distinguish all tab contexts, resist prompt injection | Real Pi acceptance with same sources; do not call paid model automatically; pending |
| P2 | Send context to current session; clip to Notes; save analysis to Artifacts/knowledge | Real persisted records and exact source references, no stale response after navigation; pending |
| P3 | Tab groups, vertical/pinned tabs, browser workspaces and independent profiles | Workspace/profile distinction and isolation tests; pending |
| P3 | Private mode, site cookies/data/permission management, history/bookmark management | Native storage lifecycle and per-site grants; pending |
| P3 | Proxy, UA, site shortcuts, PDF, printing, screenshots, reading, translation | Capability-specific native acceptance; pending |
| P3 | Devtools, network requests, console logs | Separate explicit user controls, no user-profile remote debug listener; pending |
| P4 | DOM/interactive elements, click/type/scroll/tab/open/search/forms/multistep/verification/recovery/visual understanding | Real authorized multistep task; Playwright+embedded engine feasibility first; pending |
| P4 | Separate read/navigation/interaction/credential/submission permission and audit | Ordinary authorized navigation/search allowed; login additional grant; message/order/pay/delete/account changes each need explicit confirmation; pending |
| P5 | Default workspace knowledge/bookmarks/session associations, future extra project support without project UI | Stable IDs, no accidental cross-profile cookie sharing; pending |
| P5 | Notes clips, AI sources, Artifacts, task invocation/history/audit, workspace import/export | Actual stored outputs and round-trip restore; no schedule creation; pending |
| P6 | Evaluate Chrome/Edge extensions/store/custom SDK/MCP/skills/third-party tools | No compatibility promise until engine/security prototype passes; pending evaluation |
| P6 | Custom search, password manager, cross-device config sync, browser backup/restore/profile import/export | Credential protection, per-profile recovery, no native privileges for extensions; pending |
| Quality | Theme/Chinese+English/keyboard/narrow window/accessibility, retain ActivityBar/router/sidebars | [Actual compact shell/Notes](../iterations/2026-11-05-browser-compact-shell.md) and [narrow navigation/preview](../iterations/2026-11-05-browser-selection-resize.md) accepted for documented widths. Complete theme/keyboard/accessibility and all-page coverage remain open. |
| Quality | First/new tab/navigation latency, memory/CPU/background cost/reclamation, large pages/video/scroll/Pi concurrency/start-stop | Real website native measurements; no simulated performance claim; pending |
| Quality | Suspend inactive views, destroy closed views, crash isolation/recovery, UI/Host responsiveness | Native process/renderer failure and recovery; pending |
| Delivery | Each stage: docs, tests, Rust/TS/project checks, actual Windows runtime/evidence, list omissions | Same reusable Cargo target, no version bump/duplicate runtimes; pending |

The prior note-move regression remains unfinished (two red tests, preserved); browser integration is now the user's priority. The long-term Studio goal also retains cloud sync, all-tool integration and earlier product gaps; browser work does not declare them complete.

## Native feasibility evidence — 2026-11-05

See [report](../iterations/2026-11-05-browser-native-feasibility.md) and ADR 0007. Final Windows debug runner SHA-256: `48c275a400286f2510b8187809cf007688bb495d7532db5c6fad47c6696640b5`. Three policy tests passed; final all-target Rust check/clippy passed with existing repo-wide formatting advisory. This batch has no frontend edits, no production browser commands, no current Studio/data changes and no Pi/model calls. Two existing note-move regressions remain red; static checks are not a full-suite pass. Session `outputs/browser-p0-native-acceptance.json` records precise reports, source hashes and boundaries. No stage is marked complete by these primitive checks.

## Metadata implementation — 2026-11-05

[Browser metadata report](../iterations/2026-11-05-browser-metadata.md): three guarded native commands now persist startup preference/profile UUID and ordered tab snapshots in a separate fixed-root SQLite database. Five actual SQLite regressions, all 67 command permissions and strict Rust checks passed. Startup UI/router and native tab service do not consume it yet; actual Studio restart, backup, Pi handoff and complete P0 remain pending. The previous primitive-only batch description remains historical, not the current count of registered browser commands.

## Native Host wiring — 2026-11-05

[Host wiring report](../iterations/2026-11-05-browser-host-wiring.md): owner-bound native control command, hidden creation, window-targeted events and destruction hook now registered; viewport and stale surface-request protection added. Strict Rust, 68-command permissions and one ordering regression passed. Newly wired native runtime, trusted chrome reload reconciliation, re-entrant teardown, Browser UI/default route and Pi handoff remain unverified or unimplemented. P0 remains incomplete.

## Browser interface implementation — 2026-11-05

[Interface report](../iterations/2026-11-05-browser-interface.md): real trusted browser UI and built-in entry now wired to native control/state commands; 2-width rendered chrome QA with a mocked native boundary passed, 40 shell regressions and real registry acceptance passed. Actual integrated Studio/embedded webpage acceptance, browser-first startup routing and Pi handoff remain outstanding. Persisted startup selection alone is not completion of configurable default startup.

## Actual Studio runtime evidence — 2026-11-05

[Windows runtime report](../iterations/2026-11-05-browser-studio-native.md): actual built-in browser UI/Host/native control navigation to two public HTTPS examples, native reload success/file URL rejection, Browser–Notes–Browser routing, two-process exact metadata restoration and lazy active-page recreation passed in an isolated Studio. Native pixel visibility/overlay behavior and integrated body/selection capture remain unverified; default browser startup and Pi handoff remain unimplemented. Both QA instances exited normally; user profile untouched. P0 remains incomplete.

## Content capture implementation — 2026-11-05

[Bounded capture report](../iterations/2026-11-05-browser-capture.md): owner-bound native content read and local preview now implemented with document/native URL/surface revision checks. Actual extraction-script DOM cases, rendered preview with mocked native boundary, response validation, permission and frontend checks passed. Final strict/build and integrated native capture are pending as recorded in the continuation handle. Pi sharing/default startup/P0 completion remain pending.


## Current accepted increment — compact shell, startup and draft (2026-11-05)

[Windows evidence and limits](../iterations/2026-11-05-browser-compact-shell.md) supersede earlier pending implementation checkpoints for these exact subscopes: ordinary Windows Browser default without Pi, Workspace preference restart, explicit Tools precedence; real owner-checked title/native URL/body and revision capture; reviewed snapshot into the current real Chat composer without Send; shared compact top bar at actual 1200/421 client widths; actual controller hiding for quick tools/content preview and application switches; synthetic note editing/save/process-restart persistence. Final screenshots show chrome/notes, not separate child-WebView pixels. Current installed/user profile untouched. Full P0 and P1–P6 remain open, including native selection, real model reading/comparison, full isolation and lifecycle boundaries.

## Selection and native resize follow-up — 2026-11-05

[Accepted follow-up and preserved failures](../iterations/2026-11-05-browser-selection-resize.md): explicit native Select All followed by bounded selection capture/preview, compact navigation and centered preview; per-page native containers prevent tab destruction from removing Studio's resize handler. Actual rebuilt Studio passed three tab create/close cycles with 1200/421 width transitions, preserving all six baseline tabs. Existing synthetic note content remained exact after rebuild/restart. Re-entrant registry retirement is unit-tested; full COM teardown/focus/tray and complete P0 remain open. No installed runtime or user profile was replaced.

## Window recovery and retired events — 2026-11-05

[Actual recovery evidence](../iterations/2026-11-05-browser-window-recovery.md): callbacks are retired before native page destruction, with two deterministic regressions. The rebuilt Studio passed three tab-create/close/resize cycles and two close-to-tray plus one minimize/reopen cycle. Recovery kept the same native window, document revision, six tabs and unsent address text; address typing worked afterward. Recovery used same-profile secondary launch through the tray's shared restore function, not physical tray-menu interaction. Full native website focus, renderer recovery and P0 remain open.


## Browsing history — 2026-11-05

[Actual Windows report](../iterations/2026-11-05-browser-history.md): native successful top-level visits are persisted by a bounded ordered worker; history has search, paging, reopen, single removal and explicit cutoff-based clearing. Two real processes preserved visits; a real navigation during clear confirmation survived deletion. Existing tabs, bookmarks and synthetic note remained exact. Schema 3→4 preserved preference/bookmark hashes. Initial SQL escaping and hidden-button failures were corrected with original evidence retained. Normal exit checkpoint and actual shutdown passed; abrupt termination/floods, same-document SPA history and full P0–P6 remain open.


## Native keyboard and search focus — 2026-11-06

[Actual Windows acceptance](../iterations/2026-11-06-browser-focus.md): fixed Control+F/L native callbacks hand off to trusted chrome with tab/modal checks; manual search dismissal restores webpage focus without late-close focus stealing. Native messages, distinct Windows focus HWNDs, real search counts, full URL selection, hidden-tab denial, two widths and process restart passed. Seven baseline tabs, closed queue, bookmarks and two synthetic notes remain exact. No physical keyboard/global-input claim, user-profile overwrite or installed-version rollout. Complete P0–P6 and broader Studio work remain open.


## User-reported blank page and daily correction — 2026-11-06

[Correction, actual checks and limits](../iterations/2026-11-06-browser-blank.md): an actual native screenshot reproduced a blank daily page despite successful native visibility/content checks. Read-only window enumeration found chrome covering the webpage. The rebuilt fix presents the native page above chrome without focus activation, and retries bounded stale geometry failures without weakening Host validation. Real Studio page/modal/Notes transitions passed; candidate and installed window trees confirm corrected stacking and nonzero visible child bounds. The fixed EXE is now installed with the original data profile, notes, plugin states and browser tab preserved. **Post-fix pixels were not screenshot-verified because the user stopped Computer Use.** Prior content/visibility acceptance does not prove pixels, and full P0–P6 remains unfinished.


## Installed interface isolation — 2026-11-06

[Actual development, installed QA and daily startup evidence](../iterations/2026-11-06-runtime-assets.md): relocated local debug builds now use their own installed frontend files, while development from the Cargo output directory retains live source assets. A different marker in each location proved actual Host separation; installed Browser/Notes interactions and exact retained data passed. Future local updates must deliver the matching EXE and built public directory together. Native webpage pixel verification and isolation of other debug runtime dependencies remain separate. No P0–P6 stage is declared complete by this delivery increment.


## Public links in native tabs — 2026-11-06

[Actual two-process acceptance and daily paired EXE/frontend deployment](../iterations/2026-11-06-browser-popups.md): real webpage clicks open a selected independent tab after the source; original content stays intact. Automatic, private-loopback, hidden and modal-covered requests are denied. Restart, original tabs/notes and all audited daily data passed. Native pixel verification and complex opener/login-popup compatibility remain unaccepted. No P0-P6 stage is completed by this increment.


## User correction: menu background, Commands and shared actions — 2026-11-06

[Installed Windows correction and scope](../iterations/2026-11-06-browser-overlays.md): options/bookmarks/quick-tools/Commands now retain the actual native page image while their chrome overlay is open, then restore the same live page. Commands is included in native-surface obstruction checks. Wide/narrow app composition screenshots prove retained page pixels; full desktop capture remains unperformed. Quick tools/status moved above desktop Commands and adapt to the existing narrow bottom dock. Real context-menu construction includes ten browser actions; full native item-selection and link-specific selection acceptance remain open. Seven QA tabs, two synthetic notes and all audited daily files/plugin states survive restart/deployment. Downloads remain denied; their drafts are not part of this installed increment.

## Release preparation — v0.5.4

The previously retained note-move regression is corrected in the release branch: attachments are staged without overwriting a destination, the original note remains intact until publication succeeds, and stale versions/attachment collisions are rejected. Historical failure reports remain unchanged. Downloads under development are excluded from this release; the accepted overlay/menu/browser boundary remains the release baseline. Full browser P0–P6 and cloud-sync delivery are still open.
