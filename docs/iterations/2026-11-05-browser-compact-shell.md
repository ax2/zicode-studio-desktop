# Windows browser startup, draft handoff and compact shell — 2026-11-05

## User-facing changes

Ordinary Windows startup now consumes the saved preference: Browser is the default and opens a Host-only tools session without Pi. Workspace retains the previous Chat startup. Explicit Explorer/tools/file intents take precedence; browser default is not enabled on unsupported platforms. Browser metadata still lives beneath the fixed application data root. No data migration/reset is introduced.

Read page now offers an explicit Prepare chat draft action. It rechecks the native tab/document revision and the current session, preserves the existing composer text, and adds the reviewed snapshot as untrusted JSON with title, URL, timestamp and version. It never sends the draft or starts a model. A tools-only session receives an actionable instruction to create a Chat conversation first. This proves draft preparation, not model consumption, summary or comparison.

The shared top bar uses named status and lightning shortcut icons with tooltips. Browser tabs share this bar and scroll horizontally; browser navigation/read/startup controls share the next row, wrapping only when needed. The browser activity has a globe icon. Chat-specific header metadata/file controls are hidden outside Chat. Notes edit/preview/save/actions move into the same shell through a React portal; the editor and unsaved draft remain in place. Only the active page owns visible header controls. General plugin spacing is reduced. Existing note storage, autosave and mutation logic are unchanged.

Native Status now reads the actual WebView2 controller IsVisible property. Quick-tools dropdowns join the explicit native-hide conditions: CSS stacking alone is not relied on. Narrow touch controls remain usable, with overflow confined to the tab/control strip rather than the document.

## Verified in actual Windows Studio

Three owned process launches used one synthetic isolated profile, with normal exits and port 9231 closed after each. The initial default Browser route used a tools session and its process tree contained no Pi executable. Saved Workspace preference opened real Chat on the next process; explicit --tools-only still opened Tools after Browser preference was restored. No current installed runtime or user profile was replaced.

At actual client widths 1200 and approximately 421 CSS pixels (DPI rounding), browser tabs and note controls fit inside the top bar, with no document horizontal overflow. The final note header measured about 40.6/48 pixels high. Quick-tools dropdown and content preview caused actual native controllers to report invisible; close restored the browser, and switching out of Browser kept native pages hidden. Chrome screenshots show shell/notes, not the separately composed native webpage pixels.

A synthetic note retained the same textarea node during input, saved the exact text through the real Host, switched between Edit/Preview using the relocated controls and retained exact content across process restart. Existing QA/browser tabs were preserved, including an externally changed tab; no existing tab was navigated for model/draft testing. One new owned example tab was created for the capture handoff.

The prior capture build also passed real HTTPS title/native URL/body capture, stale expected URL rejection, reload revision changes and local plain-text preview. The new build put that reviewed snapshot into the real current Chat composer, preserving an existing unsent question. Send was not clicked and no paid model was called.

## Checks and evidence

- Six browser draft race/source/target tests; seven compact header/portal/shortcut tests; three focused existing note editor/autosave regressions; one Rust startup regression passed.
- Frontend checks, frontend typecheck, Rust all-target check/strict clippy, local debug build and generated frontend/CSS passed. Final i18n: 3780 keys, zero missing. Existing Biome warnings, one prior terminal style warning and repo-wide formatting advisory remain; this is not a whole-suite pass. Previously known note-move failures remain outside this UI change.
- Session evidence: outputs/browser-capture-native.json, browser-layout-{browser,workspace,tools}-native.json, compact-header-final-native.json, compact-browser-acceptance.json. Exact EXE/source/asset hashes and profile are in the latter receipt.
- Final rendered screenshots: outputs/compact-header-final-notes-{1200,420}.png and compact-header-final-browser-{1200,420}.png. Native screenshots omit the separate child WebView pixels; do not label the blank screenshot region a website rendering failure or a webpage screenshot pass.
- Build/check logs: work/compact-header-{tests,types,rust,build}.log, compact-header-note-regressions.log, compact-header-final-{check,i18n}.log. Earlier capture/initial startup logs retained.

## Preserved failures and limits

The first capture harness wrongly expected the page title in its body; actual capture was correct. Resize via Tauri was correctly denied by the app permission set; the QA runner then used identity-checked owned-window Win32 resizing without adding app permissions. Legacy PowerShell lacked a helper module; the runner used the installed runtime. Its first DPI-unaware resize produced actual widths 2101/736, so these were recorded and not claimed as 1200/420 acceptance. DPI-aware resizing and exact client-size assertions corrected this. A subsequent notebook harness used aria-expanded on a native details summary and accidentally collapsed it; it now checks details.open. These harness failures remain recorded.

Complete P0 is still open: integrated native selected text, renderer/owner re-entrant teardown, full focus/tray/occlusion/DPI acceptance, actual login/upload/download and DNS/worker/WebSocket private-network boundaries remain. P1–P6, AI model summaries/comparisons and browser extensions are not delivered by this milestone. Prompt source labeling is not a complete prompt-injection guarantee. Browser screenshots above prove chrome layout, not native page pixels. No schedules, user-process termination, external messages, releases, credentials or production data were involved.

The tiny imports/registration/startup hooks in existing large composition roots and the two-line Notes toolbar wrapper are intentional exceptions; feature logic lives in dedicated modules. Source changes preserve previous dirty work. No version bump, commit, push or repeated full native build after CSS-only refinements.
