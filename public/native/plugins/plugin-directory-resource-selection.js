import { t } from "../../i18n.js";

// Trusted Studio UI. The picker returns a project-relative path; only commit
// enumerates names, and only the confirmed resource is passed to the Worker.
export function createPluginDirectoryResourceSelection({
  container,
  plugin,
  target,
  gateway,
  isCurrent,
  onResource,
}) {
  const panel = document.createElement("section");
  panel.className = "plugin-resource-selection";
  panel.setAttribute("aria-label", t("Studio directory selection"));
  const label = document.createElement("strong");
  label.textContent = t("Studio · Share project directory names with this plugin");
  const description = document.createElement("p");
  description.textContent = t(
    "Only names and file or directory types from one level are shared. No file contents are read. Nothing is saved or sent to AI.",
  );
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "ui-button ui-button--secondary";
  choose.textContent = t("Choose a project directory");
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
  const valid = (token) => active && revision === token && isCurrent();
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
    if (old) void gateway.projectDirectories.cancel(owner, old.grantId).catch(() => {});
    release();
    confirm.disabled = true;
    return old;
  }
  choose.addEventListener("click", async () => {
    if (!active || !isCurrent() || busy) return;
    clear();
    busy = true;
    const token = revision;
    choose.disabled = true;
    panel.setAttribute("aria-busy", "true");
    status.textContent = t(
      "Choose a directory inside the current project. Names are shared only after confirmation.",
    );
    try {
      const path = await gateway.projectDirectories.choose(target.workspaceId);
      if (!valid(token)) return;
      if (path == null) {
        status.textContent = t("Directory selection canceled.");
        return;
      }
      if (typeof path !== "string" || !path || path.startsWith("/") || /^[A-Za-z]:/.test(path))
        throw new Error("invalid path");
      const prepared = await gateway.projectDirectories.prepare(owner, path);
      if (!valid(token)) {
        if (prepared?.grantId)
          void gateway.projectDirectories.cancel(owner, prepared.grantId).catch(() => {});
        return;
      }
      if (
        prepared?.profile !== "resource.local-directory.draft1" ||
        prepared.confirmed !== false ||
        prepared.entryNamesRead !== false ||
        prepared.relativePath !== path ||
        JSON.stringify(prepared.owner) !== JSON.stringify(owner) ||
        typeof prepared.grantId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(prepared.grantId)
      ) {
        if (prepared?.grantId)
          void gateway.projectDirectories.cancel(owner, prepared.grantId).catch(() => {});
        throw new Error("invalid grant");
      }
      grant = prepared;
      confirm.disabled = false;
      status.textContent = t(
        "Selected directory: {name} · plugin {plugin}. Confirm to share one level of names.",
      )
        .replace("{name}", path)
        .replace("{plugin}", `${plugin.name} ${plugin.version}`);
    } catch {
      if (valid(token))
        status.textContent = t("Could not select this project directory. Choose again.");
    } finally {
      busy = false;
      if (active && isCurrent()) {
        choose.disabled = false;
        panel.removeAttribute("aria-busy");
      }
    }
  });
  confirm.addEventListener("click", async () => {
    if (!grant || !active || !isCurrent() || busy) return;
    busy = true;
    const token = revision,
      pending = grant;
    choose.disabled = confirm.disabled = true;
    panel.setAttribute("aria-busy", "true");
    status.textContent = t("Sharing the confirmed directory snapshot…");
    try {
      const result = await gateway.projectDirectories.commit(owner, pending.grantId);
      if (!valid(token)) {
        if (result?.access) void gateway.revokeResource(result.access).catch(() => {});
        return;
      }
      if (
        result?.profile !== "resource.local-directory.draft1" ||
        result.confirmed !== true ||
        !Number.isInteger(result.entryCount) ||
        result.entryCount < 0 ||
        result.entryCount > 4096 ||
        JSON.stringify(result.access?.owner) !== JSON.stringify(owner) ||
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
        "Shared {count} directory entries. You can now execute the tool or cancel sharing.",
      ).replace("{count}", result.entryCount);
    } catch {
      if (valid(token))
        status.textContent = t("Directory sharing failed. Choose the directory again.");
    } finally {
      if (grant === pending) {
        grant = null;
        void gateway.projectDirectories.cancel(owner, pending.grantId).catch(() => {});
      }
      busy = false;
      if (active && isCurrent()) {
        choose.disabled = false;
        panel.removeAttribute("aria-busy");
      }
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
    destroy() {
      if (!active) return;
      active = false;
      clear();
      panel.remove();
    },
  };
}
