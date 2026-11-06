# Windows browser tab ordering — 2026-11-05

Tabs in the compact shared header can now be dragged before or after another tab. The strip shows an insertion marker and scrolls near its horizontal edges. Focused tab titles also support Alt+Shift+Left/Right. Escape or dropping outside the strip cancels without changing order. The close button does not start a tab drag, and an external/page drag cannot supply a reorder operation.

The reorder is committed through the existing revision-checked session store before the UI order changes. A failed save retains the prior order and remains retryable. No new storage format or native command is added. Reordering preserves the selected tab and does not call native create/close/navigation. Title events can update the underlying tab during a drag, but the dragged DOM node remains until the drag finishes. Focus and nearest scroll position are restored to the moved tab after successful persistence. These keyboard shortcuts are scoped to a focused chrome tab title, not the native webpage.

## Actual Windows acceptance

The existing built debug executable was reused with the updated frontend and regenerated CSS bundle. Two owned Studio processes used the same isolated QA profile; no native rebuild, version bump or installed-runtime replacement was required.

At 1200 CSS pixels, actual scoped Playwright pointer drag moved the first existing tab after the third. The selected tab, native tab IDs/URLs/visibility and active page document revision remained unchanged. Alt+Shift+Right then moved that tab one more position and retained focus. At 421 pixels, pointer dragging at the strip edge caused real horizontal scrolling; releasing outside the strip canceled without changing the saved order. No document horizontal overflow appeared. Both screenshots were visually inspected; they show chrome layout, not pixels from the separate native website control.

After normal process exit/restart, the complete ordered six-tab snapshot, active tab and recently closed queue matched exactly. The original ordering was restored through the same user-facing keyboard interaction. The original tabs and closed queue, bookmark library and synthetic note content read through the real Notes Host remained exact. No user profile or installed daily runtime was touched. Both owned processes exited normally, with the debug port closed.

## Checks and evidence

Twenty focused frontend regressions passed, including save failure/retry, no-op/bounds, external-drop rejection, composition keys, cancellation, node retention during a title update, edge scrolling and the existing bookmarks/history/reopen/surface tests. Frontend/design/Pi-SDK checks passed with existing warnings; 3,826 translation keys have no missing entries. There were no Rust changes, so previously passed native checks/build were reused. This is not a whole-suite pass.

The first actual test failed after a successful drag because its unscoped selected-tab locator also matched two other hidden Studio panels. The failure was retained, the locator was restricted to the browser strip, and baseline order was restored through the UI before rerunning. No product assertion was removed.

Session evidence: outputs/browser-tab-order-{create,restore}-native.json, fixture.json, {create,restore}-launch.json, {first,final}-closure.json, {1200,420}.png, create-first-failure.json and acceptance.json, all with the browser-tab-order prefix. Check logs: work/browser-tab-order-tests.log, check.log and i18n.log with the same prefix. Before/after storage scans preserve the reused target and profile; no cleanup was performed.

Native webpage keyboard focus/global browser shortcuts, tab groups/mute/zoom/fullscreen, multiwindow and remaining P0–P6 items remain open. No computer-use input, schedules, subagents, paid model calls, external writes, user-process termination or publishing occurred.
