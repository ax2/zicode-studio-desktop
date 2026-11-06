import { t } from "../../i18n.js";
import { renderResourceFileList } from "./plugin-resource-file-list.js";
import { uploadConfirmedResource } from "./plugin-resource-upload.js";
import { confirmProjectResource, prepareProjectResource } from "./project-file-resource.js";

const MAX_BYTES = 32 * 1024 * 1024;
const validEntryName = value => typeof value === "string" && value.length > 0 && !/[\\/:]/u.test(value) &&
  ![...value].some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159));

// Only capabilities declaring resourceInputMax use this trusted-parent control.
export function createMultiResourceSelection({ container, plugin, target, gateway, isCurrent,
  onResource, catalogRevision, maxResources, minResources = 1, resourceLabels = [] }) {
  const panel = document.createElement("section");
  panel.className = "plugin-resource-selection";
  panel.setAttribute("aria-label", t("Studio resource selection"));
  const title = document.createElement("strong");
  title.textContent = t("Share files with this tool");
  const description = document.createElement("p");
  const describe = () => {
    description.textContent = minResources === maxResources
      ? t("Choose exactly {count} files in the required order, then confirm. Nothing runs until you execute the tool.").replace("{count}", String(maxResources))
      : t("Choose up to {count} files, then confirm. The total must be at most 32 MiB. Nothing runs until you execute the tool.").replace("{count}", String(maxResources));
  };
  describe();
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.className = "ui-input";
  input.setAttribute("aria-label", t("Choose files for the plugin"));
  const opened = typeof gateway.projectFiles?.entries === "function" ? document.createElement("button") : null;
  if (opened) {
    opened.type = "button";
    opened.className = "ui-button ui-button--secondary";
    opened.hidden = true;
  }
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
  panel.append(title, description, ...(opened ? [opened] : []), input, list, confirm, cancel, status);
  container.prepend(panel);

  let active = true, revision = 0, entryRequest = 0, entryPaths = [], uploading = false;
  let selected = [], granted = [], projectPreviews = [];
  const allowedSelection = () => selected.length >= minResources && selected.length <= maxResources &&
    selected.every(file => Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= MAX_BYTES) &&
    Number.isSafeInteger(selected.reduce((sum, file) => sum + file.size, 0)) &&
    selected.reduce((sum, file) => sum + file.size, 0) <= MAX_BYTES;
  const owner = { runtimeId: target.instanceId, sessionId: target.sessionId,
    pluginId: plugin.id, capabilityId: plugin.capabilities[0].id };
  const valid = token => active && token === revision && isCurrent();
  const renderFiles = () => renderResourceFileList(list, { files: selected.slice(0, maxResources), labels: resourceLabels, busy: uploading,
    onMove: (index, step) => {
      const next = index + step;
      if (!active || uploading || !isCurrent() || next < 0 || next >= selected.length) return;
      release();
      [selected[index], selected[next]] = [selected[next], selected[index]];
      renderFiles();
      confirm.disabled = !allowedSelection();
      status.textContent = t("Input order changed. Confirm sharing again before running the tool.");
    } });
  function release() {
    if (!granted.length) return;
    const old = granted;
    granted = [];
    onResource(null);
    for (const access of old) void gateway.revokeResource(access).catch(() => {
      if (active && isCurrent()) status.textContent = t("Release was not confirmed. The resource will expire automatically.");
    });
  }
  function cancelProjectPreviews() {
    const old = projectPreviews;
    projectPreviews = [];
    for (const preview of old) void gateway.projectFiles.cancel(preview.owner, preview.grantId).catch(() => {});
  }
  function reset({ clearInput = true } = {}) {
    revision++;
    selected = [];
    cancelProjectPreviews();
    if (clearInput) input.value = "";
    list.replaceChildren();
    confirm.disabled = true;
    release();
  }
  function refreshOpenedSelection() {
    if (!opened) return;
    const request = ++entryRequest;
    entryPaths = [];
    opened.hidden = true;
    void gateway.projectFiles.entries(target.workspaceId).then(paths => {
      if (!active || !isCurrent() || request !== entryRequest) return;
      entryPaths = Array.isArray(paths) && paths.length >= Math.max(2, minResources) && paths.length <= maxResources &&
        paths.every(validEntryName) &&
        new Set(paths).size === paths.length ? paths : [];
      opened.hidden = entryPaths.length === 0;
      opened.textContent = t("Use opened selection ({count} files)").replace("{count}", String(entryPaths.length));
    }).catch(() => { if (active && request === entryRequest) { entryPaths = []; opened.hidden = true; } });
  }
  if (opened) {
    refreshOpenedSelection();
    window.addEventListener("zicode:entry-changed", handleEntryChanged);
    opened.addEventListener("click", async () => {
      if (uploading || !active || !isCurrent() || !entryPaths.length) return;
      reset();
      uploading = true;
      const token = ++revision;
      opened.disabled = input.disabled = true;
      panel.setAttribute("aria-busy", "true");
      try {
        for (const path of entryPaths) {
          const preview = await prepareProjectResource({ api: gateway.projectFiles,
            workspaceId: target.workspaceId, owner, isCurrent: () => valid(token), relativePath: path });
          if (!preview || !valid(token)) throw new Error("selection_changed");
          projectPreviews.push(preview);
        }
        const total = projectPreviews.reduce((sum, preview) => sum + preview.byteLength, 0);
        if (!Number.isSafeInteger(total) || total > MAX_BYTES) throw new Error("selection_too_large");
        selected = projectPreviews.map(preview => ({ name: preview.relativePath,
          size: preview.byteLength, projectPreview: preview }));
        renderFiles();
        confirm.disabled = !allowedSelection();
        status.textContent = t("Selected {count} files. Confirm sharing before running the tool.")
          .replace("{count}", String(selected.length));
      } catch {
        if (valid(token)) {
          reset();
          status.textContent = t("Could not prepare opened files. Choose the files again.");
        }
      } finally {
        uploading = false;
        if (active && isCurrent()) { panel.removeAttribute("aria-busy"); opened.disabled = input.disabled = false; renderFiles(); }
      }
    });
  }
  function handleEntryChanged() { reset(); refreshOpenedSelection(); }
  input.addEventListener("change", () => {
    if (uploading || !active || !isCurrent()) return;
    const files = Array.from(input.files ?? []);
    reset({ clearInput: false });
    selected = files;
    const allowed = allowedSelection();
    renderFiles();
    confirm.disabled = !allowed;
    status.textContent = allowed ? t("Selected {count} files. Confirm sharing before running the tool.")
      .replace("{count}", String(selected.length)) : selected.length
        ? (selected.length < minResources ? t("Choose at least {count} files before confirming.").replace("{count}", String(minResources))
          : t("Choose at most {count} files totaling up to 32 MiB.").replace("{count}", String(maxResources))) : "";
  });
  cancel.addEventListener("click", () => {
    reset();
    status.textContent = uploading ? t("File sharing canceled. Waiting for preparation to finish.") : t("File sharing canceled.");
    input.focus();
  });
  confirm.addEventListener("click", async () => {
    if (confirm.disabled || uploading || !active || !isCurrent() || !selected.length) return;
    uploading = true;
    renderFiles();
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
        const result = file.projectPreview
          ? await confirmProjectResource({ api: gateway.projectFiles, preview: file.projectPreview,
            gateway, isCurrent: () => valid(token) })
          : await uploadConfirmedResource({ file, owner, gateway, catalogRevision,
            isCurrent: () => valid(token) });
        published.push(result);
        if (file.projectPreview) projectPreviews = projectPreviews.filter(item => item !== file.projectPreview);
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
        cancelProjectPreviews();
        input.value = "";
        list.replaceChildren();
        status.textContent = t("File sharing failed. Choose the files again to retry.");
      }
    } finally {
      if (!handedOff) {
        cancelProjectPreviews();
        for (const item of published) void gateway.revokeResource(item.access).catch(() => {});
      }
      uploading = false;
      if (active && isCurrent()) {
        panel.removeAttribute("aria-busy");
        input.disabled = false;
        renderFiles();
        if (!valid(token)) status.textContent = t("File sharing canceled.");
      }
    }
  });
  function handleLocaleChange() {
    describe(); renderFiles();
    title.textContent = t("Share files with this tool");
    confirm.textContent = t("Confirm file sharing");
    cancel.textContent = t("Cancel file sharing");
  }
  window.addEventListener("zicode:locale-changed", handleLocaleChange);
  return { getDisplayNames() {
    return active && granted.length === selected.length && granted.length > 0
      ? selected.map(file => typeof file.name === "string" ? file.name : "") : [];
  }, destroy() { active = false; entryRequest++; reset();
    window.removeEventListener("zicode:locale-changed", handleLocaleChange);
    if (opened) window.removeEventListener("zicode:entry-changed", handleEntryChanged);
    panel.remove(); } };
}
