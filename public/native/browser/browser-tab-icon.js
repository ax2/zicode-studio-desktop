// The Host supplies bounded engine-generated PNG bytes; no site URLs are loaded in chrome.
export function createBrowserTabIcon(url, image) {
  const icon = document.createElement("span"); icon.className = "browser-tab-icon"; icon.setAttribute("aria-hidden", "true");
  const blank = !url || url === "about:blank";
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${blank ? '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h8l-8 8h8"/>' : '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>'}</svg>`;
  if (typeof image === "string" && image.length <= 87406 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(image)) {
    const img = document.createElement("img"); img.alt = ""; img.draggable = false;
    img.addEventListener("load", () => { if (img.naturalWidth > 0 && img.naturalWidth <= 256 && img.naturalHeight > 0 && img.naturalHeight <= 256) icon.replaceChildren(img); }, { once: true });
    // A decode failure keeps the fallback; never show a broken image indicator.
    img.src = image;
  }
  return icon;
}
