import { t } from "../../i18n.js";
import { loadResourcePreview } from "./plugin-resource-preview-load.js";
import { isTextOutput } from "./plugin-output-formats.js";
import { textPreviewLimit } from "./plugin-text-preview-policy.js";
import { createMarkdownOutputPreview } from "./markdown-output-preview.js";

export function createResourcePreview({ container, read, isCurrent, plugin, executionProfile, onTransfer, onSave, onClear = () => {} }) {
  const panel = document.createElement("section");
  panel.className = "plugin-resource-preview";
  panel.setAttribute("aria-label", t("Studio output preview"));
  panel.hidden = true;
  container.append(panel);
  let active = true, revision = 0, previewRevision = 0, objectUrl = null, timer = null;
  let owner = null, content = null, status = null, markdownView = null;
  let refreshLabels = [];
  const localeChanged = () => { for (const refresh of refreshLabels) refresh(); };
  window.addEventListener("zicode:locale-changed", localeChanged);
  function clearPreview() {
    previewRevision++;
    markdownView?.destroy(); markdownView = null;
    if (timer) clearTimeout(timer);
    timer = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    content?.replaceChildren();
    panel.removeAttribute("aria-busy");
  }
  function clear() { revision++; clearPreview(); onClear(); owner = null; refreshLabels = []; panel.replaceChildren(); panel.hidden = true; }
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function button(text, action) {
    const result = node("button", text, "ui-button ui-button--secondary");
    result.type = "button"; result.addEventListener("click", action); return result;
  }
  function show(resources, scope, labels) {
    clear();
    if (!active || !isCurrent() || !resources?.length) return;
    owner = { ...scope };
    const token = revision;
    const title = plugin.capabilities?.find((item) => item.id === owner.capabilityId)?.title ?? owner.capabilityId;
    panel.hidden = false;
    const summary = node("p", t("Preview locally. These results have not been saved."));
    const saved = new Set();
    panel.append(node("strong", t("Studio · Output files")), node("p", title), summary);
    status = node("p"); status.setAttribute("role", "status");
    content = node("div", null, "plugin-resource-preview-content");
    const transferSlot = node("div");
    for (const resource of resources) {
      const row = node("div", null, "plugin-resource-preview-row");
      const suppliedLabel = Array.isArray(labels) && labels.length === resources.length ? labels[resource.index] : null;
      const named = typeof suppliedLabel === "string" && suppliedLabel.length && new TextEncoder().encode(suppliedLabel).length <= 128 && !Array.from(suppliedLabel).some(character => {
        const code = character.codePointAt(0); return code < 32 || (code >= 127 && code <= 159);
      });
      const metadata = node("span");
      const preview = button("", () => void open(resource, token));
      const refresh = () => {
        const label = named ? t(suppliedLabel) : t("Output {number}").replace("{number}", resource.index + 1);
        metadata.textContent = `${label} · ${resource.mimeType} · ${resource.byteLength.toLocaleString()} ${t("bytes")}`;
        preview.textContent = t("Preview {name}").replace("{name}", label);
      };
      refreshLabels.push(refresh); refresh();
      const limit = isTextOutput(resource.mimeType) ? textPreviewLimit(executionProfile) : 8 * 1024 * 1024;
      preview.disabled = resource.byteLength > limit;
      if (preview.disabled) row.append(node("span", t("This result is too large to preview.")));
      row.append(metadata, preview); panel.append(row);
      if (onTransfer) row.append(button(t("Send to tool"), () => onTransfer(resource, owner, transferSlot)));
      if (onSave) {
        const savedStatus = node("span", t("Not saved"), "plugin-resource-saved-status");
        savedStatus.setAttribute("role", "status");
        row.append(savedStatus, button(t("Preview save"), () => {
          if (!active || token !== revision || !isCurrent()) return;
          onSave(resource, owner, transferSlot, (receipt) => {
            if (!active || token !== revision || !isCurrent()) return;
            saved.add(resource.resourceId);
            savedStatus.textContent = t("Saved copy: {path}").replace("{path}", receipt.destination ?? receipt.relativePath);
            summary.textContent = saved.size === resources.length
              ? t("All output files have confirmed saved copies.")
              : t("Saved {saved} of {total} output files. Other results remain temporary.")
                .replace("{saved}", saved.size).replace("{total}", resources.length);
          });
        }));
      }
    }
    const close = button(t("Close preview"), () => { clearPreview(); status.textContent = t("Preview closed."); });
    panel.append(close, status, content, transferSlot);
  }
  async function open(resource, token) {
    if (!active || token !== revision || !isCurrent()) return;
    clearPreview();
    const previewToken = previewRevision, scope = owner;
    const valid = () => active && token === revision && previewToken === previewRevision && isCurrent();
    if (!valid()) return;
    const readChunk = (offset, length) => read(scope, resource, offset, length, valid);
    panel.setAttribute("aria-busy", "true"); status.textContent = t("Loading preview…");
    try {
      const result = await loadResourcePreview({ resource, read: readChunk, isCurrent: valid, executionProfile });
      if (!valid()) return;
      if (result.kind === "text" && executionProfile === "resource.wasi.markdown.v1" && resource.mimeType === "text/html") {
        const view = await createMarkdownOutputPreview({ container: content, html: result.text, isCurrent: valid });
        if (!valid()) { view.destroy(); return; }
        markdownView = view; status.textContent = "";
      } else if (result.kind === "image") {
        objectUrl = URL.createObjectURL(result.blob);
        const image = node("img"); image.src = objectUrl;
        image.alt = t("Tool output preview"); content.replaceChildren(image);
        status.textContent = t("Image preview · {width} × {height}").replace("{width}", result.width).replace("{height}", result.height);
      } else if (result.kind === "text" && textPreviewLimit(executionProfile) > 128 * 1024) {
        const text = node("textarea", null, "ui-textarea");
        text.readOnly = true; text.rows = 6; text.value = result.text;
        text.setAttribute("aria-label", t("Tool output preview"));
        content.replaceChildren(text, button("Select all", () => { text.focus(); text.select(); }));
        status.textContent = t("Text preview");
      } else {
        const text = node("pre", result.text); text.tabIndex = 0;
        text.setAttribute("aria-label", t("Tool output preview")); content.replaceChildren(text);
        status.textContent = t(result.kind === "binary" ? "Binary preview · first 256 bytes" : "Text preview");
      }
      // Recheck authority while copied pixels/text remain visible; never silently keep stale content.
      const verify = async () => {
        if (!valid()) { if (token === revision && previewToken === previewRevision) clearPreview(); return; }
        try { await readChunk(0, 1); if (valid()) timer = setTimeout(verify, 5000); }
        catch { if (valid()) { clearPreview(); onClear(); status.textContent = t("Preview expired or access was revoked."); } }
      };
      timer = setTimeout(verify, 5000);
    } catch {
      if (valid()) { clearPreview(); status.textContent = t("Preview unavailable. The result may have expired or its format is unsupported."); }
    } finally { if (valid()) panel.removeAttribute("aria-busy"); }
  }
  return { show, clear, destroy() { active = false; clear(); window.removeEventListener("zicode:locale-changed", localeChanged); panel.remove(); } };
}
