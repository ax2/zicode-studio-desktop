# Browser menus, page background and shared actions — 2026-11-06

The user reported that bookmarks and menus blanked the webpage, the left Commands button could not reveal its palette over the webpage, and the global quick-tools/connection controls wasted top-bar space. They also requested more browser functions in the webpage context menu. This increment is implemented and installed in the daily Windows Studio; the broader browser and Studio requirements remain open.

## Behavior and implementation

The old surface policy hid a native child WebView whenever a DOM menu opened, leaving an empty viewport. The actual command-palette elements were missing from overlay detection, so that panel could remain behind the native page. The overlay helper now recognizes those real elements and retains a fresh native viewport image in trusted chrome before hiding the child. Closing the overlay presents the same live native page, then releases the image. It does not navigate, reload or modify page content. The background is a still image while the menu is open, not a promise of continuous background video/animation.

Native CapturePreview writes JPEG to an in-memory COM stream; the owned tab/document is rechecked before the result returns. Only trusted workspace chrome can request it. Dimensions are capped at 32 million pixels and encoded output at 8 MiB. The product does not save these images, send them to Pi or expose an IPC bridge to webpages. Capture failure remains an explicit error; protected media, renderer failures and extreme display dimensions have not been accepted. The frontend deduplicates concurrent captures, discards late results, preserves the image through normal title paints and releases it after closing. New logic is in focused modules; the existing large browser composition file has only lifecycle wiring and fixed native-menu action dispatch.

The actual WebView2 context menu retains its default text/link/image operations. A Browser tools submenu adds back/forward/reload, find, bookmark, history, page reading and zoom controls. Public links can offer Open link in new tab through the existing owner-bound popup path. Native callbacks carry the source tab and are checked against current visibility; no arbitrary page-supplied command is executed. English/Chinese custom labels follow the current interface language.

Quick tools and connection status now occupy the shared activity bar immediately above Commands on desktop. The original controlled DOM nodes are relocated rather than creating duplicate controllers. Narrow windows retain them in the existing bottom dock with a bounded upward popover. Browser tabs and Notes controls retain the freed top-bar space.

## Validation and boundaries

| Check | Result |
|---|---|
| Actual Windows Browser identity and public native page body | Passed |
| Bookmarks/options/quick-tools background | Native image loaded and visibly rendered in chrome screenshots; no empty viewport |
| Left Commands button | Actual palette opens above retained page; search input accepts text and Escape closes it |
| Close overlays | Same native document revision, visible child restored, temporary image removed |
| Wide/narrow layout | Actual 1756 and 422 CSS-pixel client widths; no document overflow; popover inside viewport |
| Shared controls | Removed from top header, quick tools/status present above desktop Commands; retained after restart |
| Context menu | Real webpage right-click raised native callback and constructed all ten added actions |
| Restart/data | Original seven QA tabs/closed queue/active ID and two synthetic notes retained; daily data audit passed |
| Console | No page errors during tested flows |

Browser plugin was unavailable; existing bundled Playwright connected only to owned QA chrome and native-page endpoints. Screenshots are of the app WebView composition and include the actual native CapturePreview image. **No OS desktop screenshot, global mouse/keyboard input or foreground activation was used.** Scoped window resizing used no-activation flags and verified the foreground window stayed unchanged. Native context-menu construction was verified; not every Windows menu item selection was driven, and link-specific selection/complete context-menu compatibility remain outside this acceptance. Existing action targets have separate previous acceptance, which does not by itself prove every new native menu callback.

All 59 browser frontend cases in 15 files passed, including four new capture/cancellation/error/command-overlay cases. Frontend/design, TypeScript and strict Rust all-target checks/clippy passed with existing warnings and formatting advisory. Local build succeeded using the existing target. First compilation exposed the callback wrapper returning Result rather than raw HRESULT; then clippy rejected a helper placed after the test module. Both failures are retained and fixed without skipping checks.

Actual QA processes 98268 and 88452 exited normally. Their four temporary endpoints (56929/55519 and 62820/49367) were verified closed. Unrelated Edge 9231 was untouched.

## Daily delivery and retained data

Only owned daily process 101204 was normally exited. Matching EXE and built frontend were installed together, preserving prior files as `.before-overlay-20261106` and `public.before-overlay-20261106`. The new ordinary process is 7180, SHA-256 `1b0402ae9d6661e0a790ee4eb7431898ac5b8d36333fc322540ce91f90f8e8eb`, with fixed profile `D:\work\local-state\zicode-studio-desktop`, Host 57620, Medium integrity, registered tray, responsive single installed instance and no requested debug connection.

All 582 installed frontend files (9,402,763 bytes) match the manifest; five representative actual HTTP assets match too. All 81 audited pre-update data files, including 65 notebook/note/attachment files, remain exact. Fixed profile selector, workspace metadata, audited preferences/paired devices and SQLite integrity pass. Both Host workspace requests retain six returned note objects and notebook hashes; all 43 plugin versions/enabled states/grants remain exact. The daily tab/session, closed queue, preferences/bookmarks and all eleven prior history entries remain; restart added one visit. No credentials were copied. Notes-only snapshots are retained under `retained-backups/before-browser-overlay-2026-11-06/{before,stopped}`.

Evidence in chat outputs: `browser-overlay-{create,narrow,finish,restore}-native.json`, `{create,narrow}-{options,bookmarks,commands,quick-tools}.png` (Commands captured at wide width), `browser-overlay-{create,restore}-closure.json`, `browser-overlay-{data,store,host}-{before,after}.json`, `browser-overlay-assets-manifest.json`, `browser-overlay-daily-assets.json`, `browser-overlay-current-launch.json`, `browser-overlay-normal-final.json`, `browser-overlay-acceptance.json`. Logs are in chat work under `browser-overlay-*`. Storage before is `browser-downloads-budget-before.json` (the task began with downloads before user steering); after is `browser-overlay-budget-after.json`. Both scans completed with no unknown entries; referenced scratch over advisory remains retained.

The download-manager drafts written before this user correction exist only in chat work (`download-files.rs`, `native-downloads.rs`, `download-journal.rs`, `download-commands.rs`). They are **not integrated, built or installed**. The existing blanket download denial remains until that workflow is finished. Downloads/uploads, complete P0-P6, remaining note-move failures, cloud sync and full tool integration remain open. No schedule, publication, external message, model request or force termination occurred.

Official API references: [WebView2 context menu customization](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/context-menus), [CapturePreview](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2?view=webview2-1.0.902.49).
