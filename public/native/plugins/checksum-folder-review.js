import { t } from "../../i18n.js";
import { checksumReviewManifestWire, checksumReviewResult } from "./checksum-review-result.js";
import { createManifestFileInput } from "./manifest-file-input.js";
import { invokeViewCapability } from "./plugin-view-capability-call.js";

const profile = "resource.local-directory.checksum.preview1";
const pluginId = "com.zicode.devtools.checksum-manifest";
const capabilityId = "devtools.checksum-manifest.review";
const verdict = {
  match: "Digest matches",
  mismatch: "Digest does not match",
  missing: "File missing",
  read_error: "Could not read file",
};

export function validateChecksumFolder(result, manifest) {
  const lines = checksumReviewManifestWire(manifest).split("\n");
  if (result?.schemaVersion !== 1 || result.profile !== profile || !Array.isArray(result.entries) ||
      result.entries.length !== lines.length || lines.length > 64) throw new Error("invalid_manifest_review");
  return result.entries.map(({ name, expected, actual, status }, index) => {
    const line = lines[index];
    if (!/^[0-9a-f]{64}  .+$/iu.test(line) || expected !== line.slice(0, 64).toLowerCase() ||
        name !== line.slice(66) || (actual === null
          ? status !== "missing" && status !== "read_error"
          : typeof actual !== "string" || !/^[0-9a-f]{64}$/u.test(actual) || status !== (actual === expected ? "match" : "mismatch"))) {
      throw new Error("invalid_manifest_review");
    }
    return { name, expected, actual, status };
  });
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (tag === "button") node.type = "button";
  return node;
}

export function createChecksumFolderReview({ container, gateway, getTarget, isCurrent, isBlocked, onBusy }) {
  const api = gateway.projectDirectories;
  if (!api?.prepareChecksum || typeof gateway.searchTools !== "function") return null;
  const root = element("details", "file-digest-manifest-review");
  const title = element("summary"), fileSlot = element("div"), input = element("textarea", "ui-textarea");
  const bar = element("div", "ui-toolbar file-digest-manifest-actions");
  const choose = element("button", "ui-button ui-button--secondary");
  const verify = element("button", "ui-button ui-button--secondary");
  const cancel = element("button", "ui-button ui-button--secondary");
  const status = element("p"), summary = element("p"), list = element("ul");
  status.setAttribute("role", "status"); summary.setAttribute("translate", "no");
  input.rows = 4; input.maxLength = 32768; input.setAttribute("translate", "no");
  bar.append(choose, verify, cancel);
  root.append(title, fileSlot, input, bar, summary, status, list);
  container.append(root);

  let active = true, pending = null, revision = 0, imported = false, statusKey = "", rows = [];
  const file = createManifestFileInput({ container: fileSlot, isCurrent: () => active && isCurrent(),
    getRevision: () => revision, onContent: text => { input.value = text; edited(); },
    onBusy: busy => { imported = busy; if (active) { onBusy(Boolean(pending) || imported); refresh(); } },
  });
  const current = job => active && isCurrent() && pending === job && !job.cancelled;

  function refresh() {
    const blocked = pending !== null || isBlocked();
    choose.disabled = blocked || imported || !input.value.trim();
    input.disabled = blocked || imported;
    verify.hidden = pending?.phase !== "confirm";
    cancel.hidden = !pending;
    cancel.disabled = pending?.cancelled === true;
    file.setDisabled(blocked);
  }

  function render() {
    title.textContent = t("Verify SHA256SUMS against a folder");
    input.setAttribute("aria-label", t("SHA256SUMS manifest text"));
    choose.textContent = t("Choose folder to verify");
    verify.textContent = t("Confirm and verify folder");
    cancel.textContent = t("Cancel");
    status.textContent = statusKey ? t(statusKey) : "";
    summary.textContent = pending?.phase === "confirm" && pending.path !== "." ? pending.path.split("/").at(-1) : "";
    list.replaceChildren(...rows.map(row => {
      const item = element("li"), name = element("bdi");
      name.textContent = row.name;
      name.setAttribute("translate", "no");
      item.append(name, ` · ${t(verdict[row.status])}`);
      return item;
    }));
    refresh();
  }

  function update() { onBusy(Boolean(pending) || imported); render(); }
  function edited() { revision++; statusKey = ""; rows = []; render(); }
  const cancelGrant = async (job, grantId = job.grantId) => {
    if (grantId) await api.cancel(job.owner, grantId).catch(() => {});
  };

  input.addEventListener("input", edited);
  choose.onclick = async () => {
    if (!active || !isCurrent() || pending || imported || isBlocked()) return;
    const manifest = input.value, target = getTarget();
    if (!manifest.trim() || new TextEncoder().encode(manifest).length > 32768) {
      statusKey = "Manifest must be nonempty UTF-8 text up to 32 KiB."; render(); return;
    }
    const owner = { runtimeId: target.instanceId, sessionId: target.sessionId, pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash" };
    const job = { owner, manifest, target, phase: "choose" };
    pending = job;
    rows = [];
    statusKey = "";
    update();
    try {
      const path = await api.choose(target.workspaceId);
      if (!current(job) || typeof path !== "string" || !path) return;
      const preview = await api.prepareChecksum(owner, path, manifest);
      const grantId = /^[0-9a-f-]{36}$/u.test(preview?.grantId ?? "") ? preview.grantId : null;
      if (!current(job) || !grantId || preview.profile !== profile || preview.schemaVersion !== 1 ||
          preview.relativePath !== path || preview.confirmed !== false || preview.entryNamesRead !== false ||
          Object.keys(owner).some(key => preview.owner?.[key] !== owner[key])) {
        await cancelGrant(job, grantId);
        if (current(job)) throw new Error("invalid_checksum_folder");
        return;
      }
      Object.assign(job, { grantId, phase: "confirm", path });
      statusKey = "Confirm reading the listed files from the selected folder.";
    } catch {
      if (current(job)) statusKey = "Could not prepare folder verification. Check the manifest and folder access.";
    } finally {
      if (pending === job) { if (job.phase !== "confirm") pending = null; update(); }
    }
  };

  verify.onclick = async () => {
    const job = pending;
    if (!job || !current(job) || job.phase !== "confirm") return;
    job.phase = "verify";
    statusKey = "Verifying files in the selected folder…";
    render();
    try {
      const result = await api.commitChecksum(job.owner, job.grantId);
      if (!current(job)) return;
      const report = validateChecksumFolder(result, job.manifest);
      const sceneId = job.target.sceneId ?? "programming";
      const page = await gateway.searchTools(sceneId, { pluginId });
      const tool = page?.items?.find(item => item.pluginId === pluginId && item.capabilityId === capabilityId && item.enabled && item.runtime === "wasi");
      if (!tool || !current(job)) throw new Error("manifest_tool_unavailable");
      // Batches keep Unicode names and their duplicate wire representations within the existing Worker envelope.
      for (let index = 0; index < report.length; index += 16) {
        const batch = report.slice(index, index + 16);
        const manifest = batch.map(row => `${row.expected}  ${row.name}`).join("\n");
        const files = batch.flatMap(row => row.actual === null ? [] : [{ name: row.name, sha256: row.actual }]);
        job.worker = { cancelled: false };
        const response = await invokeViewCapability({
          gateway, scope: { sceneId, workspaceId: job.target.workspaceId, pluginId, capabilityId },
          input: { manifest, files }, pluginVersion: tool.version, boundRevision: page.revision,
          cancelRequired: true, requestState: job.worker, isCurrent: () => current(job),
        });
        if (!current(job)) return;
        checksumReviewResult(response.result, manifest, files);
      }
      rows = report;
      statusKey = "Manifest review completed. Original files were not changed.";
    } catch {
      if (current(job)) statusKey = "Manifest review failed. Check the manifest, file access and checksum plugin.";
    } finally {
      if (pending === job) { pending = null; update(); }
    }
  };

  function abort(job) {
    job.cancelled = true;
    void cancelGrant(job);
    if (job.worker) {
      job.worker.cancelled = true;
      void job.worker.cancel?.();
    }
  }
  cancel.onclick = () => {
    const job = pending;
    if (!job) return;
    abort(job);
    statusKey = "";
    if (job.phase === "confirm") pending = null;
    update();
  };

  window.addEventListener("zicode:locale-changed", render);
  render();
  return { refresh, destroy() {
    active = false;
    if (pending) abort(pending);
    file.destroy();
    window.removeEventListener("zicode:locale-changed", render);
    root.remove();
  } };
}
