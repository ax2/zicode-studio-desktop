import { t } from "../../i18n.js";
import { uploadConfirmedResource } from "./plugin-resource-upload.js";

const MAX_BYTES = 32 * 1024 * 1024;

// Only capabilities declaring resourceInputMax use this trusted-parent control.
export function createMultiResourceSelection({ container, plugin, target, gateway, isCurrent,
  onResource, catalogRevision, maxResources }) {
  const panel = document.createElement("section");
  panel.className = "plugin-resource-selection";
  panel.setAttribute("aria-label", t("Studio resource selection"));
  const title = document.createElement("strong");
  title.textContent = t("Share files with this tool");
  const description = document.createElement("p");
  description.textContent = t("Choose up to {count} files, then confirm. The total must be at most 32 MiB. Nothing runs until you execute the tool.")
    .replace("{count}", String(maxResources));
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.className = "ui-input";
  input.setAttribute("aria-label", t("Choose files for the plugin"));
  const list = document.createElement("ul");
  list.className = "plugin-resource-file-list";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "ui-button ui-button--primary";
  confirm.textContent = t("Confirm file sharing");
  confirm.disabled = true;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button ui-button--secondary";
  cancel.textContent = t("Cancel file sharing");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(title, description, input, list, confirm, cancel, status);
  container.prepend(panel);

  let active = true, revision = 0, uploading = false, selected = [], granted = [];
  const owner = { runtimeId: target.instanceId, sessionId: target.sessionId,
    pluginId: plugin.id, capabilityId: plugin.capabilities[0].id };
  const valid = token => active && token === revision && isCurrent();
  function release() {
    if (!granted.length) return;
    const old = granted;
    granted = [];
    onResource(null);
    for (const access of old) void gateway.revokeResource(access).catch(() => {
      if (active && isCurrent()) status.textContent = t("Release was not confirmed. The resource will expire automatically.");
    });
  }
  function reset({ clearInput = true } = {}) {
    revision++;
    selected = [];
    if (clearInput) input.value = "";
    list.replaceChildren();
    confirm.disabled = true;
    release();
  }
  input.addEventListener("change", () => {
    if (uploading || !active || !isCurrent()) return;
    const files = Array.from(input.files ?? []);
    reset({ clearInput: false });
    selected = files;
    const total = selected.reduce((sum, file) => sum + file.size, 0);
    const allowed = selected.length > 0 && selected.length <= maxResources &&
      selected.every(file => Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= MAX_BYTES) &&
      Number.isSafeInteger(total) && total <= MAX_BYTES;
    for (const file of selected.slice(0, maxResources)) {
      const item = document.createElement("li");
      item.textContent = `${file.name} · ${file.size} ${t("bytes")}`;
      list.append(item);
    }
    confirm.disabled = !allowed;
    status.textContent = allowed ? t("Selected {count} files. Confirm sharing before running the tool.")
      .replace("{count}", String(selected.length)) : selected.length
        ? t("Choose at most {count} files totaling up to 32 MiB.").replace("{count}", String(maxResources)) : "";
  });
  cancel.addEventListener("click", () => {
    reset();
    status.textContent = uploading ? t("File sharing canceled. Waiting for preparation to finish.") : t("File sharing canceled.");
    input.focus();
  });
  confirm.addEventListener("click", async () => {
    if (confirm.disabled || uploading || !active || !isCurrent() || !selected.length) return;
    uploading = true;
    const token = ++revision;
    const files = [...selected];
    const published = [];
    let handedOff = false;
    confirm.disabled = input.disabled = true;
    panel.setAttribute("aria-busy", "true");
    try {
      for (const [index, file] of files.entries()) {
        status.textContent = t("Sharing file {current} of {total}…")
          .replace("{current}", String(index + 1)).replace("{total}", String(files.length));
        const result = await uploadConfirmedResource({ file, owner, gateway, catalogRevision,
          isCurrent: () => valid(token) });
        published.push(result);
        if (!valid(token)) return;
      }
      if (!valid(token)) return;
      const [first, ...rest] = published;
      onResource({ ...first.reference, ...(rest.length ? { additionalResources: rest.map(item => ({
        resourceId: item.reference.resourceId, contentVersion: item.reference.contentVersion,
      })) } : {}) });
      granted = published.map(item => item.access);
      handedOff = true;
      status.textContent = t("Confirmed files shared. You can revoke them with Cancel.");
    } catch {
      if (valid(token)) {
        selected = [];
        input.value = "";
        list.replaceChildren();
        status.textContent = t("File sharing failed. Choose the files again to retry.");
      }
    } finally {
      if (!handedOff) for (const item of published)
        void gateway.revokeResource(item.access).catch(() => {});
      uploading = false;
      if (active && isCurrent()) {
        panel.removeAttribute("aria-busy");
        input.disabled = false;
        if (!valid(token)) status.textContent = t("File sharing canceled.");
      }
    }
  });
  return { destroy() { active = false; reset(); panel.remove(); } };
}
