// Native events identify their source tab. Re-check after the native focus
// handoff so queued input cannot change a different tab or an open dialog.
export function setupBrowserShortcuts({ available, getTab, focusChrome, find, address, report = () => {} }) {
  const run = action => {
    if (action === "find") find();
    else if (action === "address") { address.focus(); address.select(); }
  };
  const keydown = event => {
    if (!available() || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "l") return;
    event.preventDefault(); event.stopPropagation(); run("address");
  };
  document.addEventListener("keydown", keydown, true);
  return {
    async native(event) {
      if (!["find", "address"].includes(event.action) || !available() || event.tab !== getTab()?.id) return;
      try { await focusChrome(event.tab); if (available() && event.tab === getTab()?.id) run(event.action); }
      catch (error) { if (available() && event.tab === getTab()?.id) report(error); }
    },
    destroy() { document.removeEventListener("keydown", keydown, true); },
  };
}
