// Native child views sit above DOM overlays. Preserve their current pixels in
// trusted chrome while a menu is open, then restore the same live page.
export function createBrowserOverlayPreview({ capture, host, current }) {
  let epoch = 0, pending, image;
  function clear() {
    epoch++; pending = null; image?.remove(); image?.removeAttribute("src"); image = null;
  }
  return {
    async show(tab) {
      if (pending?.tab === tab) return pending.promise;
      if (image?.isConnected && image.dataset.tab === tab) { epoch++; return true; }
      const generation = ++epoch;
      const promise = (async () => {
        const data = await capture(tab);
        if (epoch !== generation || !current(tab)) return false;
        if (typeof data !== "string" || !data.startsWith("data:image/jpeg;base64,")) throw Error("Invalid page preview");
        const next = document.createElement("img"); next.className = "browser-overlay-preview";
        next.alt = ""; next.draggable = false; next.dataset.tab = tab; next.src = data;
        if (next.decode) await next.decode();
        if (epoch !== generation || !current(tab)) { next.removeAttribute("src"); return false; }
        image = next; host().replaceChildren(next);
        // Decoding gives us pixels, but WebView2 may still be covering the
        // previous DOM frame. Keep it visible until chrome has painted.
        await afterPaint();
        return epoch === generation && current(tab);
      })();
      pending = { tab, promise };
      try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
    },
    clear,
    async releaseWhenPresented(stillPresented) {
      if (!image) return;
      const generation = epoch;
      await afterPaint();
      if (generation === epoch && stillPresented()) clear();
    },
  };
}

function afterPaint() {
  if (document.hidden) return Promise.resolve();
  return new Promise(resolve => {
    let frame;
    const finish = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", changed);
      resolve();
    };
    const changed = () => { if (document.hidden) finish(); };
    document.addEventListener("visibilitychange", changed);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
  });
}

export function browserOverlayOpen() {
  return [...document.querySelectorAll("dialog[open], .quick-tools-menu[open], .browser-options[open], .browser-tab-menu:not([hidden]), [aria-modal='true'], #command-palette:not(.hidden), #command-palette-overlay:not(.hidden), #sidebar-overlay.visible, [data-mobile-activity-menu]:not([hidden])")]
    .some(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
}
