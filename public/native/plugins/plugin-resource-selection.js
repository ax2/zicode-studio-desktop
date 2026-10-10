import { t } from "../../i18n.js";
import { uploadConfirmedResource } from "./plugin-resource-upload.js";
import { createSavedOutputPicker } from "./saved-output-picker.js";

export function createPluginResourceSelection({
  container,
  plugin,
  target,
  gateway,
  isCurrent,
  onResource,
  catalogRevision,
}) {
  const panel = document.createElement("section");
  panel.className = "plugin-resource-selection";
  panel.setAttribute("aria-label", t("Studio resource selection"));
  let revision = 0;
  let active = true;
  let uploading = false;
  let selected = null;
  let granted = null;
  const label = document.createElement("strong");
  label.textContent = t("Studio · Share a file with this plugin");
  const input = document.createElement("input");
  input.type = "file";
  input.className = "ui-input";
  input.setAttribute("aria-label", t("Choose a file for the plugin"));
  const capability = document.createElement("select");
  capability.className = "ui-select";
  capability.setAttribute("aria-label", t("Receiving tool"));
  for (const item of plugin.capabilities ?? []) {
    if (typeof item.id !== "string") continue;
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title || item.id;
    capability.append(option);
  }
  const description = document.createElement("p");
  description.textContent = t(
    "Only this plugin and tool can read the confirmed snapshot. Nothing is saved or sent to AI.",
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "ui-button ui-button--primary";
  confirm.textContent = t("Confirm file sharing");
  confirm.disabled = true;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button ui-button--secondary";
  cancel.textContent = t("Cancel file sharing");
  const saved = createSavedOutputPicker({ container: panel, gateway: gateway.savedOutputs, target, isCurrent,
    onSelect: file => {
      if (uploading || !active || !isCurrent()) return;
      revision++; release(); selected = file; input.value = "";
      confirm.disabled = !file || !capability.value;
      status.textContent = file ? t("Selected: {name} · {bytes} bytes · plugin {plugin}")
        .replace("{name}", file.name).replace("{bytes}", file.size).replace("{plugin}", `${plugin.name} ${plugin.version}`) : "";
    },
  });
  function release() {
    if (!granted) return;
    const access = granted;
    granted = null;
    onResource(null);
    void gateway.revokeResource(access).catch(() => {
      if (active && isCurrent())
        status.textContent = t(
          "Release was not confirmed. The resource will expire automatically.",
        );
    });
  }
  function clear() {
    revision += 1;
    saved?.clear();
    selected = null;
    input.value = "";
    input.disabled = uploading;
    capability.disabled = uploading;
    confirm.disabled = true;
    panel.removeAttribute("aria-busy");
    release();
  }
  input.addEventListener("change", () => {
    revision += 1;
    saved?.clear();
    release();
    selected = input.files?.[0] ?? null;
    const allowed = selected && selected.size <= 32 * 1024 * 1024 && capability.value;
    confirm.disabled = !allowed;
    status.textContent = !selected
      ? ""
      : allowed
        ? t("Selected: {name} · {bytes} bytes · plugin {plugin}")
            .replace("{name}", selected.name)
            .replace("{bytes}", selected.size)
            .replace("{plugin}", `${plugin.name} ${plugin.version}`)
        : t("Choose a file up to 32 MiB and a receiving tool.");
  });
  capability.addEventListener("change", () => {
    revision += 1;
    release();
    confirm.disabled =
      uploading || !selected || selected.size > 32 * 1024 * 1024 || !capability.value;
  });
  cancel.addEventListener("click", () => {
    clear();
    status.textContent = t("File sharing canceled.");
    input.focus();
  });
  confirm.addEventListener("click", async () => {
    if (!selected || !isCurrent() || confirm.disabled || uploading) return;
    uploading = true;
    const token = ++revision;
    const valid = () => active && token === revision && isCurrent();
    const owner = {
      runtimeId: target.instanceId,
      sessionId: target.sessionId,
      pluginId: plugin.id,
      capabilityId: capability.value,
    };
    confirm.disabled = true;
    input.disabled = true;
    capability.disabled = true;
    saved?.setDisabled(true);
    panel.setAttribute("aria-busy", "true");
    status.textContent = t("Preparing the confirmed file…");
    try {
      const result = await uploadConfirmedResource({
        file: selected,
        owner,
        gateway,
        catalogRevision,
        isCurrent: valid,
        onProgress: (bytes, total) => {
          if (valid())
            status.textContent = t("Sharing {bytes} of {total} bytes…")
              .replace("{bytes}", bytes)
              .replace("{total}", total);
        },
      });
      if (!valid()) {
        void gateway.revokeResource(result.access).catch(() => {});
        return;
      }
      granted = result.access;
      onResource(result.reference);
      status.textContent = t("Confirmed file shared. You can revoke it with Cancel.");
    } catch {
      if (valid()) status.textContent = t("File sharing failed. Select the file again to retry.");
    } finally {
      uploading = false;
      if (active && isCurrent()) {
        panel.removeAttribute("aria-busy");
        input.disabled = false;
        capability.disabled = false;
        saved?.setDisabled(false);
      }
    }
  });
  panel.prepend(label, description, input, capability);
  panel.append(confirm, cancel, status);
  container.prepend(panel);
  return {
    destroy() {
      active = false;
      clear();
      saved?.destroy();
      panel.remove();
    },
  };
}
