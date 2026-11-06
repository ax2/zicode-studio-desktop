import { createFileDigestManifestGenerate } from "./file-digest-manifest-generate.js";
import { t } from "../../i18n.js";
import { createManifestFileInput } from "./manifest-file-input.js";
import { invokeViewCapability } from "./plugin-view-capability-call.js";
import { createViewCallRecovery } from "./plugin-view-call-recovery.js";
import { checksumReviewFiles, checksumReviewResult, checksumReviewManifestWire } from "./checksum-review-result.js";
const PLUGIN = "com.zicode.devtools.checksum-manifest", CAPABILITY = "devtools.checksum-manifest.review";

// Trusted parent: names/hashes are sent only on the separate review action.
export function createFileDigestManifestReview({ container, gateway, getTarget, isCurrent, verifySources, onBusy = () => {} }) {
  const root = document.createElement("section"), panel = document.createElement("section"), title = document.createElement("h3"), fileContainer = document.createElement("div");
  const hint = document.createElement("p"), input = document.createElement("textarea"), button = document.createElement("button"), status = document.createElement("p"), rows = document.createElement("ul");
  root.className = "file-digest-manifest-review"; panel.hidden = true;
  input.className = "ui-textarea"; input.rows = 4; input.maxLength = 32768; input.setAttribute("translate", "no");
  button.className = "ui-button ui-button--secondary"; button.type = "button"; status.setAttribute("role", "status");
  panel.append(title, hint, fileContainer, input, button, status, rows); root.append(panel); container.append(root);
  let generateBusy = false;
  let active = true, files = null, generation = 0, pending = false, importBusy = false, request = null, statusKey = "", reportRows = [];
  const sync = () => { const callBusy = pending || recovery.locked(CAPABILITY), busy = callBusy || importBusy || generateBusy; button.disabled = busy || !files || !input.value.trim(); input.disabled = busy; fileInput.setDisabled(callBusy || generateBusy); generator.refresh(); onBusy(busy); };
  const listeners = new Set([sync]);
  const recovery = createViewCallRecovery({ container: root, gateway, isCurrent: () => active && isCurrent(), listeners });
  const fileInput = createManifestFileInput({ container: fileContainer, isCurrent: () => active && isCurrent() && files !== null,
    getRevision: () => generation,
    onContent: text => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); },
    onBusy: value => { importBusy = value; if (active) sync(); },
  });
  const generator = createFileDigestManifestGenerate({ container: root, gateway, getTarget, isCurrent: () => active && isCurrent(), verifySources,
    isBlocked: () => pending || importBusy || recovery.locked(CAPABILITY),
    onManifest: text => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); },
    onBusy: value => { if (generateBusy !== value) { generateBusy = value; if (active) sync(); } },
  });
  function render() {
    title.textContent = t("Review SHA256SUMS manifest");
    hint.textContent = t("Review shares the displayed file names and SHA-256 values with the checksum plugin. Entries without a supplied file are not checked for absence on disk.");
    input.setAttribute("aria-label", t("SHA256SUMS manifest text")); button.textContent = t("Review manifest with these files");
    status.textContent = statusKey ? t(statusKey) : "";
    rows.replaceChildren();
    for (const row of reportRows) {
        const item = document.createElement("li"), name = document.createElement("span"), verdict = document.createElement("span");
        name.textContent = row.name; name.setAttribute("translate", "no");
        verdict.textContent = ` · ${t(row.status === "match" ? "Digest matches" : row.status === "mismatch" ? "Digest does not match" : "File not provided")}`;
        item.append(name, verdict); rows.append(item);
      }
  }
  window.addEventListener("zicode:locale-changed", render); render();
  input.addEventListener("input", () => { fileInput.clearNotice(); generation++; reportRows = []; rows.replaceChildren(); statusKey = ""; render(); void request?.cancel?.(); sync(); });
  button.addEventListener("click", async () => {
    if (!active || pending || importBusy || generateBusy || recovery.locked(CAPABILITY) || !files || !isCurrent()) return;
    const captured = ++generation, selected = files, manifest = input.value, target = getTarget();
    const current = () => active && isCurrent() && captured === generation && selected === files;
    if (!manifest.trim() || new TextEncoder().encode(manifest).length > 32768) { statusKey = "Manifest must be nonempty UTF-8 text up to 32 KiB."; render(); return; }
    const inputValue = { manifest: checksumReviewManifestWire(manifest), files: selected };
    if (new TextEncoder().encode(JSON.stringify(inputValue)).length > 46000) { statusKey = "Manifest and file names are too large for one review."; render(); return; }
    fileInput.clearNotice(); pending = true; input.disabled = true; reportRows = []; rows.replaceChildren(); statusKey = "Reviewing manifest…"; render(); sync();
    const state = { cancelled: false }; request = state;
    try {
      await verifySources(current); if (!current()) return;
      const page = await gateway.searchTools(target.sceneId ?? "programming", { pluginId: PLUGIN });
      const tool = page?.items?.find(item => item.pluginId === PLUGIN && item.capabilityId === CAPABILITY && item.enabled && item.runtime === "wasi");
      if (!tool || !current()) throw new Error("manifest_tool_unavailable");
      const response = await invokeViewCapability({ gateway, scope: { sceneId: target.sceneId ?? "programming", workspaceId: target.workspaceId, pluginId: PLUGIN, capabilityId: CAPABILITY },
        input: inputValue, pluginVersion: tool.version, boundRevision: page.revision, cancelRequired: true, requestState: state, isCurrent: current,
        onIssued: call => recovery.issued(call), onDelivered: call => recovery.delivered(call), onUncertain: call => recovery.uncertain(call) });
      if (!current()) return; await verifySources(current); if (!current()) return;
      reportRows = checksumReviewResult(response.result, manifest, selected);
      statusKey = "Manifest review completed. Original files were not changed.";
    } catch { if (current()) statusKey = "Manifest review failed. Check the manifest, file access and checksum plugin."; }
    finally { pending = false; if (request === state) request = null; input.disabled = false; if (active) { render(); sync(); } }
  });
  return {
    show(result, names) { generation++; try { files = checksumReviewFiles(result, names); panel.hidden = false; } catch { files = null; panel.hidden = true; } reportRows = []; rows.replaceChildren(); statusKey = ""; generator.show(files); render(); sync(); },
    clear() { generation++; files = null; generator.clear(); fileInput.clear(); input.value = ""; reportRows = []; rows.replaceChildren(); statusKey = ""; panel.hidden = true; void request?.cancel?.(); render(); sync(); },
    destroy() { if (!active) return; active = false; generation++; void request?.cancel?.(); listeners.delete(sync); fileInput.destroy(); generator.destroy(); recovery.destroy(); window.removeEventListener("zicode:locale-changed", render); onBusy(false); root.remove(); },
  };
}
