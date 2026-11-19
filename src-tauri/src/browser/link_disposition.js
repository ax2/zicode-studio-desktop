(() => {


  const signal = globalThis.studioLinkDisposition;
  if (typeof signal !== "function") return;
  let lastReported = -Infinity;
  function clear() {
    if (performance.now() - lastReported < 1000) signal("");
    lastReported = -Infinity;
  }
  function observe(event) {
    if (!event.isTrusted) return;
    const modified = !event.shiftKey && !event.altKey && !event.metaKey &&
      ((event.button === 0 && event.ctrlKey) || event.button === 1);
    const link = modified && event.composedPath().find(
      node => node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement
    );
    if (link && link.hasAttribute("href")) {
      signal(JSON.stringify([location.href, link.href]));
      lastReported = performance.now();
    } else {
      clear();
    }
  }
  window.addEventListener("click", observe, true);
  window.addEventListener("auxclick", observe, true);
  window.addEventListener("keydown", event => { if (event.isTrusted) clear(); }, true);
})();
