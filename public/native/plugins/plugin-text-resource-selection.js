import { t, translateDocument } from "../../i18n.js";
import { uploadConfirmedResource } from "./plugin-resource-upload.js";

const MAX_BYTES = 32 * 1024 * 1024;

// The trusted parent converts explicitly confirmed text into ordinary scoped resources.
export function createTextResourceSelection({ container, plugin, target, gateway, isCurrent,
  onResource, catalogRevision, resourceLabels, initialValues = [] }) {
  const panel = document.createElement("section");
  panel.className = "plugin-resource-selection";
  const fields = resourceLabels.map((label, index) => {
    const wrapper = document.createElement("label");
    const title = document.createElement("span");
    const input = document.createElement("textarea");
    input.className = "ui-textarea";
    input.rows = 3;
    // Register the untranslated accessibility source before the shell's observer
    // sees its initial Chinese translation and remembers it as the source key.
    input.setAttribute("aria-label", label);
    translateDocument(input);
    input.value = initialValues[index] ?? "";
    wrapper.append(title, input); panel.append(wrapper);
    return { title, input, label };
  });
  const confirm = document.createElement("button");
  confirm.type = "button"; confirm.className = "ui-button ui-button--primary";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "ui-button ui-button--secondary";
  const controls = document.createElement("div"); controls.className = "ui-toolbar";
  controls.append(confirm, cancel);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  panel.append(controls, status); container.append(panel);
  let active = true, revision = 0, busy = false, grants = [];
  let statusKey = "Confirm text sharing before running the tool. Empty text is allowed.";
  const owner = { runtimeId: target.instanceId, sessionId: target.sessionId,
    pluginId: plugin.id, capabilityId: plugin.capabilities[0].id };
  const valid = token => active && token === revision && isCurrent();
  const render = () => {
    for (const field of fields) {
      field.title.textContent = t(field.label);
      field.input.setAttribute("aria-label", t(field.label));
      field.input.disabled = busy;
    }
    confirm.textContent = t("Confirm text sharing"); confirm.disabled = busy;
    cancel.textContent = t("Cancel text sharing");
    status.textContent = t(statusKey);
    panel.setAttribute("aria-busy", String(busy));
  };
  const release = () => {
    const old = grants; grants = [];
    onResource(null);
    for (const access of old) void gateway.revokeResource(access).catch(() => {});
  };
  const invalidate = () => {
    revision++; release();
    statusKey = "Text changed. Confirm sharing again before running the tool.";
    render();
  };
  for (const field of fields) field.input.addEventListener("input", invalidate);
  confirm.addEventListener("click", async () => {
    if (!active || busy || !isCurrent()) return;
    revision++; release();
    const token = revision, encoded = fields.map(field => new TextEncoder().encode(field.input.value));
    if (encoded.reduce((sum, bytes) => sum + bytes.length, 0) > MAX_BYTES) {
      statusKey = "Text exceeds the 32 MiB sharing limit."; render(); return;
    }
    busy = true; statusKey = "Sharing text…"; render();
    const completed = [];
    try {
      for (const bytes of encoded) {
        const shared = await uploadConfirmedResource({ file: { size: bytes.length, type: "text/plain",
          arrayBuffer: async () => bytes.buffer }, owner, gateway, catalogRevision,
          isCurrent: () => valid(token) });
        completed.push(shared);
      }
      if (!valid(token)) throw new Error("resource_selection_changed");
      grants = completed.map(item => item.access);
      const [first, ...rest] = completed;
      onResource({ ...first.reference, additionalResources: rest.map(item => ({
        resourceId: item.reference.resourceId, contentVersion: item.reference.contentVersion })) });
      statusKey = "Text shared. Fill in the parameters and execute the tool.";
    } catch {
      for (const item of completed) void gateway.revokeResource(item.access).catch(() => {});
      if (valid(token)) statusKey = "Could not share text. Inputs are kept; confirm sharing to try again.";
    } finally {
      busy = false;
      if (active) render();
    }
  });
  cancel.addEventListener("click", () => {
    revision++; release(); statusKey = "Text sharing canceled. Inputs are kept."; render();
  });
  const locale = () => render();
  window.addEventListener("zicode:locale-changed", locale);
  render();
  return { getValues: () => fields.map(field => field.input.value), destroy() {
    if (!active) return;
    active = false; revision++; release(); window.removeEventListener("zicode:locale-changed", locale); panel.remove();
  } };
}
