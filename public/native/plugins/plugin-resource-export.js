import { t } from "../../i18n.js";
import { resourceAccess } from "./plugin-resource-transfer-protocol.js";
const PROFILE = "resource.export.file.draft1", UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function node(tag, text) { const el = document.createElement(tag); if (text) el.textContent = text; return el; }
function button(text, action) { const el = node("button", t(text)); el.type = "button"; el.className = "ui-button ui-button--secondary"; el.onclick = action; return el; }
function matches(value, grant, source, resource) {
  return value?.schemaVersion === 1 && value.profile === PROFILE && UUID.test(value.grantId ?? "") &&
    (!grant || value.grantId === grant.grantId && value.destination === grant.preview.destination) &&
    typeof value.destination === "string" && value.destination.length > 0 && value.destination.length <= 32768 &&
    value.contentVersion === resource.contentVersion && value.byteLength === resource.byteLength && value.mimeType === resource.mimeType &&
    value.source?.schemaVersion === source.schemaVersion && value.source.resourceId === source.resourceId && value.source.contentVersion === source.contentVersion &&
    ["runtimeId", "sessionId", "pluginId", "capabilityId"].every(key => value.source.owner?.[key] === source.owner[key]);
}
function failure(error) {
  if (String(error).includes("resource_export_conflict")) return t("The destination already exists. Nothing was overwritten. Choose a new file name.");
  return t("Export could not be confirmed. Check the chosen destination before trying again; no write was retried.");
}
export function createResourceExport({ api, getTarget, isCurrent, notify = () => {}, profile = PROFILE, makeSource = resourceAccess, validate = matches }) {
  let active = true, revision = 0, current = null;
  function clear() { revision++; current?.dispose(); current = null; }
  async function open(resource, owner, container, onSaved = () => {}) {
    clear(); if (!active || !isCurrent()) return;
    const token = revision, target = JSON.stringify(getTarget()), workspaceId = getTarget()?.workspaceId;
    const valid = () => active && token === revision && isCurrent() && target === JSON.stringify(getTarget());
    const source = makeSource(owner, resource); let grant;
    try {
      grant = await api.choose(workspaceId, source);
      if (!valid() || grant === null) {
        if (UUID.test(grant?.grantId ?? "")) await api.cancel(workspaceId, source, grant.grantId).catch(() => {});
        return;
      }
      if (grant?.schemaVersion !== 1 || grant.profile !== profile || grant.operation !== "create_new_file" || grant.saved !== false ||
        grant.requiresConfirmation !== true || grant.expiresInSeconds !== 60 || !validate(grant.preview, null, source, resource) || grant.grantId !== grant.preview.grantId) throw new Error();
    } catch (error) {
      if (UUID.test(grant?.grantId ?? "")) await api.cancel(workspaceId, source, grant.grantId).catch(() => {});
      if (valid()) {
        const panel = node("dialog"); panel.className = "plugin-resource-save";
        panel.setAttribute("aria-label", t("Save output as"));
        const status = node("p", failure(error)); status.setAttribute("role", "status");
        panel.append(status, button("Close", clear)); panel.addEventListener("cancel", event => { event.preventDefault(); clear(); });
        current = { dispose() { if (typeof panel.close === "function") panel.close(); panel.remove(); } };
        container.append(panel); if (typeof panel.showModal === "function") panel.showModal(); else panel.setAttribute("open", "");
      }
      return;
    }
    let committing = false, saved = false, disposed = false;
    const panel = node("dialog"); panel.className = "plugin-resource-save"; panel.setAttribute("aria-label", t("Save output as"));
    const status = node("p", t("Review the destination and size. No file has been written yet.")); status.setAttribute("role", "status");
    const controls = node("div"); controls.className = "plugin-resource-preview-row";
    const close = button("Cancel save", clear);
    const heading = node("div"); heading.className = "plugin-resource-save-heading"; heading.append(node("strong", t("Save output as")), close);
    const destination = node("p", grant.preview.destination);
    panel.append(heading, destination, node("p", `${resource.mimeType} · ${resource.byteLength.toLocaleString()} ${t("bytes")}`),
      node("p", t("This creates a new file at the selected location. Existing files and the original source stay unchanged.")), status, controls);
    panel.addEventListener("cancel", event => { event.preventDefault(); if (!committing) clear(); });
    current = { dispose() {
      disposed = true; if (!saved && !committing) void api.cancel(workspaceId, source, grant.grantId).catch(() => {});
      if (typeof panel.close === "function") panel.close(); panel.remove();
    } };
    container.append(panel); if (typeof panel.showModal === "function") panel.showModal(); else panel.setAttribute("open", "");
    const showSaved = receipt => { saved = true; status.textContent = t("Saved copy: {path}").replace("{path}", receipt.destination); onSaved(structuredClone(receipt)); notify(status.textContent); };
    async function commit() {
      if (!valid() || disposed || committing || saved) return;
      committing = true; close.disabled = true; controls.replaceChildren(); status.textContent = t("Saving output…");
      try {
        const result = await api.commit(workspaceId, source, grant.grantId);
        if (result?.schemaVersion !== 1 || result.profile !== profile || result.status !== "saved" || result.saved !== true || !validate(result.receipt, grant, source, resource)) throw new Error();
        saved = true;
        if (valid() && !disposed) showSaved(result.receipt);
        else notify(t("A confirmed export finished after switching views. The saved file remains at the chosen destination."));
      } catch (error) {
        if (valid() && !disposed) { status.textContent = failure(error); controls.append(button("Check saved file", () => void verify())); }
        else notify(t("Export could not be confirmed. Check the chosen destination before trying again; no write was retried."));
      } finally { committing = false; if (valid() && !disposed) { close.disabled = false; close.textContent = t("Close"); } }
    }
    async function verify() {
      if (!valid() || disposed || committing) return;
      committing = true; close.disabled = true; controls.replaceChildren(); status.textContent = t("Checking saved file…");
      try {
        const result = await api.verify(workspaceId, source, grant.grantId);
        if (result?.schemaVersion !== 1 || result.profile !== profile || result.status !== "verified" || result.saved !== true || !validate(result.receipt, grant, source, resource)) throw new Error();
        if (valid() && !disposed) showSaved(result.receipt);
      } catch { if (valid() && !disposed) status.textContent = t("The chosen file could not be verified. No write was retried."); }
      finally { committing = false; if (valid() && !disposed) close.disabled = false; }
    }
    controls.append(button("Confirm save file", () => void commit()));
  }
  return { open, clear, destroy() { active = false; clear(); } };
}
