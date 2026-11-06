# Windows browser page zoom and tab mute — 2026-11-05

The browser options menu provides zoom out, a percentage button that resets to 100%, zoom in and per-tab mute. Standard zoom steps span 25–500%. A muted tab also has a compact unmute icon beside its close button. Controls share the existing overflow menu and do not add a permanent toolbar row.

The owner-bound browser control command reads/writes WebView2 controller ZoomFactor and ICoreWebView2_8 IsMuted/SetIsMuted, without injecting page scripts or changing system volume. Native settings are read when the menu opens. Explicit changes are saved through the revision-checked session store; a persistence failure attempts to restore the previous native value and reports rollback failure separately. New native views apply saved settings before navigation. Store schema 5 adds default zoom=1 and muted=false to old JSON tab records, including the recent-closed queue; it does not clear existing data.

## Actual Windows acceptance

The newly built debug Studio ran twice with the same isolated profile. An additional owned public example.org tab was zoomed through 110%, 125%, 150%, then muted through the real menu. Native getters and persisted metadata matched; page document revision did not change. The existing peer tab stayed 100% and unmuted. Closing/reopening the owned tab retained both settings. After normal process exit and relaunch, the exact seven-tab snapshot and native 150%/muted state returned. Resetting through the percentage button and unmuting through the tab icon returned native and saved settings to 100%/false. Only the owned added tab was closed afterward. All six original tabs and bookmark data remained exact, and both old and new synthetic note title/content survived the restart.

The initial restore harness checked the rendered percentage before the fieldset's async native read had finished. Native/state assertions had already passed. The harness now waits on the fieldset's actual disabled property; the first failure is preserved. Final second-process checks passed without weakening the native/persisted assertions.

Native mute output flags were verified; audible media playback was not tested. Native keyboard/wheel-only zoom changes are not yet observed and persisted automatically. Native webpage global shortcuts, fullscreen, downloads, page find, full focus handling and remaining P0–P6 work stay open. Screenshots show trusted chrome, not pixels of the separate native webpage. The daily installed app and user profile were not replaced.

## Checks and evidence

34 frontend tests in nine files, 16 browser-store tests, strict Rust checks/clippy, frontend/design, TypeScript and 71 command permission checks passed. Translation audit: 3,836 keys, none missing. Existing formatting advisories/repository warnings remain. A build:local debug executable was produced in the reused target. Five Notes recovery/editor regressions also passed for the concurrent requested Notes changes.

Session evidence: outputs/browser-page-controls-{create,restore}-native.json, fixture.json, menu.png, {create,restore}-launch.json, {first,final}-closure.json, restore-first-failure.json; shared hash receipt browser-page-controls-notes-acceptance.json. Logs: work/browser-page-controls-{rust,store-tests,ui-tests,ui-check,i18n,notes-build}.log. Required before/after storage scans retain referenced QA profiles and reusable target output.

No new top-level native command, schedule, subagent, paid model request, production write, user-process termination or publishing. An unrelated Edge instance owned 9231, so both owned instances used 9233 and exited normally.
