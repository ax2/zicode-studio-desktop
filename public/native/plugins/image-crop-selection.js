import { t } from "../../i18n.js";
import { loadResourcePreview, resourceImagePreviewLimit } from "./plugin-resource-preview-load.js";

export function createImageCropSelection({ container, read, isCurrent, onApply }) {
  const panel = document.createElement("section");
  panel.className = "image-crop-selection";
  panel.hidden = true;
  const preview = makeButton("Preview crop source", () => {
    if (dimensions) { clear(); controls(); }
    else void open();
  });
  const apply = makeButton("Apply crop area", () => void applyArea());
  apply.hidden = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const stage = document.createElement("div");
  stage.className = "image-crop-stage";
  stage.hidden = true;
  const image = document.createElement("img");
  image.alt = t("Crop source image");
  image.draggable = false;
  const outline = document.createElement("div");
  outline.className = "image-crop-outline";
  outline.setAttribute("aria-hidden", "true");
  stage.append(image, outline);
  panel.append(preview, status, stage, apply);
  container.append(panel);

  let source, metadata, dimensions, objectUrl, timer, drag, selected;
  let revision = 0, busy = false, disabled = false;
  function makeButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--secondary";
    button.textContent = t(label);
    button.onclick = action;
    return button;
  }
  function controls() {
    preview.textContent = t(dimensions ? "Close preview" : "Preview crop source");
    preview.disabled = disabled || busy || !source || metadata.byteLength > resourceImagePreviewLimit;
    apply.disabled = disabled || busy || Boolean(drag) || !selected;
  }
  function clear() {
    revision++;
    clearTimeout(timer);
    busy = false;
    const pointer = drag?.id;
    dimensions = drag = selected = undefined;
    if (pointer !== undefined && image.hasPointerCapture(pointer)) image.releasePointerCapture(pointer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    image.removeAttribute("src");
    stage.hidden = apply.hidden = true;
    status.textContent = "";
  }
  function show(resource, previewSource) {
    clear();
    source = previewSource?.mimeType === "image/png" ? resource : undefined;
    metadata = previewSource;
    panel.hidden = !source;
    if (source && metadata.byteLength > resourceImagePreviewLimit) status.textContent = t("Could not preview this PNG. You can enter crop pixels manually.");
    controls();
  }
  function unavailable(message) {
    clear();
    status.textContent = t(message);
    controls();
  }
  async function open() {
    if (preview.disabled || !source || !isCurrent(source)) return;
    clear();
    const resource = source, token = revision;
    const current = () => token === revision && isCurrent(resource);
    const readChunk = (offset, length) => read(resource, offset, length, current);
    status.textContent = t("Loading preview…");
    busy = true;
    controls();
    try {
      const result = await loadResourcePreview({ resource: { ...resource, ...metadata }, read: readChunk, isCurrent: current, unorientedPng: true });
      if (!current()) return;
      objectUrl = URL.createObjectURL(result.blob);
      image.src = objectUrl;
      dimensions = { width: result.width, height: result.height };
      image.width = dimensions.width;
      image.height = dimensions.height;
      stage.style.setProperty("--crop-ratio", String(dimensions.width / dimensions.height));
      stage.hidden = apply.hidden = false;
      status.textContent = t("Drag across the PNG to select the crop area.");
      renderArea();
      async function verify() {
        if (!current()) { if (token === revision) clear(); return; }
        try {
          await readChunk(0, 1);
          if (current()) timer = setTimeout(verify, 5000);
        } catch {
          if (current()) unavailable("Preview expired or access was revoked.");
        }
      }
      timer = setTimeout(verify, 5000);
    } catch {
      if (current()) unavailable("Could not preview this PNG. You can enter crop pixels manually.");
    } finally {
      if (token === revision) { busy = false; controls(); }
    }
  }
  function point(event) {
    const bounds = image.getBoundingClientRect();
    function pixel(position, size, extent) {
      return Math.round(Math.max(0, Math.min(1, position / size)) * extent);
    }
    return {
      x: pixel(event.clientX - bounds.left, bounds.width, dimensions.width),
      y: pixel(event.clientY - bounds.top, bounds.height, dimensions.height),
    };
  }
  function renderArea() {
    outline.hidden = !selected;
    if (selected) {
      outline.style.left = `${selected.x / dimensions.width * 100}%`;
      outline.style.top = `${selected.y / dimensions.height * 100}%`;
      outline.style.width = `${selected.width / dimensions.width * 100}%`;
      outline.style.height = `${selected.height / dimensions.height * 100}%`;
    }
    controls();
  }
  function move(event) {
    const end = point(event);
    const width = Math.abs(end.x - drag.start.x), height = Math.abs(end.y - drag.start.y);
    selected = width && height ? { x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y), width, height } : undefined;
    renderArea();
  }
  image.addEventListener("pointerdown", event => {
    if (!dimensions || !image.complete || !image.naturalWidth || disabled || busy || event.button !== 0 || drag || !isCurrent(source)) return;
    image.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, start: point(event) };
    selected = undefined;
    renderArea();
  });
  image.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) move(event);
  });
  image.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    move(event);
    drag = undefined;
    renderArea();
  });
  image.addEventListener("lostpointercapture", event => {
    if (drag?.id !== event.pointerId) return;
    drag = selected = undefined;
    renderArea();
  });
  async function applyArea() {
    if (apply.disabled || !selected || !isCurrent(source)) return;
    const resource = source, token = revision, area = selected;
    const current = () => token === revision && isCurrent(resource);
    busy = true;
    controls();
    try {
      await read(resource, 0, 1, current);
      if (!current() || disabled) return;
      onApply(area);
      status.textContent = t("Crop area applied. Review the pixel values before running.");
    } catch {
      if (current()) unavailable("Preview expired or access was revoked.");
    } finally {
      if (token === revision) { busy = false; controls(); }
    }
  }

  return { show, setDisabled(value) { disabled = value; controls(); }, destroy() { show(null); panel.remove(); } };
}
