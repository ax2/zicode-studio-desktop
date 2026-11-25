import { t } from "../../i18n.js";
import { checksumReviewManifestWire, checksumReviewResult } from "./checksum-review-result.js";
import { createFileDigestManifestGenerate } from "./file-digest-manifest-generate.js";
import { createChecksumReadProgress } from "./checksum-read-progress.js";
import { createManifestFileInput } from "./manifest-file-input.js";
import { invokeViewCapability } from "./plugin-view-capability-call.js";

const profile = "resource.local-directory.checksum.preview1";
const generateProfile = "resource.local-directory.checksum.generate.preview1";
const filesOwner = { pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash" };
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
    if (!/^[0-9a-f]{64} [ *].+$/iu.test(line) || expected !== line.slice(0, 64).toLowerCase() ||
        name !== line.slice(66) || (actual === null
          ? status !== "missing" && status !== "read_error"
          : typeof actual !== "string" || !/^[0-9a-f]{64}$/u.test(actual) || status !== (actual === expected ? "match" : "mismatch"))) {
      throw new Error("invalid_manifest_review");
    }
    return { name, expected, actual, status };
  });
}

function selectionNames(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 &&
    value.every(name => typeof name === "string" && name.length > 0 && name.length <= 255 && !/[\\/]/u.test(name)) &&
    new Set(value.map(name => name.toLowerCase())).size === value.length;
}

function digestSelection(result, names) {
  const files = result?.files;
  if (result?.schemaVersion !== 1 || result.profile !== generateProfile || !Array.isArray(files) ||
      files.length !== names.length || !files.every((file, index) => file?.name === names[index] && /^[0-9a-f]{64}$/u.test(file.sha256))) {
    throw new Error("invalid_checksum_selection");
  }
  return files.map(({ name, sha256 }) => ({ name, sha256 }));
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (tag === "button") node.type = "button";
  return node;
}

export function createChecksumFolderReview({ container, gateway, getTarget, isCurrent, isBlocked, onBusy }) {
  const api = gateway.checksumFolders;
  if (!api || typeof gateway.searchTools !== "function") return null;
  const root = element("details", "file-digest-manifest-review");
  const title = element("summary"), fileSlot = element("div"), input = element("textarea", "ui-textarea");
  const bar = element("div", "ui-toolbar file-digest-manifest-actions");
  const choose = element("button", "ui-button ui-button--secondary");
  const chooseFiles = element("button", "ui-button ui-button--secondary");
  const verify = element("button", "ui-button ui-button--secondary");
  const cancel = element("button", "ui-button ui-button--secondary");
  const status = element("p"), summary = element("bdi"), list = element("ul");
  status.setAttribute("role", "status"); summary.setAttribute("translate", "no");
  input.rows = 4; input.maxLength = 32768; input.setAttribute("translate", "no");
  bar.append(choose, chooseFiles, verify, cancel);
  root.append(title, fileSlot, input, bar, summary, status);
  const progress = createChecksumReadProgress(root);
  root.append(list);
  container.append(root);

  let active = true, pending = null, revision = 0, imported = false, generating = false, statusKey = "", rows = [];
  const file = createManifestFileInput({ container: fileSlot, isCurrent: () => active && isCurrent(),
    getRevision: () => revision, onContent: text => { input.value = text; edited(); },
    onBusy: busy => { imported = busy; if (active) { reportBusy(); refresh(); } },
  });
  const current = job => active && isCurrent() && pending === job && !job.cancelled;
  function reportBusy() { onBusy(Boolean(pending) || imported || generating); }
  const generator = createFileDigestManifestGenerate({
    container: root, gateway, getTarget, isCurrent: () => active && isCurrent(),
    isBlocked: () => pending !== null || imported || isBlocked(),
    onBusy: busy => {
      if (generating === busy) return;
      generating = busy;
      if (active) { reportBusy(); refresh(); }
    },
    onManifest: text => { input.value = text; revision++; refresh(); },
    verifySources: async valid => {
      const sceneId = getTarget()?.sceneId ?? "programming";
      if (!valid()) throw new Error("file_report_unavailable");
      const page = await gateway.searchTools(sceneId, { pluginId: filesOwner.pluginId });
      const source = await gateway.loadTool(sceneId, { ...filesOwner, revision: page.revision });
      if (!valid() || !source.enabled || source.pluginId !== filesOwner.pluginId ||
          source.capability?.id !== filesOwner.capabilityId || source.revision !== page.revision ||
          !source.permissions?.some(permission => permission.name === "resource.read" && permission.granted === true)) {
        throw new Error("file_report_unavailable");
      }
    },
  });

  function refresh() {
    const blocked = pending !== null || generating || isBlocked();
    choose.disabled = blocked || imported || !input.value.trim();
    chooseFiles.hidden = typeof api.prepareFiles !== "function";
    chooseFiles.disabled = blocked || imported;
    input.disabled = blocked || imported;
    verify.hidden = pending?.phase !== "confirm";
    cancel.hidden = !pending;
    cancel.disabled = pending?.cancelled === true;
    file.setDisabled(blocked);
    generator.refresh();
  }

  function render() {
    title.textContent = t("SHA256SUMS files and folders");
    input.setAttribute("aria-label", t("SHA256SUMS manifest text"));
    choose.textContent = t("Choose folder to verify");
    chooseFiles.textContent = t("Choose files to generate SHA256SUMS");
    verify.textContent = pending?.mode === "generate" ? t("Confirm and generate SHA256SUMS") : t("Confirm and verify folder");
    cancel.textContent = t("Cancel");
    status.textContent = statusKey ? t(statusKey) : "";
    summary.textContent = pending?.phase === "confirm" ? pending.displayName ?? "" : "";
    const selected = pending?.files?.map(name => ({ name })) ?? rows;
    list.replaceChildren(...selected.map(row => {
      const item = element("li"), name = element("bdi");
      name.textContent = row.name;
      name.setAttribute("translate", "no");
      item.append(name);
      if (row.status) item.append(` · ${t(verdict[row.status])}`);
      return item;
    }));
    refresh();
  }

  function update() { reportBusy(); render(); }
  function edited() { revision++; statusKey = ""; rows = []; generator.clear(); render(); }
  const cancelGrant = async (job, grantId = job.grantId) => {
    if (grantId) await api.cancel(job.target.workspaceId, job.owner, grantId).catch(() => {});
  };

  input.addEventListener("input", edited);
  async function select(mode) {
    if (!active || !isCurrent() || pending || imported || generating || isBlocked()) return;
    const manifest = input.value, target = getTarget();
    if (mode === "review" && (!manifest.trim() || new TextEncoder().encode(manifest).length > 32768)) {
      statusKey = "Manifest must be nonempty UTF-8 text up to 32 KiB."; render(); return;
    }
    const owner = { runtimeId: target.instanceId, sessionId: target.sessionId, ...filesOwner };
    const job = { owner, manifest, target, mode, phase: "choose" };
    generator.clear();
    pending = job;
    rows = [];
    statusKey = "";
    update();
    try {
      const preview = mode === "generate"
        ? await api.prepareFiles(target.workspaceId, owner)
        : await api.prepare(target.workspaceId, owner, manifest);
      if (preview === null) return;
      const grantId = /^[0-9a-f-]{36}$/u.test(preview?.grantId ?? "") ? preview.grantId : null;
      const validPreview = mode === "generate"
        ? preview?.profile === generateProfile && preview.read === false && selectionNames(preview.files)
        : preview?.profile === profile && preview.entryNamesRead === false &&
          typeof preview.displayName === "string" && !/[\\/]/u.test(preview.displayName);
      if (!current(job) || !grantId || !validPreview || preview.schemaVersion !== 1 ||
          preview.confirmed !== false || Object.keys(owner).some(key => preview.owner?.[key] !== owner[key])) {
        await cancelGrant(job, grantId);
        if (current(job)) throw new Error("invalid_checksum_folder");
        return;
      }
      Object.assign(job, { grantId, phase: "confirm", displayName: preview.displayName,
        files: mode === "generate" ? preview.files.slice() : null });
      statusKey = mode === "generate"
        ? "Confirm reading the selected files to generate the manifest."
        : "Confirm reading the listed files from the selected folder.";
    } catch {
      if (current(job)) statusKey = mode === "generate"
        ? "Could not prepare manifest generation. Choose up to 64 files from one folder."
        : "Could not prepare folder verification. Check the manifest and folder access.";
    } finally {
      if (pending === job) { if (job.phase !== "confirm") pending = null; update(); }
    }
  }
  choose.onclick = () => select("review");
  chooseFiles.onclick = () => select("generate");

  verify.onclick = async () => {
    const job = pending;
    if (!job || !current(job) || job.phase !== "confirm") return;
    job.phase = "verify";
    statusKey = job.mode === "generate" ? "Reading the selected files…" : "Verifying files in the selected folder…";
    render();
    try {
      const result = await readFiles(job);
      if (!current(job)) return;
      if (job.mode === "generate") {
        const files = digestSelection(result, job.files);
        pending = null;
        statusKey = "";
        update();
        generator.show(files);
        await generator.generate();
        return;
      }
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
      if (current(job)) statusKey = job.mode === "generate"
        ? "Manifest generation failed. Check file access and the checksum plugin."
        : "Manifest review failed. Check the manifest, file access and checksum plugin.";
    } finally {
      if (pending === job) { pending = null; update(); }
    }
  };

  async function readFiles(job) {
    const { owner, grantId, target: { workspaceId } } = job;
    const total = job.files?.length ?? checksumReviewManifestWire(job.manifest).split("\n").length;
    const stop = typeof api.progress === "function"
      ? progress.start(() => api.progress(workspaceId, owner, grantId), grantId, total, () => current(job))
      : null;
    try {
      return await api.commit(workspaceId, owner, grantId);
    } finally {
      stop?.();
    }
  }

  function abort(job) {
    job.cancelled = true;
    progress.stop();
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
    generator.destroy();
    window.removeEventListener("zicode:locale-changed", render);
    root.remove();
  } };
}
