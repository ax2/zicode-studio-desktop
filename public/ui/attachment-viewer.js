/**
 * Attachment viewer — click-to-preview/download for non-image note attachments.
 *
 * Call initAttachmentViewer(container) once on the rendered notes preview. It
 * uses event delegation so the post-render DOM rewrite of Markdown links keeps
 * working without re-wiring listeners.
 *
 * Text-like attachments (txt/md/csv/json) are fetched and shown in an in-app
 * dialog; PDFs (and any other kind) show a download / open action instead. This
 * keeps mobile users inside the app instead of bouncing them to a new tab.
 */

import { t } from "../i18n.js";

const TEXT_KINDS = new Set(["txt", "md", "csv", "json"]);

// Prefer the bootstrap's authenticated host fetch so attachment previews and
// downloads still work for mobile clients whose requests must carry the device
// token; fall back to plain fetch inside the desktop WebView.
function hostFetch(input, init) {
  const authed = globalThis.__zicodeHostFetch;
  const fn = typeof authed === "function" ? authed : fetch;
  return init == null ? fn(input) : fn(input, init);
}

let overlay = null;
let lastFocused = null;
// Incremented on every open; guards against a slow fetch for a previous
// attachment resolving after the user has already opened another one.
let viewToken = 0;

/** Map a lower-case file extension to a compact emoji glyph. */
export function attachmentIconFor(kind) {
  switch (kind) {
    case "pdf":
      return "📕";
    case "csv":
      return "📊";
    case "json":
      return "🧾";
    case "md":
      return "📝";
    case "txt":
      return "📄";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "🖼️";
    default:
      return "📎";
  }
}

/** Whether an attachment can be previewed as text inside the viewer. */
export function isTextAttachment(kind) {
  return TEXT_KINDS.has(kind);
}

function closeLightboxIcon() {
  return (
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<line x1="17" y1="3" x2="3" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>"
  );
}

function getOrCreateOverlay() {
  // Recreate the dialog if a previous instance was removed from the document
  // (e.g. by a test harness or an aggressive DOM reset), so openViewer never
  // points at a detached element.
  if (overlay?.isConnected) return overlay;
  overlay = null;

  overlay = document.createElement("div");
  overlay.className = "attachment-viewer-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("Attachment preview"));

  const card = document.createElement("div");
  card.className = "attachment-viewer-card";

  const header = document.createElement("header");
  header.className = "attachment-viewer-header";

  const title = document.createElement("div");
  title.className = "attachment-viewer-title";

  const icon = document.createElement("span");
  icon.className = "attachment-viewer-icon";
  icon.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "attachment-viewer-name";

  title.append(icon, name);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "attachment-viewer-close";
  closeBtn.setAttribute("aria-label", t("Close"));
  closeBtn.innerHTML = closeLightboxIcon();

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "attachment-viewer-body";

  const actions = document.createElement("footer");
  actions.className = "attachment-viewer-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "ui-button ui-button--secondary attachment-viewer-open";
  openBtn.textContent = t("Open in new tab");

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "ui-button ui-button--primary attachment-viewer-download";
  downloadBtn.textContent = t("Download");

  actions.append(openBtn, downloadBtn);
  card.append(header, body, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => closeViewer();

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  closeBtn.addEventListener("click", close);
  openBtn.addEventListener("click", async () => {
    const url = overlay.dataset.url;
    if (!url) return;
    // Fetch with the device token/cookie first so the binary can be opened as
    // a local blob (works on mobile/relay clients and desktop WebView alike).
    try {
      const response = await hostFetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener");
    } catch {
      window.open(url, "_blank", "noopener");
    }
  });
  downloadBtn.addEventListener("click", () => {
    const url = overlay.dataset.url;
    const fileName = overlay.dataset.name || "attachment";
    if (url) downloadAttachment(url, fileName);
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !overlay.classList.contains("open")) return;
    // Keep focus inside the dialog.
    const focusable = Array.from(
      overlay.querySelectorAll("button:not(:disabled)"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("open")) {
      close();
    }
  });

  return overlay;
}

async function downloadAttachment(url, fileName) {
  try {
    const response = await hostFetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function openViewer({ url, name, kind }) {
  const ov = getOrCreateOverlay();
  const isText = isTextAttachment(kind);
  const token = ++viewToken;

  ov.dataset.url = url;
  ov.dataset.name = name;
  ov.dataset.kind = kind;

  const icon = ov.querySelector(".attachment-viewer-icon");
  const nameEl = ov.querySelector(".attachment-viewer-name");
  const body = ov.querySelector(".attachment-viewer-body");
  const openBtn = ov.querySelector(".attachment-viewer-open");

  if (icon) icon.textContent = attachmentIconFor(kind);
  if (nameEl) nameEl.textContent = name;

  if (openBtn) {
    // Text previews are already in-app; "open in new tab" is only useful for
    // binary files (PDF) that cannot render inline.
    openBtn.hidden = isText;
  }

  if (body) {
    body.textContent = "";
    if (isText) {
      const status = document.createElement("div");
      status.className = "attachment-viewer-status";
      status.textContent = t("Loading…");
      body.appendChild(status);
      hostFetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.text();
        })
        .then((text) => {
          if (token !== viewToken) return;
          status.remove();
          const pre = document.createElement("pre");
          pre.className = "attachment-viewer-content";
          pre.textContent = text;
          body.appendChild(pre);
        })
        .catch(() => {
          if (token !== viewToken) return;
          status.textContent = t("Could not load this attachment");
        });
    } else {
      const hint = document.createElement("p");
      hint.className = "attachment-viewer-hint";
      hint.textContent = t(
        "This file type can't be previewed here. Download it or open it in a new tab.",
      );
      body.appendChild(hint);
    }
  }

  ov.classList.remove("open");
  void ov.offsetWidth;
  ov.classList.add("open");
  lastFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const closeBtn = ov.querySelector(".attachment-viewer-close");
  closeBtn?.focus();
  document.body.style.overflow = "hidden";
}

function closeViewer() {
  if (!overlay) return;
  overlay.classList.remove("open");
  const restore = lastFocused;
  lastFocused = null;
  if (restore?.isConnected) restore.focus();
  document.body.style.overflow = "";
}

/** Wire click delegation on a container (deduped via a dataset flag). */
export function initAttachmentViewer(container) {
  if (!container || container.dataset.attachmentViewer === "1") return;
  container.dataset.attachmentViewer = "1";
  container.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-attachment-view]")
      : null;
    if (!target || !container.contains(target)) return;
    event.preventDefault();
    const url = target.getAttribute("href") || target.dataset.href;
    if (!url) return;
    const name = target.dataset.attachmentName || "attachment";
    const kind = target.dataset.attachmentKind || "bin";
    openViewer({ url, name, kind });
  });
}
