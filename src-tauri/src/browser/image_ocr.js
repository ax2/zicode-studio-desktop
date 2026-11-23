
approved => {
  // Only an already-loaded image matching the reviewed descriptor. No network or file reads.
  const images = document.images;
  const excluded = 'input,textarea,select,[contenteditable],[hidden],[inert],[aria-hidden="true"]';
  for (let i = 0; i < Math.min(images.length, 400); i++) {
    const image = images[i];
    if (!image.complete || image.currentSrc !== approved.url ||
        image.naturalWidth !== approved.width || image.naturalHeight !== approved.height ||
        !image.getClientRects().length || image.closest(excluded) ||
        image.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) continue;
    const scale = Math.min(1, 1536 / approved.width, 1536 / approved.height,
      Math.sqrt(1000000 / (approved.width * approved.height)));
    const canvas = document.createElement("canvas");
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
