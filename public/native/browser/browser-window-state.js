// WebView2 can retain its last CSS viewport and document visibility while
// Windows has already shrunk the minimized owner's native client rectangle.
export function observeBrowserWindow(nativeWindow, onChange) {
  let minimized = false;
  let latest;

  function refresh() {
    const check = Promise.resolve()
      .then(() => nativeWindow?.isMinimized())
      .then(value => {
        if (check !== latest) return latest;
        const next = value === true;
        if (next !== minimized) {
          minimized = next;
          onChange();
        }
        return minimized;
      }, () => minimized);
    latest = check;
    return check;
  }

  for (const event of ["onResized", "onFocusChanged"]) {
    void Promise.resolve().then(() => nativeWindow?.[event]?.(() => void refresh())).catch(() => {});
  }

  return { ready: refresh(), refresh, get minimized() { return minimized; } };
}
