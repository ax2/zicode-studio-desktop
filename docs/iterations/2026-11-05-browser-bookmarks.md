# Windows bookmarks and folders — 2026-11-05

The compact browser toolbar now has an icon-only bookmark action. The overflow menu opens bookmark management. Both reuse a modal which hides the actual native webpage, retaining the shared top bar and scrollable tabs. Bookmark names are plain text, not markup or translation keys.

## Delivered scope

Save the current native page URL; create, edit, search, open and delete bookmarks; create nested folders, rename and move them; move bookmarks between folders. Removing a folder explicitly moves its children and bookmarks to its parent rather than deleting them. The editor excludes the folder itself and its descendants as possible parents. Failed saves retain the editor contents. Explicit reload handles a stale-library conflict.

The existing fixed-root browser SQLite store upgrades metadata format 2 to 3 by adding an owner-bound bookmark library. Sessions, recently closed tabs and the native cookie profile are retained. A save validates the full snapshot and commits under an immediate transaction and expected revision. Stale updates, cycles, missing folders, invalid IDs and unsafe URLs are rejected without overwriting the stored library. Bounds: 1,000 folders, 4 MiB serialized library, folder titles 256 bytes, bookmark titles 4,096 bytes, URLs 16,384 bytes. Only HTTP(S) URLs with a host and without embedded credentials are accepted. This is local storage, not bookmark cloud sync or import/export.

## Actual Windows acceptance

Two newly built Studio processes used the same existing isolated QA profile. The first created a bookmark and two nested folders, moved the bookmark, renamed the root, and verified unavailable self/descendant parent choices. At actual client widths 1200 and approximately 421 CSS pixels, the modal stayed within the viewport without document overflow; native controllers were hidden beneath it. Both screenshots were captured; the narrow screenshot was visually reviewed.

After normal process exit and restart, the complete bookmark library including revision matched exactly. Opening the nested bookmark created a real native HTTPS tab; the product capture command returned Example Domain title, URL and page text. Removing the root retained and reparented the child folder and retained its bookmark. Moving the bookmark to the root, deleting the now-unused child, then removing only the synthetic bookmark restored the original library contents. The six pre-existing live tabs remained exact, and the existing synthetic note content was read through the real Notes Host and matched exactly. The temporary opened page contributed one synthetic recently-closed record; it did not replace the baseline records.

Both owned instances exited normally; the debug listener was closed. No user-owned process, installed daily runtime or actual user data library was replaced. No paid model, external write, schedules or computer-use input was used. Scoped Playwright CDP and identity-checked Win32 resizing verified the owned application; these tests do not claim native webpage pixel capture or complete browser acceptance.

## Checks and receipts

- 13 frontend regressions and 11 SQLite store regressions passed. Strict Rust all-target check and clippy passed; existing formatting advisory remains. Frontend/design checks passed with existing warnings. All 70 native command permissions passed; 3,813 translation keys have zero missing entries. Local debug build succeeded using the existing target cache.
- Initial jsdom tests failed because the test environment lacked dialog.showModal and the selectors expected English despite Chinese locale. A narrowly scoped dialog polyfill and translated assertions corrected the harness; the actual native dialog subsequently passed. Original failed logs are retained. This is not a whole-repository test pass; existing note-move failures remain separate.
- Session evidence: outputs/browser-bookmarks-{create,restore}-native.json, browser-bookmarks-fixture.json, browser-bookmarks-{create,restore}-launch.json, browser-bookmarks-{first,final}-closure.json, browser-bookmarks-{1200,420}.png and browser-bookmarks-acceptance.json.
- Check logs: work/browser-bookmarks-rust.log, browser-bookmarks-store-tests.log, browser-bookmarks-ui-tests-05.log, browser-bookmarks-ui-check.log, browser-bookmarks-i18n.log and browser-bookmarks-build.log. Before/after storage scans retain the reusable profile and target; no cache cleanup was performed.

History, multiwindow, bookmark import/export/sync, full accessibility/theme coverage, native focus, complete network isolation, download workflows and the remaining P0–P6 scope are still open. This increment does not constitute complete browser delivery or an installed-version upgrade.
