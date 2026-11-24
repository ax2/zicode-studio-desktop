import { t } from "../../i18n.js";
import { directoryUsageProfile, isDiskInspector } from "./disk-inspector-result.js";
import { duplicateFilesProfile, isDuplicateFiles } from "./duplicate-files-result.js";

function sameOwner(actual, expected) {
  return (
    actual !== null &&
    typeof actual === "object" &&
    actual.runtimeId === expected.runtimeId &&
    actual.sessionId === expected.sessionId &&
    actual.pluginId === expected.pluginId &&
    actual.capabilityId === expected.capabilityId
  );
}

function validDisplayName(value) {
  return typeof value === "string" && value.length <= 255
    && value !== "." && value !== ".." && !/[\/\\:\p{Cc}]/u.test(value);
}

// Trusted Studio UI. Only commit enumerates names and passes confirmed data to the Worker.
export function createPluginDirectoryResourceSelection({
  container,
  plugin,
  target,
  gateway,
  isCurrent,
  onResource,
  directoryUsage = false,
  onExplorerPreparing = () => {},
}) {
  const duplicates = directoryUsage && isDuplicateFiles(plugin.id, plugin.capabilities[0].id);
  const usage = directoryUsage && (duplicates || isDiskInspector(plugin.id, plugin.capabilities[0].id));
  const profile = duplicates ? duplicateFilesProfile : usage ? directoryUsageProfile : "resource.local-directory.draft1";
  const panel = document.createElement("section");
  panel.className = "plugin-resource-selection";
  panel.setAttribute("aria-label", t("Studio directory selection"));
  const label = document.createElement("strong");
  label.textContent = t(duplicates ? "Check a folder for duplicate files" :
    usage ? "Share folder usage with Disk Inspector" : "Studio · Share folder names with this plugin");
  const description = document.createElement("p");
  description.textContent = t(
    duplicates ? "After confirmation, Studio reads same-size candidate files to calculate SHA-256. The plugin receives relative names, sizes and hashes." :
      usage ? "After confirmation, shares relative names, entry types and logical file sizes. File contents are not read." :
      "Only names and file or directory types from one level are shared. No file contents are read. Nothing is saved or sent to AI.",
  );
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "ui-button ui-button--secondary";
  choose.textContent = t("Choose a folder");
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "ui-button ui-button--primary";
  confirm.textContent = t("Confirm directory sharing");
  confirm.disabled = true;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button ui-button--secondary";
  cancel.textContent = t("Cancel directory sharing");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(label, description, choose, confirm, cancel, status);
  container.append(panel);

  const owner = {
    runtimeId: target.instanceId,
    sessionId: target.sessionId,
    pluginId: plugin.id,
    capabilityId: plugin.capabilities[0].id,
  };
  let active = true,
    revision = 0,
    busy = false,
    grant = null,
    access = null;
  let explorerPending = false;
  const valid = (token) => active && revision === token && isCurrent();
  const picker = usage ? gateway.directoryUsage : gateway.projectDirectories;
  const grantArgs = usage ? [target.workspaceId, owner] : [owner];
  const cancelGrant = id => picker.cancel(...grantArgs, id);
  function release() {
    if (!access) return;
    const old = access;
    access = null;
    onResource(null);
    void gateway.revokeResource(old).catch(() => {
      if (active && isCurrent())
        status.textContent = t(
          "Release was not confirmed. The resource will expire automatically.",
        );
    });
  }
  function clear() {
    revision++;
    const old = grant;
    grant = null;
    if (old) void cancelGrant(old.grantId).catch(() => {});
    release();
    confirm.disabled = true;
    return old;
  }
  const canReadExplorer = usage && !duplicates && typeof picker.entry === "function";
  function resumeExplorer() {
    if (!explorerPending || !active || !isCurrent() || busy) return;
    explorerPending = false;
    void chooseFolder(true);
  }
  function receiveExplorer() {
    explorerPending = true;
    resumeExplorer();
  }
  function finish(fromExplorer = false) {
    busy = false;
    if (fromExplorer) onExplorerPreparing(false);
    if (active && isCurrent()) {
      choose.disabled = false;
      panel.removeAttribute("aria-busy");
    }
    resumeExplorer();
  }
  async function chooseFolder(fromExplorer = false) {
    if (!active || !isCurrent() || busy) return;
    if (!fromExplorer) {
      clear();
      status.textContent = t(duplicates ? "Choose a local folder. Candidate files are read only after confirmation." :
        usage ? "Choose a local folder. Usage is shared only after confirmation." :
        "Choose a folder within the current file location. Names are shared only after confirmation.");
    }
    busy = true;
    const token = revision;
    choose.disabled = true;
    panel.setAttribute("aria-busy", "true");
    let stage = "picker";
    if (fromExplorer) onExplorerPreparing(true);
    try {
      const selected = await (fromExplorer
        ? picker.entry(target.workspaceId, owner)
        : usage ? picker.choose(...grantArgs, ...(duplicates ? [profile] : [])) : picker.choose(target.workspaceId));
      if (!valid(token)) {
        if (usage && selected?.grantId) void cancelGrant(selected.grantId).catch(() => {});
        return;
      }
      if (selected == null) {
        if (!fromExplorer) status.textContent = t("Directory selection canceled.");
        return;
      }
      if (!usage && (typeof selected !== "string" || !selected || selected.startsWith("/") || /^[A-Za-z]:/.test(selected)))
        throw new Error("invalid path");
      stage = "prepare";
      const prepared = usage ? selected : await picker.prepare(owner, selected);
      stage = "response";
      if (!valid(token)) {
        if (prepared?.grantId)
          void cancelGrant(prepared.grantId).catch(() => {});
        return;
      }
      if (
        prepared?.profile !== profile ||
        prepared.confirmed !== false ||
        prepared.entryNamesRead !== false ||
        (usage ? !validDisplayName(prepared.displayName) : prepared.relativePath !== selected) ||
        !sameOwner(prepared.owner, owner) ||
        typeof prepared.grantId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(prepared.grantId)
      ) {
        if (prepared?.grantId)
          void cancelGrant(prepared.grantId).catch(() => {});
        throw new Error("invalid grant");
      }
      if (fromExplorer) clear();
      grant = prepared;
      confirm.disabled = false;
      status.textContent = t(
        duplicates ? "Selected directory: {name} · plugin {plugin}. Confirm to read duplicate candidates." :
          usage ? "Selected directory: {name} · plugin {plugin}. Confirm to share directory usage." :
          "Selected directory: {name} · plugin {plugin}. Confirm to share one level of names.",
      )
        .replace("{name}", usage ? (prepared.displayName || t("Selected local folder")) : selected)
        .replace("{plugin}", `${plugin.name} ${plugin.version}`);
    } catch (failure) {
      if (valid(token)) {
        const code =
          typeof failure?.code === "string" && /^[a-z_]{1,64}$/.test(failure.code)
            ? failure.code
            : "unknown";
        status.textContent =
          stage === "picker"
            ? t(usage
                ? "Directory picker could not use this folder. Choose a regular local folder and retry."
                : "Directory picker could not use this selection. Check the file location and retry.")
            : stage === "prepare"
              ? t(
                  "Directory access could not be prepared ({code}). Check permission and retry.",
                ).replace("{code}", code)
              : t(
                  "Directory preparation returned unexpected metadata. Refresh the tool and retry.",
                );
      }
    } finally {
      finish(fromExplorer);
    }
  }
  choose.addEventListener("click", () => void chooseFolder());
  if (canReadExplorer) {
    window.addEventListener("zicode:entry-changed", receiveExplorer);
    receiveExplorer();
  }
  confirm.addEventListener("click", async () => {
    if (!grant || !active || !isCurrent() || busy) return;
    busy = true;
    const token = revision,
      pending = grant;
    choose.disabled = confirm.disabled = true;
    panel.setAttribute("aria-busy", "true");
    status.textContent = t(duplicates ? "Checking sizes and hashing candidate files…" : "Sharing the confirmed directory snapshot…");
    try {
      const result = await picker.commit(...grantArgs, pending.grantId);
      if (!valid(token)) {
        if (result?.access) void gateway.revokeResource(result.access).catch(() => {});
        return;
      }
      if (
        result?.profile !== profile ||
        result.confirmed !== true ||
        (usage && typeof result.partial !== "boolean") ||
        !Number.isInteger(result.entryCount) ||
        result.entryCount < 0 ||
        result.entryCount > 4096 ||
        !sameOwner(result.access?.owner, owner) ||
        typeof result.access?.resourceId !== "string" ||
        typeof result.access?.contentVersion !== "string"
      ) {
        if (result?.access) void gateway.revokeResource(result.access).catch(() => {});
        throw new Error("invalid resource");
      }
      grant = null;
      access = result.access;
      onResource({
        capabilityId: owner.capabilityId,
        resourceId: access.resourceId,
        contentVersion: access.contentVersion,
      });
      status.textContent = t(
        duplicates ? "Hashed {count} candidate files. Execute the tool to group matches." :
          usage && result.partial ? "Shared partial usage for {count} directory entries. You can now execute the tool." :
          "Shared {count} directory entries. You can now execute the tool or cancel sharing.",
      ).replace("{count}", result.entryCount);
    } catch {
      if (valid(token))
        status.textContent = t("Directory sharing failed. Choose the directory again.");
    } finally {
      if (grant === pending) {
        grant = null;
        void cancelGrant(pending.grantId).catch(() => {});
      }
      finish();
    }
  });
  cancel.addEventListener("click", () => {
    if (!active) return;
    const pending = clear();
    status.textContent = t(
      pending || busy
        ? "Directory sharing canceled. Waiting for preparation to finish."
        : "Directory sharing canceled.",
    );
    choose.focus();
  });
  return {
    resumeExplorer,
    destroy() {
      if (!active) return;
      active = false;
      if (canReadExplorer) window.removeEventListener("zicode:entry-changed", receiveExplorer);
      clear();
      panel.remove();
    },
  };
}
