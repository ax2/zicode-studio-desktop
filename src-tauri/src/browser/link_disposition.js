(() => {
  // Frame navigation without top-level source evidence retains the native default.
  if (window !== top) return;
  const signal = globalThis.studioLinkDisposition;
  if (typeof signal !== "function") return;
  function observe(event) {
    if (!event.isTrusted) return;
    const modified = !event.shiftKey && !event.altKey && !event.metaKey &&
      ((event.button === 0 && event.ctrlKey) || event.button === 1);
    const link = modified && event.composedPath().find(
      node => node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement
    );
    signal(link && link.hasAttribute("href") ? JSON.stringify([location.href, link.href]) : "");
  }
  window.addEventListener("click", observe, true);
  window.addEventListener("auxclick", observe, true);
  window.addEventListener("keydown", event => { if (event.isTrusted) signal(""); }, true);
})();
