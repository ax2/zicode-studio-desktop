
(approved, frame, maxSide) => {
  // Only an already-loaded image matching the reviewed descriptor. No network or file reads.
  const excluded = 'input,textarea,select,[contenteditable],[hidden],[inert],[aria-hidden="true"]';
  const displayed = element => element.getClientRects().length && !element.closest(excluded)
    && element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
  let doc = document;
  if (frame) {
    const inline = address => address === "about:srcdoc" || address === "about:blank";
    const currentOrigin = location.origin;
    for (const index of frame.locator.path) {
      const element = doc.querySelectorAll("iframe,frame")[index];
      if (!element || !displayed(element) || element.hasAttribute("sandbox")) return { kind: "unavailable" };
      const child = element.contentDocument;
      if (!child || (!inline(child.URL) && new URL(child.URL).origin !== currentOrigin)) return { kind: "unavailable" };
      doc = child;
    }
    const sameAddress = frame.url == null ? inline(doc.URL) : !inline(doc.URL) && new URL(doc.URL).href === frame.url;
    if (!sameAddress || String(doc.defaultView?.performance?.timeOrigin) !== frame.locator.timeOrigin) {
      return { kind: "frameChanged" };
    }
  }
  const images = doc.images;
  for (let i = 0; i < Math.min(images.length, 400); i++) {
    const image = images[i];
    if (!image.complete || image.currentSrc !== approved.url ||
        image.naturalWidth !== approved.width || image.naturalHeight !== approved.height ||
        !displayed(image)) continue;
    const scale = Math.min(1, maxSide / approved.width, maxSide / approved.height,
      Math.sqrt(1000000 / (approved.width * approved.height)));
    const canvas = doc.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(approved.width * scale));
    canvas.height = Math.max(1, Math.floor(approved.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { kind: "unavailable" };
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png");
      return png.length + 256 > 6 * 1024 * 1024 ? { kind: "tooLarge" } : { kind: "ready", png };
    } catch (error) {
      return { kind: error?.name === "SecurityError" ? "originRestricted" : "unavailable" };
    }
  }
  return { kind: "unavailable" };
}
