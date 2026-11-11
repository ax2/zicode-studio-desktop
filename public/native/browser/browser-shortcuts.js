// Native events identify their source tab. Re-check after the native focus
// handoff so queued input cannot change a different tab or an open dialog.
const pageActions = new Set(["reload", "back", "forward"]);
const tabActions = new Set(["newTab", "closeTab", "reopenTab", "nextTab", "previousTab"]);
export function browserShortcut(event) {
  if (event.isComposing) return null;
  if (event.altKey) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
    return event.key === "ArrowLeft" ? "back" : event.key === "ArrowRight" ? "forward" : null;
  }
  if (event.key === "F5" && !event.ctrlKey && !event.metaKey && !event.shiftKey) return "reload";
  if (event.key === "F11" && !event.ctrlKey && !event.metaKey && !event.shiftKey) return "fullscreen";
  if (!(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "t") return event.shiftKey ? "reopenTab" : "newTab";
  if (key === "a" && event.ctrlKey && event.shiftKey && !event.metaKey) return "searchTabs";
  if (key === "tab" && event.ctrlKey) return event.shiftKey ? "previousTab" : "nextTab";
  if (event.shiftKey) return null;
  return key === "l" ? "address" : key === "w" ? "closeTab" : key === "r" ? "reload" : null;
}
export function setupBrowserShortcuts({ available, getTab, focusChrome, find, address, tabAction = () => {}, pageAction = () => {}, fullscreen = () => {}, searchTabs = () => {}, report = () => {} }) {
  const run = (action, fromPage = false) => {
    if (pageActions.has(action)) return pageAction(action, getTab()?.id);
    if (action === "fullscreen") return fullscreen();
    if (action === "searchTabs") return searchTabs(fromPage, getTab()?.id);
    if (action === "find") return find();
    if (action === "address") { address.focus(); address.select(); }
    else if (tabActions.has(action)) return tabAction(action, getTab()?.id);
  };
  const keydown = event => {
    const action = browserShortcut(event);
    if (!action || !available()) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) { try { Promise.resolve(run(action)).catch(report); } catch (error) { report(error); } }
  };
  document.addEventListener("keydown", keydown, true);
  return {
    async native(event) {
      if (!["find", "address", "fullscreen", "searchTabs"].includes(event.action) && !tabActions.has(event.action) && !pageActions.has(event.action)) return;
      if (!available() || event.tab !== getTab()?.id) return;
      try {
        if (!pageActions.has(event.action)) await focusChrome(event.tab);
        if (available() && event.tab === getTab()?.id) await run(event.action, true);
      }
      catch (error) { if (available() && event.tab === getTab()?.id) report(error); }
    },
    destroy() { document.removeEventListener("keydown", keydown, true); },
  };
}
