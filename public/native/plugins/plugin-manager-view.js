import { t } from "../../i18n.js";

export function renderPluginManagerView({
  container,
  registry,
  getTarget = () => null,
  notify = () => {},
  renderIcon,
  installDeveloperPlugin = null,
  selectSignedPlugin = null,
  installSignedPlugin = null,
  rollbackSignedPlugin = null,
  revokePublisher = null,
  initialFilter = "installed",
  onFilterChange = () => {},
  confirmUninstall = (message) => globalThis.confirm?.(message) ?? false,
  confirmPublisher = (message) => globalThis.confirm?.(message) ?? false,
}) {
  const hero = document.createElement("section");
  hero.className = "plugin-main-hero";
  const kicker = document.createElement("span");
  kicker.className = "plugin-main-kicker";
  kicker.textContent = t("Application extensions");
  const title = document.createElement("h1");
  title.textContent = t("Plugin Manager");
  const description = document.createElement("p");
  description.textContent = t(
    "Manage application plugins independently from Pi extensions. State and permissions are scoped to the current scene.",
  );
  const scene = document.createElement("p");
  scene.className = "plugin-manager-scene";
  scene.textContent = `${t("Scene")}: ${getTarget?.()?.sceneId ?? "programming"}`;
  hero.append(kicker, title, description, scene);

  const actions = document.createElement("div");
  actions.className = "plugin-manager-actions";
  const install = actionButton(t("Install local plugin"), "ui-button--primary");
  install.disabled = typeof installDeveloperPlugin !== "function";
  if (install.disabled) {
    install.title = t("Local plugin installation is available in the desktop application.");
  }
  install.addEventListener("click", async () => {
    install.disabled = true;
    try {
      const pluginId = await installDeveloperPlugin?.();
      if (!pluginId) return;
      await registry.setScene?.(getTarget?.()?.sceneId ?? "programming");
      notify(`${t("Installed")} ${pluginId}`);
    } catch (error) {
      notify(error?.message ?? String(error));
    } finally {
      install.disabled = typeof installDeveloperPlugin !== "function";
    }
  });
  const installSigned = actionButton(t("Install signed package"), "ui-button--secondary");
  installSigned.disabled =
    typeof selectSignedPlugin !== "function" || typeof installSignedPlugin !== "function";
  installSigned.addEventListener("click", async () => {
    installSigned.disabled = true;
    try {
      const preview = await selectSignedPlugin?.();
      if (!preview) return;
      const permissionSummary = preview.permissions?.length
        ? preview.permissions.join(", ")
        : t("No permissions requested");
      if (
        !preview.trusted &&
        !confirmPublisher(
          `${t("Trust publisher")} ${preview.publisher}?\n${t("Key fingerprint")}: ${preview.publisherKeyId}\n${t("Permissions")}: ${permissionSummary}`,
        )
      ) {
        return;
      }
      const pluginId = await installSignedPlugin(preview.packagePath, !preview.trusted);
      await registry.setScene?.(getTarget?.()?.sceneId ?? "programming");
      notify(`${t("Installed")} ${pluginId}`);
    } catch (error) {
      notify(error?.message ?? String(error));
    } finally {
      installSigned.disabled =
        typeof selectSignedPlugin !== "function" || typeof installSignedPlugin !== "function";
    }
  });
  const refresh = actionButton(t("Refresh"), "ui-button--secondary");
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    try {
      await registry.reload();
      notify(t("Plugin registry refreshed"));
    } catch (error) {
      notify(error?.message ?? String(error));
    } finally {
      refresh.disabled = false;
    }
  });
  actions.append(install, installSigned, refresh);

  const filters = document.createElement("div");
  filters.className = "plugin-manager-filters";
  filters.setAttribute("role", "tablist");
  filters.setAttribute("aria-label", t("Plugin filters"));
  const grid = document.createElement("div");
  grid.className = "plugin-manager-grid";
  let activeFilter = initialFilter;
  const filterDefinitions = [
    ["installed", "Installed"],
    ["builtIn", "Built-in"],
    ["disabled", "Disabled"],
    ["developer", "Developer"],
    ["signed", "Signed"],
  ];
  for (const [filterId, label] of filterDefinitions) {
    const button = actionButton(t(label), "ui-button--ghost");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(filterId === activeFilter));
    button.dataset.pluginFilter = filterId;
    button.addEventListener("click", () => {
      activeFilter = filterId;
      onFilterChange(activeFilter);
      for (const candidate of filters.querySelectorAll("[data-plugin-filter]")) {
        candidate.setAttribute(
          "aria-selected",
          String(candidate.dataset.pluginFilter === activeFilter),
        );
      }
      renderCards();
    });
    filters.append(button);
  }

  container.append(hero, actions, filters, grid);
  renderCards();
  renderDiagnostics();

  function renderCards() {
    grid.replaceChildren();
    const plugins = registry.list().filter(matchesFilter);
    if (!plugins.length) {
      const empty = document.createElement("p");
      empty.className = "plugin-manager-empty";
      empty.textContent = t("No plugins in this category.");
      grid.append(empty);
      return;
    }
    for (const plugin of plugins) grid.append(pluginCard(plugin));
  }

  function matchesFilter(plugin) {
    if (activeFilter === "builtIn") return plugin.origin === "builtIn";
    if (activeFilter === "developer") return plugin.origin === "developer";
    if (activeFilter === "signed") return plugin.origin === "signed";
    if (activeFilter === "disabled") return !plugin.enabled;
    return true;
  }

  function pluginCard(plugin) {
    const card = document.createElement("article");
    card.className = "ui-card plugin-manager-card";
    const icon = document.createElement("span");
    icon.className = "plugin-manager-icon";
    icon.append(renderIcon(plugin.icon));
    const copy = document.createElement("div");
    copy.className = "plugin-manager-copy";
    const name = document.createElement("strong");
    name.textContent = t(plugin.name);
    const origin = document.createElement("span");
    origin.className = "ui-badge plugin-manager-origin";
    origin.textContent = t(
      plugin.origin === "developer"
        ? "Developer"
        : plugin.origin === "signed"
          ? "Signed"
          : "Built-in",
    );
    const id = document.createElement("code");
    id.textContent = plugin.id;
    const detail = document.createElement("p");
    detail.textContent = t(plugin.description);
    copy.append(name, origin, id, detail);

    const cardActions = document.createElement("div");
    cardActions.className = "plugin-manager-card-actions";
    const toggle = actionButton(
      t(plugin.core ? "Required" : plugin.enabled ? "Enabled" : "Disabled"),
      plugin.enabled ? "ui-button--secondary" : "ui-button--ghost",
    );
    toggle.disabled = plugin.core;
    toggle.setAttribute("aria-pressed", String(plugin.enabled));
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try {
        await registry.setEnabled(plugin.id, !plugin.enabled);
      } catch (error) {
        toggle.disabled = plugin.core;
        notify(error?.message ?? String(error));
      }
    });
    cardActions.append(toggle);
    if (plugin.origin === "developer" || plugin.origin === "signed") {
      const uninstall = actionButton(t("Uninstall"), "ui-button--danger");
      uninstall.addEventListener("click", async () => {
        if (
          !confirmUninstall(
            `${t("Uninstall")} ${t(plugin.name)}? ${t(
              "Plugin data will be preserved for a future reinstall.",
            )}`,
          )
        ) {
          return;
        }
        uninstall.disabled = true;
        try {
          await registry.uninstall(plugin.id);
          notify(`${t("Uninstalled")} ${t(plugin.name)}; ${t("Plugin data was preserved")}`);
        } catch (error) {
          uninstall.disabled = false;
          notify(error?.message ?? String(error));
        }
      });
      cardActions.append(uninstall);
    }
    if (plugin.origin === "signed") {
      for (const version of plugin.retainedVersions ?? []) {
        const rollback = actionButton(`${t("Rollback")} ${version}`, "ui-button--ghost");
        rollback.disabled = typeof rollbackSignedPlugin !== "function";
        rollback.addEventListener("click", async () => {
          if (!confirmPublisher(`${t("Rollback")} ${t(plugin.name)} → ${version}?`)) return;
          rollback.disabled = true;
          try {
            await rollbackSignedPlugin(plugin.id, version);
            await registry.setScene?.(getTarget?.()?.sceneId ?? "programming");
            notify(`${t("Rolled back")} ${t(plugin.name)} → ${version}`);
          } catch (error) {
            rollback.disabled = false;
            notify(error?.message ?? String(error));
          }
        });
        cardActions.append(rollback);
      }
      const revoke = actionButton(t("Revoke publisher"), "ui-button--danger");
      revoke.disabled = !plugin.publisherKeyId || typeof revokePublisher !== "function";
      revoke.addEventListener("click", async () => {
        if (
          !confirmPublisher(
            `${t("Revoke publisher")} ${plugin.publisher}?\n${t("Key fingerprint")}: ${plugin.publisherKeyId}`,
          )
        ) {
          return;
        }
        revoke.disabled = true;
        try {
          await revokePublisher(plugin.publisherKeyId);
          await registry.setScene?.(getTarget?.()?.sceneId ?? "programming");
          notify(`${t("Publisher revoked")}: ${plugin.publisher}`);
        } catch (error) {
          revoke.disabled = false;
          notify(error?.message ?? String(error));
        }
      });
      cardActions.append(revoke);
    }
    card.append(icon, copy, cardActions);

    const permissions = [
      ...(plugin.permissionDetails?.required ?? []),
      ...(plugin.permissionDetails?.optional ?? []),
    ];
    if (permissions.length) card.append(permissionList(plugin, permissions));
    return card;
  }

  function permissionList(plugin, permissions) {
    const list = document.createElement("div");
    list.className = "plugin-manager-permissions";
    const permissionTitle = document.createElement("strong");
    permissionTitle.textContent = t("Scene permissions");
    list.append(permissionTitle);
    for (const permission of permissions) {
      const row = document.createElement("div");
      row.className = "plugin-manager-permission";
      const label = document.createElement("span");
      label.textContent = permission.name;
      label.title = t(permission.reason);
      const granted = plugin.permissions?.[permission.name] === true;
      const permissionToggle = actionButton(t(granted ? "Allowed" : "Denied"), "ui-button--ghost");
      permissionToggle.setAttribute("aria-pressed", String(granted));
      permissionToggle.addEventListener("click", async () => {
        permissionToggle.disabled = true;
        try {
          await registry.setPermission(plugin.id, permission.name, !granted);
        } catch (error) {
          permissionToggle.disabled = false;
          notify(error?.message ?? String(error));
        }
      });
      row.append(label, permissionToggle);
      list.append(row);
    }
    return list;
  }

  function renderDiagnostics() {
    const diagnostics = registry.diagnostics?.() ?? [];
    if (!diagnostics.length) return;
    const panel = document.createElement("section");
    panel.className = "ui-card plugin-manager-diagnostics";
    const diagnosticTitle = document.createElement("strong");
    diagnosticTitle.textContent = t("Rejected developer packages");
    panel.append(diagnosticTitle);
    for (const diagnostic of diagnostics) {
      const row = document.createElement("p");
      row.textContent = `${diagnostic.package}: ${diagnostic.message}`;
      panel.append(row);
    }
    container.append(panel);
  }
}

function actionButton(label, variant) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-button ui-button--sm ${variant}`;
  button.textContent = label;
  return button;
}
