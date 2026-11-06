import { t } from "../../i18n.js";
import { invokeViewCapability } from "./plugin-view-capability-call.js";
import { createViewCallRecovery } from "./plugin-view-call-recovery.js";
import { checksumGeneratedResult } from "./checksum-generated-result.js";
import { createTextResultExport } from "./text-result-export.js";
const PLUGIN = "com.zicode.devtools.checksum-manifest", CAPABILITY = "devtools.checksum-manifest.generate";
export function createFileDigestManifestGenerate({ container, gateway, getTarget, isCurrent, verifySources, onManifest, onBusy, isBlocked }) {
  const root = document.createElement("section"), panel = document.createElement("section"), hint = document.createElement("p"), generate = document.createElement("button"), save = document.createElement("button"), status = document.createElement("p"), controls = document.createElement("div");
  generate.type = save.type = "button"; generate.className = save.className = "ui-button ui-button--secondary";
  controls.className = "ui-toolbar file-digest-manifest-actions"; controls.append(generate, save);
  status.setAttribute("role", "status"); panel.append(hint, controls, status); root.append(panel); container.append(root); panel.hidden = true;
  let active = true, files = null, revision = 0, pending = false, choosing = false, request = null, generated = null, statusKey = "";
  const current = token => active && isCurrent() && token === revision && files !== null;
  const sync = () => { const busy = pending || choosing || recovery.locked(CAPABILITY); generate.disabled = busy || isBlocked() || !files; save.disabled = busy || isBlocked() || !generated || !gateway.textExports; onBusy(busy); };
  const listeners = new Set([sync]), recovery = createViewCallRecovery({ container: root, gateway, isCurrent: () => active && isCurrent(), listeners });
  const exporter = gateway.textExports ? createTextResultExport({ api: { ...gateway.textExports,
    commit: async (...args) => { const token = revision; await verifySources(() => current(token)); if (!current(token)) throw new Error("file_report_unavailable"); return gateway.textExports.commit(...args); },
  }, getTarget, isCurrent: () => active && isCurrent() && files !== null }) : null;
  function render() {
    hint.textContent = t("Generate shares the displayed names and SHA-256 values with the checksum plugin. Saving needs a separate destination and confirmation.");
    generate.textContent = t("Generate SHA256SUMS"); save.textContent = t("Save generated manifest as…"); status.textContent = statusKey ? t(statusKey) : "";
  }
  window.addEventListener("zicode:locale-changed", render); render();
  generate.onclick = async () => {
    if (generate.disabled || !active || !isCurrent()) return;
    const token = ++revision, selected = files, target = getTarget(), state = { cancelled: false }, valid = () => current(token) && selected === files;
    exporter?.clear(); generated = null; pending = true; request = state; statusKey = "Generating manifest…"; render(); sync();
    try {
      await verifySources(valid); if (!valid()) return;
      const page = await gateway.searchTools(target.sceneId ?? "programming", { pluginId: PLUGIN });
      const tool = page?.items?.find(item => item.pluginId === PLUGIN && item.capabilityId === CAPABILITY && item.enabled && item.runtime === "wasi");
      if (!tool || !valid()) throw new Error("manifest_generator_unavailable");
      const scope = { sceneId: target.sceneId ?? "programming", workspaceId: target.workspaceId, pluginId: PLUGIN, capabilityId: CAPABILITY };
      const response = await invokeViewCapability({ gateway, scope, input: { files: selected }, captureResult: true, pluginVersion: tool.version, boundRevision: page.revision, cancelRequired: true, requestState: state, isCurrent: valid,
        onIssued: call => recovery.issued(call), onDelivered: call => recovery.delivered(call), onUncertain: call => recovery.uncertain(call) });
      if (!valid()) return; await verifySources(valid); if (!valid()) return;
      const result = await checksumGeneratedResult(response, selected, tool.version); if (!valid()) return;
      generated = { ...result, scope }; onManifest(result.text); statusKey = "Manifest generated. Choose a destination to save a new copy.";
    } catch { if (valid()) statusKey = "Manifest generation failed. Check file access and the checksum plugin."; }
    finally { pending = false; if (request === state) request = null; if (active) { render(); sync(); } }
  };
  save.onclick = async () => {
    if (save.disabled || !generated || !exporter) return;
    const token = revision, selected = generated; choosing = true; sync();
    try { await verifySources(() => current(token)); if (current(token) && selected === generated) await exporter.open(selected.reference, selected.scope, root); }
    catch { if (current(token)) { statusKey = "Manifest generation failed. Check file access and the checksum plugin."; render(); } }
    finally { choosing = false; if (active) sync(); }
  };
  return {
    refresh: sync,
    show(value) { revision++; files = value; generated = null; exporter?.clear(); panel.hidden = !value; statusKey = ""; render(); sync(); },
    clear() { revision++; files = null; generated = null; exporter?.clear(); panel.hidden = true; void request?.cancel?.(); statusKey = ""; render(); sync(); },
    destroy() { active = false; revision++; void request?.cancel?.(); exporter?.destroy(); recovery.destroy(); listeners.delete(sync); window.removeEventListener("zicode:locale-changed", render); onBusy(false); root.remove(); },
  };
}
