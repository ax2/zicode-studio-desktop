// Native child views sit above DOM overlays. Preserve their current pixels in
// trusted chrome while a menu is open, then restore the same live page.
export function createBrowserOverlayPreview({ capture, host, current }) {
  let epoch = 0, pending, image;
  return {
    async show(tab) {
      if (image?.isConnected && image.dataset.tab === tab) return true;
      if (pending?.tab === tab) return pending.promise;
      const generation = ++epoch;
      const promise = (async () => {
        const data = await capture(tab);
        if (epoch !== generation || !current(tab)) return false;
        if (typeof data !== "string" || !data.startsWith("data:image/jpeg;base64,")) throw Error("Invalid page preview");
        const next = document.createElement("img"); next.className = "browser-overlay-preview";
        next.alt = ""; next.draggable = false; next.dataset.tab = tab; next.src = data;
        if (next.decode) await next.decode();
        if (epoch !== generation || !current(tab)) { next.removeAttribute("src"); return false; }
        image?.removeAttribute("src"); image = next; host().replaceChildren(next); return true;
      })();
      pending = { tab, promise };
      try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
    },
    clear() { epoch++; pending = null; image?.removeAttribute("src"); image?.remove(); image = null; },
  };
}

export function browserOverlayOpen() {
  return [...document.querySelectorAll("dialog[open], .quick-tools-menu[open], .browser-options[open], [aria-modal='true'], #command-palette:not(.hidden), #command-palette-overlay:not(.hidden), #sidebar-overlay.visible, [data-mobile-activity-menu]:not([hidden])")]
    .some(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
}
