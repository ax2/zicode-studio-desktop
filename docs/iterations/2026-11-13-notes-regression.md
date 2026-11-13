# Notes regression and notification overlap — 2026-11-13

Tracks [Issue #22](https://github.com/ax2/zicode-studio-desktop/issues/22), still open for the remaining acceptance scope. No personal profile, credentials, notebooks or installed application were modified.

## Fix

A notification overlaid the shared header at 422 CSS pixels: its top was 8px while the header ended at 36px. A real save-button click was intercepted until the notification disappeared; autosave then disabled the button. This is a current reproducible fault, separate from historical move-test failures.

Notifications now start below the header, using `control-height-lg + space-2` (48px). The narrow-window rule preserves safe-area handling and uses the same header clearance. The width, dismiss action and notification content remain unchanged. The patch is in `notification-center.css`, `mobile.css` and the generated CSS bundle.

## Evidence and its limits

- Current main-source Notes suite: 181 tests / 7 files passed. Final `bun run check` passed with existing warnings. No Rust changes or native rebuild in this task.
- Actual Windows WebView2, retained v0.5.9 release SHA256 `FB6F253632F63C62E5C3706BE82EE77255A6FC559CF48A2B3A5C46A2AF1656DE`, a new synthetic isolated profile, and real Host storage.
- At 1200 and 422 CSS pixels, ASCII key input plus Chinese text insertion retained the exact textarea node and stable x/y/width/height. This is not an IME composition claim. The narrow sample list includes duplicate listener samples, so its 102 entries are not 102 independent keystrokes.
- Notebook/note hover actions reduced title width without changing row height; pointer leave restored it. Timestamps computed to 12px, and last-edited stayed below the editor.
- New notebooks started collapsed. Actual notebook drag reordered them. Reordered books and explicit expanded/collapsed state survived normal process exit and restart.
- Actual management-menu move preserved exact body (including whitespace and an outgoing note link), tags, note ID and the original PNG/text attachment bytes. An intentionally stale version was rejected with the original note and attachment bytes intact. Pin button responded before the move.
- A second process read the exact saved note, attachment bytes and unchanged outgoing-link target. This does not establish old incoming links, pinned shortcuts after a move, delete/trash UI or all late-failure rollback branches.
- For the notification fix, the **complete generated worktree CSS bundle** was applied to the actual retained native UI through CDP. The persistent notification moved from 8px to 48px; a real pointer click reached Save while it remained visible, produced a successful Host save and exact content readback. Its dismiss button also worked. This proves the rendered source-style change, **not a rebuilt or installed application**. The immutable release candidate was not changed.
- Both owned Studio processes exited normally after identity checks. Daily Studio and fixed personal data were not touched. No schedules, paid models or external uploads.

## Preserved evidence

Session `outputs/`: `notes-regression-create-native.json` and `create-failure.png` retain the original save interception; `notes-regression-continue-attempt1.json` retains a hidden-window harness failure. `notes-regression-continue-native.json`, `restore-native.json`, `fixture.json`, both exit receipts, and typing/restore screenshots hold the passing subset. `notes-notification-single-style-only.json` is only an isolated-stylesheet experiment, not full cascade acceptance. The complete-bundle attempt initially selected a hidden narrow-window sidebar row; the harness was corrected to select in a wide window before resizing. `notes-notification-native.json` plus `before.png`/`after.png` are the final complete-bundle result.

Remaining before Issue #22 can close: complete delete/trash and incoming/pinned-reference checks, cover applicable move rollback paths, and repeat the final release candidate's persistence check. Final release also requires Issue #31's upgrade/data-retention acceptance. Do not infer full completion from this subset.

## Follow-up: normally loaded current Windows development runtime

The other authorized development chat completed the shared debug build. SHA256 `6191D80B2DC40D4113D36FE99FDF07A83F88E7374F1BD28031CFFC46DFBDE91B` was run with the same explicit isolated synthetic profile. Its version API reports 0.5.3, the unchanged main-checkout development version; it is identified by SHA, not claimed as a released upgrade.

The served complete CSS bundle matched current main-source bytes. Without style injection, the notification started at 48px beneath the 36px header; a real click saved exact content while the notification remained visible, and dismissal worked. Normal exit/restart retained exact note body, original attachment bytes, linked target, notebook order and expansion state. `notes-notification-current-native.json`, `notes-regression-current-restore-native.json`, screenshots and `notes-current*-exit.json` record this. The initial harness omitted entering Notes from the default Browser, then a restore harness incorrectly expected the retained release's version; both setup failures were preserved and corrected without bypassing content assertions. All owned debug processes exited normally. This adds actual current-program verification; it is still not a new installer or daily-profile deployment.
