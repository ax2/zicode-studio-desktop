import { t } from "../../i18n.js";
import { outputExtension } from "./plugin-output-formats.js";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
function validItem(item, workspace) {
  const r = item?.receipt, ext = outputExtension(r?.mimeType);
  return !!ext && r.schemaVersion === 1 && r.profile === "resource.save.draft1" && r.workspaceId === workspace &&
    UUID.test(r.saveId) && r.relativePath === `.zicode/outputs/${r.saveId}/result.${ext}` &&
    Number.isSafeInteger(r.byteLength) && r.byteLength >= 0 && r.byteLength <= 32 * 1024 * 1024 &&
    HASH.test(r.contentVersion) && HASH.test(item.receiptVersion) && item.integrity === "not_checked" &&
    [r.source?.pluginId, r.source?.capabilityId, r.source?.packageVersion].every(v => typeof v === "string" && v.length > 0 && v.length <= 256) && UUID.test(r.source?.resourceId);
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = t(text);
  if (className) element.className = className;
  return element;
}
// Trusted parent only: selecting metadata never reads a payload or grants access.
export function createSavedOutputPicker({ container, gateway, target, isCurrent, onSelect }) {
  if (!gateway || !target?.workspaceId) return null;
  const panel = node("section", null, "saved-outputs ui-panel");
  panel.setAttribute("aria-label", t("Use a saved project file"));
  const toggle = node("button", "Use a saved project file", "ui-button ui-button--secondary"); toggle.type = "button";
  const content = node("div"), form = node("form", null, "saved-outputs-search");
  const label = node("label", "Search saved plugin files"), query = node("input", null, "ui-input");
  query.type = "search"; query.maxLength = 120; label.append(query);
  const search = node("button", "Search", "ui-button ui-button--secondary"); search.type = "submit";
  const status = node("p"); status.setAttribute("role", "status");
  const list = node("ul"), pages = node("div", null, "saved-outputs-actions");
  const previous = node("button", "Previous page", "ui-button ui-button--secondary"), next = node("button", "Next page", "ui-button ui-button--secondary");
  previous.type = next.type = "button"; form.append(label, search); pages.append(previous, next);
  content.append(node("p", "Selecting a saved file does not share it. Confirm file sharing with the receiving tool to continue."), form, status, list, pages);
  content.hidden = true; toggle.setAttribute("aria-expanded", "false"); panel.append(toggle, content); container.append(panel);
  let active = true, disabled = false, loading = false, sequence = 0, controller = null, page = null;
  const scene = target.sceneId ?? "programming", workspace = target.workspaceId;
  const current = token => active && token === sequence && isCurrent();
  function invalidate() { sequence++; controller?.abort(); controller = null; }
  function controls() {
    toggle.disabled = disabled; query.disabled = search.disabled = disabled || loading;
    previous.disabled = disabled || loading || !page || page.offset === 0;
    next.disabled = disabled || loading || !page?.hasMore;
    for (const button of list.querySelectorAll("button")) button.disabled = disabled || loading;
  }
  async function load(offset = 0) {
    if (disabled) return;
    invalidate(); onSelect(null); list.replaceChildren(); page = null; loading = true; controls(); status.textContent = t("Loading…");
    const token = sequence; controller = new AbortController();
    try {
      const result = await gateway.list(scene, workspace, { query: query.value, offset, signal: controller.signal });
      if (!current(token)) return;
      if (result.schemaVersion !== 1 || result.profile !== "resource.library.draft1" || result.workspaceId !== workspace || result.pageSize !== 40 || result.payloadsRead !== false || result.offset !== offset || !Number.isSafeInteger(result.total) || result.total < 0 || result.total > 128 || typeof result.hasMore !== "boolean" || !Array.isArray(result.items) || result.items.length > 40 || !result.items.every(item => validItem(item, workspace))) throw new Error();
      page = result;
      status.textContent = `${result.total} ${t("Files")} · ${t("File contents are verified only when opened.")}`;
      if (result.skippedEntries) status.textContent += ` ${t("Some incomplete or changed records were skipped. Existing files were kept.")}`;
      for (const original of result.items) {
        const item = structuredClone(original), receipt = item.receipt;
        const row = node("li"), title = node("strong"); title.textContent = receipt.relativePath;
        const source = node("span"); source.textContent = `${receipt.source.pluginId} · ${receipt.source.capabilityId} · ${receipt.byteLength} bytes`;
        const choose = node("button", "Select saved file", "ui-button ui-button--secondary"); choose.type = "button";
        choose.addEventListener("click", () => {
          if (disabled || loading || !current(token)) return;
          controller?.abort(); controller = new AbortController(); const signal = controller.signal;
          onSelect({ name: receipt.relativePath, size: receipt.byteLength, type: receipt.mimeType,
            expectedContentVersion: receipt.contentVersion,
            arrayBuffer: async () => {
              if (!current(token) || signal.aborted) throw new Error("saved_selection_changed");
              const bytes = await gateway.read(scene, workspace, item, signal);
              if (!current(token) || signal.aborted) throw new Error("saved_selection_changed");
              return bytes;
            } });
          content.hidden = true; toggle.setAttribute("aria-expanded", "false");
        });
        row.append(title, source, choose); list.append(row);
      }
    } catch { if (current(token)) { list.replaceChildren(); page = null; status.textContent = t("Saved files could not be loaded. Check project access and refresh."); } }
    finally { if (current(token)) { loading = false; controls(); } }
  }
  toggle.addEventListener("click", () => {
    content.hidden = !content.hidden; toggle.setAttribute("aria-expanded", String(!content.hidden));
    if (content.hidden) { invalidate(); loading = false; onSelect(null); controls(); } else void load();
  });
  form.addEventListener("submit", event => { event.preventDefault(); void load(); });
  previous.addEventListener("click", () => void load(Math.max(0, (page?.offset ?? 0) - 40)));
  next.addEventListener("click", () => void load((page?.offset ?? 0) + 40));
  controls();
  return {
    clear() { invalidate(); loading = false; page = null; list.replaceChildren(); status.textContent = ""; controls(); },
    setDisabled(value) { disabled = value; controls(); },
    destroy() { active = false; invalidate(); panel.remove(); },
  };
}
