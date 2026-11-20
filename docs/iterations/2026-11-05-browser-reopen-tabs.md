# Durable recently closed tabs — 2026-11-05

## User behavior

Browser options now includes **Reopen closed tab**, with Chinese and English labels. It restores the most recent closed tab at its former position, selects it and recreates its native page. The entry is disabled when there is nothing to restore. The last 50 closed tabs survive application restart. Only URL, title, stable tab identity and former position are retained; this does not restore a page's unsaved forms, scroll position or back/forward stack. A restored page loads again under the existing browser policy.

The menu keeps the shared top bar compact. A native-webpage-wide Ctrl+Shift+T shortcut is not claimed by this increment.

## Persistence and failure handling

Browser metadata format advances from 1 to 2. Old session JSON defaults to an empty recently-closed list; existing tabs, preference, profile identity and revision remain. New closed-tab records and the live session are computed and committed together under the existing optimistic revision check and SQLite transaction. Reintroducing a closed identity consumes its recovery record in that transaction. History is per window owner, with the newest 50 retained. Metadata size and URL/identity validation remain enforced. Older binaries reject format 2 instead of silently rewriting it; no rollback-format migration is added.

Frontend title/load saves now use the action queue so delayed writes do not resurrect a closed snapshot. A failed write no longer poisons future saves. Close flushes current metadata, then persists removal before changing the displayed tab list; a failed removal recreates the selected native view. Reopen prepares a hidden candidate, persists recovery, then selects it; if persistence fails, its candidate is closed and the recovery record remains available. Successful retries clear the stale error message.

The first actual native attempt exposed a surface-update ordering failure: a new-tab action stopped on `Stale browser surface request`. The failed receipt and actual Host/native state are retained. Surface commands now serialize delivery and assign revisions when dispatched; tab changes suppress observer-driven presentation until their transition completes. One regression verifies pending native commands cannot overtake each other and that a failed command does not block later updates. The corrected same-process UI reload then passed the original flow, followed by a full process restart. This was an application fix, not a timeout accepted as success.

## Checks and acceptance

Eight focused frontend tests passed: original position, disabled empty history, failed-save retry/candidate cleanup, failed close recovery, empty-window recovery, existing menu/reload-stop behavior and serialized surface delivery. Eight SQLite tests passed, including migration from format 1, competing-connection conflicts, restart durability, atomic consumption, owner isolation and the 50-record bound. Frontend checks, 3784-key Chinese coverage (zero missing), Rust all-target check and strict clippy passed. Existing formatting/style advisories remain; unrelated whole-repository tests were not rerun.

Actual rebuilt Windows acceptance passed: two owned test tabs were created, the first was closed from index 6 with a peer after it, Studio exited normally and the same isolated profile was reopened. The menu restored the closed tab to index 6, selected it, consumed its archive record once and loaded actual Example Domain content with a new document revision. The six baseline tabs remained exact; only the two newly created test tabs were closed afterward, leaving their synthetic recovery records in the isolated profile. The prior saved note was read through the real Host and matched its saved content exactly.

Menu screenshots at actual 1200/421 CSS-pixel widths were visually inspected; no horizontal overflow or relevant console/page errors occurred. Existing secondary-button styling now distinguishes enabled actions from disabled items. Screenshot evidence shows Studio chrome, not the separately composed native page pixels. The final UI refinements were served from the repo's public directory by the reusable debug runtime; no redundant native rebuild followed JS-only changes.

Evidence: `outputs/browser-reopen-close-native.json`, `browser-reopen-restore-native.json`, `browser-reopen-notes.json`, `browser-reopen-final-menu.json`, `browser-reopen-final-menu-{1200,420}.png`. Preserved first failure: `browser-reopen-first-native-failure.json` and `browser-reopen-state-diagnostic.json`. Logs: `work/browser-reopen-{rust,store-tests,build}.log`, `browser-reopen-surface-tests.log`, `browser-reopen-final-check.log`, `browser-reopen-i18n.log`.

Browser plugin not available; regular Playwright attached only to the owned isolated Studio's loopback debug endpoint. No new browser installation, user account, model, production service or scheduled task was used.

Installed daily runtime/user data remain untouched. Full browser P0–P6, history/bookmarks, native keyboard shortcuts and other outstanding product requirements remain open.
