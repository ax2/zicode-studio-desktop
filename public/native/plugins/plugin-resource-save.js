import { t } from "../../i18n.js";
import { resourceAccess } from "./plugin-resource-transfer-protocol.js";
import { verifySavedResource } from "./plugin-resource-save-recovery.js";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PROFILE = "resource.save.draft1";
function node(tag, text) { const item = document.createElement(tag); if (text) item.textContent = text; return item; }
function button(text, action) { const item = node("button", t(text)); item.className = "ui-button ui-button--secondary"; item.type = "button"; item.onclick = action; return item; }
function receiptMatches(value, resource, owner, id, workspaceId) {
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/plain": "txt", "application/octet-stream": "bin" }[resource.mimeType];
  return extension && value?.schemaVersion === 1 && value.profile === PROFILE && value.saveId === id &&
    value.workspaceId === workspaceId && value.relativePath === `.zicode/outputs/${id}/result.${extension}` &&
    value.contentVersion === resource.contentVersion && value.mimeType === resource.mimeType && value.byteLength === resource.byteLength &&
    value.source?.pluginId === owner.pluginId && value.source?.capabilityId === owner.capabilityId && value.source?.resourceId === resource.resourceId;
}
function message(error) {
  if (error?.code === "resource_save_conflict") return t("The saved file changed or the destination already exists. Nothing was overwritten.");
  if (["resource_authorization_changed", "permission_denied", "resource_unavailable", "runtime_stopped"].includes(error?.code))
    return t("Save access changed or expired. Review the result and prepare a new confirmation.");
  if (["resource_save_quota_exceeded", "resource_save_busy"].includes(error?.code)) return t("The output storage or confirmation limit has been reached. Review saved files before trying again.");
  return t("Save could not be confirmed. Check the project output directory before retrying; no automatic retry was made.");
}
// Parent-owned confirmation. Disposal never deletes a file the user explicitly approved.
export function createResourceSave({ gateway, getTarget, isCurrent, notify = () => {} }) {
  let active = true, current = null;
  function clear() { current?.dispose(); current = null; }
  function open(resource, owner, container) {
    clear(); if (!active || !isCurrent()) return;
    const source = resourceAccess(owner, resource), target = JSON.stringify(getTarget());
    const workspaceId = getTarget()?.workspaceId;
    const panel = node("dialog"); panel.className = "plugin-resource-save"; panel.setAttribute("aria-label", t("Save output to this project"));
    let disposed = false, committing = false, checking = false, grant = null, checkController = null;
    const valid = () => active && !disposed && isCurrent() && target === JSON.stringify(getTarget());
    const status = node("p", t("Preparing save preview…")); status.setAttribute("role", "status");
    const details = node("div"), controls = node("div"); controls.className = "plugin-resource-preview-row";
    const close = button("Cancel save", clear);
    panel.addEventListener("cancel", event => { event.preventDefault(); if (!committing) clear(); });
    const heading = node("div"); heading.className = "plugin-resource-save-heading";
    heading.append(node("strong", t("Save output to this project")), close);
    panel.append(heading, status, details, controls); container.append(panel);
    if (typeof panel.showModal === "function") panel.showModal(); else panel.setAttribute("open", "");
    current = { dispose() { disposed = true; checkController?.abort(); if (typeof panel.close === "function") panel.close(); panel.remove(); } };
    async function prepare() {
      try {
        const result = await gateway.prepareResourceSave(source);
        if (!valid()) return;
        if (result?.schemaVersion !== 1 || result.profile !== PROFILE || !UUID.test(result.grantId ?? "") ||
            result.requiresConfirmation !== true || result.saved !== false || result.operation !== "create_new_file" || result.expiresInSeconds !== 60 ||
            !receiptMatches(result.preview, resource, owner, result.grantId, workspaceId)) throw new Error();
        grant = structuredClone(result);
        details.append(node("p", t("Current project · {path}").replace("{path}", result.preview.relativePath)),
          node("p", `${resource.mimeType} · ${resource.byteLength.toLocaleString()} ${t("bytes")}`),
          node("p", t("A new file and provenance receipt will be created. Existing files will not be replaced. This copy remains after resource access expires.")),
          node("p", t("Save confirmation expires in 60 seconds.")));
        controls.append(button("Confirm save file", () => void commit()));
        status.textContent = t("Review the destination and size. No file has been written yet.");
      } catch (error) { if (valid()) status.textContent = message(error); }
    }
    async function commit() {
      if (!valid() || !grant || committing) return;
      committing = true; close.disabled = true; controls.replaceChildren();
      details.replaceChildren(node("p", t("Current project · {path}").replace("{path}", grant.preview.relativePath)),
        node("p", `${resource.mimeType} · ${resource.byteLength.toLocaleString()} ${t("bytes")}`),
        node("p", t("You confirmed this save. Checking or closing this dialog does not undo or repeat the write.")));
      status.textContent = t("Saving output…");
      try {
        const result = await gateway.commitResourceSave(source, grant.grantId);
        if (result?.schemaVersion !== 1 || result.profile !== PROFILE || result.status !== "saved" || result.saved !== true || typeof result.replayed !== "boolean" ||
            !receiptMatches(result.receipt, resource, owner, grant.grantId, workspaceId)) throw new Error();
        const saved = t(valid() ? "Saved in the current project: {path}" : "Saved to the original project: {path}").replace("{path}", result.receipt.relativePath);
        notify(saved);
        if (valid()) { status.textContent = saved; close.textContent = t("Close"); }
      } catch (error) {
        if (valid()) {
          status.textContent = message(error);
          if (gateway.savedOutputs) {
            controls.append(button("Check saved file", () => void checkSaved()));
            details.append(node("p", t("Check the saved receipt and file contents. This only reads the project; it does not retry saving.")));
          }
        }
        else notify(t("A confirmed save request ended after switching views. Check the project output directory before retrying."));
      } finally { committing = false; if (valid()) { close.disabled = false; close.textContent = t("Close"); } }
    }
    async function checkSaved() {
      if (!valid() || checking || committing || !grant) return;
      checking = true; checkController = new AbortController();
      const control = controls.querySelector("button"); if (control) control.disabled = true;
      status.textContent = t("Checking saved file…");
      try {
        const receipt = await verifySavedResource({ gateway: gateway.savedOutputs, expected: grant.preview,
          sceneId: getTarget()?.sceneId ?? "programming", workspaceId, signal: checkController.signal });
        if (!valid()) return;
        status.textContent = t("Verified saved file: {path}").replace("{path}", receipt.relativePath);
        notify(status.textContent); controls.replaceChildren(); close.textContent = t("Close");
      } catch {
        if (valid()) status.textContent = t("The saved file could not be verified. The save may still have completed. Check the original project before saving again; no write was retried.");
      } finally { checking = false; if (valid() && control) control.disabled = false; }
    }
    void prepare();
  }
  return { open, clear, destroy() { active = false; clear(); } };
}
