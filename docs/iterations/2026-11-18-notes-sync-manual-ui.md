# Explicit notes sync controls — frontend receipt

Issue: #23; integration target: `integration/v0.6.6`. Base: `65d816e34dac667494be49e8b5f178d87b726f5a`.

## Delivered scope

- Cloud sync settings show the task controls only when the Host advertises `syncAvailable`. This flag means the service is connected, not that credentials are ready. Missing credentials or edited settings disable Start, while an already running task can still be inspected/cancelled.
- Starting requires review of the **saved** WebDAV address, username and library ID, followed by a separate confirmation. The request contains only workspace/scene identity, the saved revision and `confirmed: true`. It contains no password, recovery code, endpoint override or unsaved form values.
- Cancel identifies the current run. Leaving settings does not send Cancel; actual Host exit stops work. Restart does not implicitly start or retry sync.
- One status request at a time is polled every 750 ms only while running. Read failures stop automatic polling and offer manual refresh. Request generations prevent delayed polls from overwriting cancellation or a new scope.
- English and Chinese distinguish actual authentication, network, rate limiting, configuration changes, local edits, conflicts, interrupted work and other defensive stop results. Last results are labelled as such; failures never claim sync succeeded. Conflicts are retained; no conflict-resolution UI is claimed.
- Existing configuration save/recovery-code operations remain local and do not start sync. Drafts and Studio credentials are not submitted by these controls.

## Automated evidence

On Windows, using the shared installed Bun/dependencies, without Cargo, an application build, a visible desktop window, a real cloud account or user data:

- `NotesSyncRunControl.test.tsx`: **22/22**. Covers separate review/confirmation; exact scope/revision/run identity; cancellation after settings readiness changes; single-flight polling; delayed-poll/cancel race; stopped polling and manual recovery after read failure; saved revision/destination/scene/workspace changes; disappearance of the workspace; localized terminal states and counts; malformed results; real `NotesSyncTab` wiring; and the shared request/response fixture.
- Existing `NotesSyncTab.test.tsx`: **8/8**; settings tests: **17/17**; generated settings integration exercised by app-updater tests: **2/2**. Combined: **49/49**, retries disabled.
- Full frontend TypeScript check: passed. `bun run check`: passed with existing unrelated warnings. Design check and Pi SDK alignment passed. Translation coverage: **0 missing keys**.
- Only `public/native/react/settings.js` was regenerated using the production esbuild options. SHA-256: `D1A2B4B7084886695FAA77AB43AC9314781D2BB88ED707104F1CEE62396CE350`.
- The first test run was 44/45: its scene-change assertion expected an error to remain visible, but the component correctly refreshed the new scope. The corrected assertion verifies the refreshed scope and that no Start occurred. Later checks passed; the failure is not represented as a product fix.

`tests/fixtures/notes-sync-task/contract.json` is shared with the backend owner. The frontend renders controls, emits the three exact requests and parses the exact response fields. Backend tests independently deserialize those requests, reject unexpected request fields and serialize matching responses. This proves the UI/production Rust wire contract, not an actual Tauri-window invocation.

## Boundary and combined acceptance

The UI tests use an injected invoke transport. They do not prove a real WebDAV transfer or a native Tauri window. The backend receipt separately owns production task launch, synthetic Host note creation/readback, local WebDAV, cancellation, restart and data protection. Main-session integration must use both matching revisions/contract evidence; no extra simulated Tauri bridge, real account or routine post-release desktop activity is required by this increment.

Detailed local receipts are retained in the task workspace as `outputs/ns23ui-tests.log`, `outputs/ns23ui-check.log` and `outputs/ns23ui-project.log`. The backend owns the main cloud sync user guide to avoid parallel edits.
