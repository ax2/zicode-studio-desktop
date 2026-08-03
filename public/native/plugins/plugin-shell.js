import { t } from "../../i18n.js";
import { MOBILE_SHELL_QUERY } from "../../ui/sidebar-toggle.js";
import { setupMobileHistoryLayer } from "../utils/mobile-history-layer.js";
import { renderPluginManagerView } from "./plugin-manager-view.js";
import { createBuiltinPluginRegistry } from "./plugin-registry.js";

const CHAT_PLUGIN_ID = "core.chat";
const MANAGER_VIEW_ID = "core.pluginManager";
const SETTINGS_VIEW_ID = "core.settings";
const HELP_VIEW_ID = "core.help";
const MANAGER_FILTER_STORAGE_KEY = "zicode.plugin-manager.filter";
const SHELL_VIEW_IDS = new Set([MANAGER_VIEW_ID, SETTINGS_VIEW_ID, HELP_VIEW_ID]);
const MOBILE_PRIMARY_ACTIVITY_IDS = new Set([
  CHAT_PLUGIN_ID,
  "com.zicode.projects",
  "com.zicode.notes",
]);
export const PLUGIN_HISTORY_STATE_KEY = "zicodePluginId";

export function setupPluginShell({
  registry = createBuiltinPluginRegistry(),
  capabilityGateway = null,
  commandGateway = null,
  getTarget = () => null,
  openSettings = () => {},
  openHelp = () => {},
  settingsApp = null,
  helpApp = null,
  notesApp = null,
  financeApp = null,
  artifactApp = null,
  builtinApps = {},
  pluginViewHost = null,
  openCommandPalette = () => {},
  openFinanceWorkbench = () => {},
  installDeveloperPlugin = null,
  selectSignedPlugin = null,
  installSignedPlugin = null,
  rollbackSignedPlugin = null,
  revokePublisher = null,
  notify = () => {},
} = {}) {
  const appLayout = document.querySelector(".app-layout");
  const sidebar = document.getElementById("sidebar");
  const main = document.querySelector(".main");
  const header = main?.querySelector(".header");
  if (!appLayout || !sidebar || !main || !header) return null;

  const chatSidebarElements = [
    sidebar.querySelector(".sidebar-header"),
    document.getElementById("session-list"),
    sidebar.querySelector(".sidebar-footer"),
  ].filter(Boolean);
  const chatMainElements = [...main.children].filter((element) => element !== header);
  const sidePanels = [
    document.getElementById("super-agent-runtime"),
    document.getElementById("file-sidebar"),
  ].filter(Boolean);
  const surfaceStates = new WeakMap();
  const applicationViews = new Map(
    Object.entries({
      "com.zicode.notes": notesApp,
      "com.zicode.finance": financeApp,
      "com.zicode.artifacts": artifactApp,
      ...builtinApps,
    }).filter(([, app]) => app),
  );

  function toggleSurface(element, visible) {
    if (!visible) {
      if (!surfaceStates.has(element)) {
        surfaceStates.set(element, {
          ariaHidden: element.getAttribute("aria-hidden"),
          inert: element.hasAttribute("inert"),
        });
      }
      element.classList.add("plugin-surface-hidden");
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
      return;
    }
    element.classList.remove("plugin-surface-hidden");
    const original = surfaceStates.get(element);
    if (!original) return;
    if (original.ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", original.ariaHidden);
    if (!original.inert) element.removeAttribute("inert");
    surfaceStates.delete(element);
  }

  const activityBar = buildActivityBar();
  const activities = activityBar.querySelector("[data-plugin-activities]");
  const systemActivities = activityBar.querySelector("[data-system-activities]");
  const mobileMoreButton = activityBar.querySelector("[data-mobile-activity-more]");
  const mobileActivityBackdrop = activityBar.querySelector("[data-mobile-activity-backdrop]");
  const mobileActivityMenu = activityBar.querySelector("[data-mobile-activity-menu]");
  const mobileActivityMenuTitle = activityBar.querySelector("[data-mobile-activity-menu-title]");
  const mobileActivityMenuGrid = activityBar.querySelector("[data-mobile-activity-menu-grid]");
  const mobileActivityMenuClose = activityBar.querySelector("[data-mobile-activity-menu-close]");
  const pluginSidebar = buildPluginSidebar();
  const pluginMain = buildPluginMain();
  appLayout.insertBefore(activityBar, sidebar);
  sidebar.append(pluginSidebar);
  main.append(pluginMain);

  let activePluginId = CHAT_PLUGIN_ID;
  const activityBadges = new Map();
  let managerFilter = loadManagerFilter();
  let registrySceneId = null;
  const mobileShellMedia = globalThis.matchMedia?.(MOBILE_SHELL_QUERY);

  function historyState(value = globalThis.history?.state) {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  }

  function historyUrl() {
    const { pathname = "", search = "", hash = "" } = globalThis.location || {};
    return `${pathname}${search}${hash}` || "/";
  }

  function writePluginHistory(pluginId, mode = "replace") {
    if (!globalThis.history) return;
    const state = { ...historyState(), [PLUGIN_HISTORY_STATE_KEY]: pluginId };
    globalThis.history[mode === "push" ? "pushState" : "replaceState"](
      state,
      "",
      historyUrl(),
    );
  }

  const handlePluginPopState = (event) => {
    const pluginId = event.state?.[PLUGIN_HISTORY_STATE_KEY] || CHAT_PLUGIN_ID;
    activate(pluginId, { focus: false });
  };
  globalThis.addEventListener?.("popstate", handlePluginPopState);

  let mobileMenuHistory = null;
  function closeMobileActivityMenu({
    restoreFocus = false,
    fromHistory = false,
    discardHistory = false,
  } = {}) {
    if (!mobileActivityMenu || mobileActivityMenu.hidden) return;
    mobileActivityMenu.hidden = true;
    mobileActivityBackdrop.hidden = true;
    mobileMoreButton.setAttribute("aria-expanded", "false");
    if (!fromHistory) mobileMenuHistory?.leave({ replace: discardHistory });
    if (restoreFocus) mobileMoreButton.focus({ preventScroll: true });
  }

  function openMobileActivityMenu() {
    if (!mobileActivityMenu) return;
    mobileActivityMenu.hidden = false;
    mobileActivityBackdrop.hidden = false;
    mobileMoreButton.setAttribute("aria-expanded", "true");
    mobileMenuHistory?.enter();
    mobileActivityMenu.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  }

  mobileMenuHistory = setupMobileHistoryLayer({
    id: "application-menu",
    isActive: () => !mobileActivityMenu.hidden,
    onBack: () => closeMobileActivityMenu({ restoreFocus: true, fromHistory: true }),
  });

  mobileMoreButton?.addEventListener("click", () => {
    if (mobileActivityMenu.hidden) openMobileActivityMenu();
    else closeMobileActivityMenu({ restoreFocus: true });
  });
  mobileActivityMenuClose?.addEventListener("click", () =>
    closeMobileActivityMenu({ restoreFocus: true }),
  );
  mobileActivityBackdrop?.addEventListener("click", () =>
    closeMobileActivityMenu({ restoreFocus: true }),
  );
  mobileActivityMenu?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMobileActivityMenu({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...mobileActivityMenu.querySelectorAll("button:not([disabled])")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const handleMobileShellChange = () => {
    if (!mobileShellMedia?.matches) closeMobileActivityMenu({ discardHistory: true });
    updateActivitySelection(activePluginId);
  };
  mobileShellMedia?.addEventListener?.("change", handleMobileShellChange);
  window.addEventListener("resize", handleMobileShellChange);

  function activate(pluginId, { focus = true, historyMode = "none" } = {}) {
    const previousPluginId = activePluginId;
    if (!SHELL_VIEW_IDS.has(pluginId) && !registry.isEnabled(pluginId)) {
      pluginId = CHAT_PLUGIN_ID;
    }
    if (activePluginId === SETTINGS_VIEW_ID && pluginId !== SETTINGS_VIEW_ID) {
      settingsApp?.deactivate?.();
    }
    const activeApplication = applicationViews.get(activePluginId);
    if (pluginId !== activePluginId && activeApplication?.canDeactivate?.() === false) {
      return;
    }
    if (pluginId !== activePluginId) activeApplication?.deactivate?.();
    const previousPlugin = registry.get(activePluginId);
    if (
      pluginId !== activePluginId &&
      previousPlugin?.origin === "developer" &&
      pluginViewHost?.canDeactivate?.(activePluginId) === false
    ) {
      return;
    }
    if (pluginId !== activePluginId && previousPlugin?.origin === "developer") {
      pluginViewHost?.deactivate?.(activePluginId);
    }
    activePluginId = pluginId;
    closeMobileActivityMenu();
    if (pluginId === CHAT_PLUGIN_ID) activityBadges.delete(CHAT_PLUGIN_ID);
    const isChat = pluginId === CHAT_PLUGIN_ID;
    document.body.dataset.activePlugin = pluginId;
    for (const element of chatSidebarElements) toggleSurface(element, isChat);
    for (const element of chatMainElements) toggleSurface(element, isChat);
    for (const element of sidePanels) element.classList.toggle("plugin-shell-hidden", !isChat);
    toggleSurface(pluginSidebar, !isChat);
    toggleSurface(pluginMain, !isChat);
    sidebar.classList.toggle("plugin-sidebar-active", !isChat);
    main.classList.toggle("plugin-main-active", !isChat);

    renderActivities();
    if (!isChat) {
      renderSidebar(pluginId);
      renderMain(pluginId);
    }
    updateActivitySelection(pluginId);
    if (focus) {
      activityBar
        .querySelector(`[data-plugin-id="${escapeSelector(pluginId)}"]`)
        ?.focus({ preventScroll: true });
    }
    document.dispatchEvent(
      new CustomEvent("zicode:active-plugin-changed", { detail: { pluginId } }),
    );
    if (historyMode === "push" && previousPluginId !== pluginId) {
      writePluginHistory(pluginId, "push");
    }
  }

  function renderActivities() {
    activityBar.setAttribute("aria-label", t("Applications"));
    mobileActivityBackdrop.setAttribute("aria-label", t("Close"));
    activities.replaceChildren();
    const visiblePlugins = registry.list().filter((plugin) => plugin.enabled && plugin.hasActivity !== false);
    for (const plugin of visiblePlugins) {
      activities.append(
        activityButton({
          id: plugin.id,
          label: t(plugin.name),
          icon: plugin.icon,
          badge: activityBadges.get(plugin.id),
          onClick: () => activateFromNavigation(plugin.id),
        }),
      );
    }
    const systemItems = [
      {
        id: "core.files",
        label: t("Files"),
        icon: "files",
        onClick: () => document.getElementById("file-sidebar-toggle")?.click(),
        system: true,
      },
      {
        id: "core.commands",
        label: t("Commands"),
        icon: "command",
        onClick: openCommandPalette,
        system: true,
      },
      {
        id: MANAGER_VIEW_ID,
        label: t("Manage plugins"),
        icon: "plugins",
        onClick: () => activateFromNavigation(MANAGER_VIEW_ID),
      },
      {
        id: SETTINGS_VIEW_ID,
        label: t("Settings"),
        icon: "settings",
        onClick: () => {
          activateFromNavigation(SETTINGS_VIEW_ID);
          openSettingsSurface();
        },
        system: true,
      },
      {
        id: HELP_VIEW_ID,
        label: t("Help"),
        icon: "help",
        onClick: () => {
          activateFromNavigation(HELP_VIEW_ID);
          openHelpSurface();
        },
        system: true,
      },
    ];
    systemActivities.replaceChildren(...systemItems.map(activityButton));
    renderMobileActivityMenu(visiblePlugins, systemItems);
  }

  function renderMobileActivityMenu(plugins, systemItems) {
    if (!mobileActivityMenuGrid) return;
    mobileMoreButton.setAttribute("aria-label", t("More"));
    mobileMoreButton.title = t("More");
    mobileMoreButton.querySelector(".plugin-activity-tooltip").textContent = t("More");
    mobileActivityMenuTitle.textContent = t("All applications");
    mobileActivityMenuClose.setAttribute("aria-label", t("Close"));
    mobileActivityMenuGrid.replaceChildren();
    const secondaryPlugins = plugins.filter(
      (plugin) => !MOBILE_PRIMARY_ACTIVITY_IDS.has(plugin.id),
    );
    const secondarySystemItems = systemItems.filter((item) => item.id !== "core.files");
    for (const item of [...secondaryPlugins, ...secondarySystemItems]) {
      const id = item.id;
      const label = item.label ?? t(item.name);
      const control = mobileActivityMenuButton({
        id,
        label,
        icon: item.icon,
        onClick: () => {
          closeMobileActivityMenu({ discardHistory: true });
          if ("onClick" in item) item.onClick();
          else activateFromNavigation(id);
        },
      });
      mobileActivityMenuGrid.append(control);
    }
  }

  function activateFromNavigation(pluginId) {
    closeMobileActivityMenu({ discardHistory: true });
    activate(pluginId, { historyMode: "push" });
    if (activePluginId === pluginId) requestFunctionArea();
  }

  function requestFunctionArea() {
    document.dispatchEvent(
      new CustomEvent("zicode:function-area-request", { detail: { open: true } }),
    );
  }

  function renderSidebar(pluginId) {
    pluginSidebar.replaceChildren();
    const plugin = registry.get(pluginId);
    const title = document.createElement("div");
    title.className = "plugin-sidebar-title";
    title.textContent =
      pluginId === SETTINGS_VIEW_ID
        ? t("Settings")
        : pluginId === HELP_VIEW_ID
          ? t("Help")
          : t(plugin?.name ?? "Plugins");
    pluginSidebar.append(title);

    if (pluginId === SETTINGS_VIEW_ID) {
      settingsApp?.renderNavigation?.(pluginSidebar);
      return;
    }
    if (pluginId === HELP_VIEW_ID) {
      helpApp?.renderNavigation?.(pluginSidebar);
      return;
    }
    const application = applicationViews.get(pluginId);
    if (application) {
      application.renderNavigation?.(pluginSidebar);
      return;
    }
    if ((plugin?.origin === "developer" || plugin?.origin === "signed") && pluginViewHost) {
      pluginViewHost.renderNavigation(pluginSidebar, plugin);
      return;
    }
    if (pluginId === MANAGER_VIEW_ID) {
      pluginSidebar.append(
        accordionView({
          title: t("Plugin manager"),
          items: [
            ["Installed", "installed"],
            ["Built-in", "builtIn"],
            ["Disabled", "disabled"],
            ["Developer", "developer"],
          ].map(([label, filter]) => ({
            label: t(label),
            action: () => pluginMain.querySelector(`[data-plugin-filter="${filter}"]`)?.click(),
          })),
          expanded: true,
        }),
        accordionView({
          title: t("Platform"),
          description: t("Manifest v1 · Host API v1 planning contract"),
        }),
      );
      return;
    }

    for (const [index, view] of (plugin?.sidebarViews ?? []).entries()) {
      pluginSidebar.append(
        accordionView({
          title: t(view.title),
          description: t(view.description),
          items: view.items,
          action: view.action,
          expanded: index === 0,
        }),
      );
    }
  }

  function renderMain(pluginId) {
    pluginMain.replaceChildren();
    if (pluginId === SETTINGS_VIEW_ID) {
      settingsApp?.renderContent?.(pluginMain);
      return;
    }
    if (pluginId === HELP_VIEW_ID) {
      helpApp?.renderContent?.(pluginMain);
      return;
    }
    const application = applicationViews.get(pluginId);
    if (application) {
      application.renderContent?.(pluginMain);
      return;
    }
    const plugin = registry.get(pluginId);
    if ((plugin?.origin === "developer" || plugin?.origin === "signed") && pluginViewHost) {
      pluginViewHost.renderContent(pluginMain, plugin);
      return;
    }
    if (pluginId === MANAGER_VIEW_ID) {
      renderPluginManagerView({
        container: pluginMain,
        registry,
        getTarget,
        notify,
        renderIcon: iconSvg,
        installDeveloperPlugin,
        selectSignedPlugin,
        installSignedPlugin,
        rollbackSignedPlugin,
        revokePublisher,
        initialFilter: managerFilter,
        onFilterChange: (filter) => {
          managerFilter = filter;
          try {
            globalThis.sessionStorage?.setItem(MANAGER_FILTER_STORAGE_KEY, filter);
          } catch {
            // Session UI persistence is optional in restricted webviews and tests.
          }
        },
      });
      return;
    }
    if (!plugin) return;
    const hero = document.createElement("section");
    hero.className = "plugin-main-hero";
    const kicker = document.createElement("span");
    kicker.className = "plugin-main-kicker";
    kicker.textContent = t(plugin.origin === "developer" ? "Developer plugin" : "Built-in plugin");
    const title = document.createElement("h1");
    title.textContent = t(plugin.name);
    const description = document.createElement("p");
    description.textContent = t(plugin.description);
    hero.append(kicker, title, description);
    pluginMain.append(hero, pluginOverview(plugin));
  }

  async function executeCommand(commandId, args = {}) {
    switch (commandId) {
      case "finance.openWorkbench":
        activate("com.zicode.finance", { focus: false });
        financeApp?.selectView?.("overview");
        if (!financeApp) openFinanceWorkbench();
        return;
      case "finance.configuration":
        openSettingsSurface("configuration");
        return;
      case "notes.new":
        activate("com.zicode.notes", { focus: false });
        void notesApp?.newNote?.();
        return;
      case "notes.captureUrl":
        activate("com.zicode.notes", { focus: false });
        notesApp?.startCapture?.();
        return;
      case "artifacts.export":
        activate("com.zicode.artifacts", { focus: false });
        artifactApp?.exportSelected?.();
        return;
      default: {
        const application = [...applicationViews.values()].find((candidate) =>
          candidate?.handlesCommand?.(commandId),
        );
        if (application) return application.executeCommand(commandId, args);
        if (!commandGateway) throw new Error("Plugin command gateway is unavailable");
        const providers = registry
          .list()
          .filter(
            (plugin) =>
              plugin.enabled && (plugin.commands ?? []).some((command) => command.id === commandId),
          );
        if (providers.length !== 1) throw new Error(`Plugin command is unavailable: ${commandId}`);
        const response = await commandGateway.invokeCommand(
          getTarget?.()?.sceneId ?? "programming",
          commandId,
          args,
        );
        if (response?.result?.message) notify(String(response.result.message));
        setPreviewStatus(commandId);
        return response?.result;
      }
    }
  }

  function setTarget(nextTarget = getTarget?.()) {
    for (const application of applicationViews.values()) application.setTarget?.(nextTarget);
    pluginViewHost?.setTarget?.(nextTarget);
    if (activePluginId !== CHAT_PLUGIN_ID) renderMain(activePluginId);
    const sceneId = nextTarget?.sceneId || "programming";
    if (sceneId === registrySceneId) return;
    registrySceneId = sceneId;
    registry.setScene?.(sceneId)?.catch((error) => {
      notify(`Plugin Host unavailable: ${error?.message ?? String(error)}`);
    });
  }

  function getCommandPaletteEntries() {
    return registry
      .list()
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) =>
        (plugin.commands ?? []).map((command) => ({
          icon: commandPaletteIcon(command.icon),
          label: `${t(plugin.name)}: ${t(command.label)}`,
          desc: plugin.description,
          action: () => {
            void executeCommand(command.id).catch((error) =>
              notify(error?.message ?? String(error)),
            );
          },
          disabled:
            plugin.id === "com.zicode.finance" &&
            command.id === "finance.openWorkbench" &&
            getTarget?.()?.sceneId !== "finance",
        })),
      );
  }

  function setActivityBadge(pluginId, badge) {
    if (!badge || !(Number(badge.count) > 0)) {
      activityBadges.delete(pluginId);
    } else {
      activityBadges.set(pluginId, {
        count: Math.min(99, Number(badge.count)),
        tone: badge.tone || "info",
      });
    }
    renderActivities();
    updateActivitySelection(activePluginId);
  }

  function incrementActivityBadge(pluginId, tone = "info") {
    const count = activityBadges.get(pluginId)?.count || 0;
    setActivityBadge(pluginId, { count: count + 1, tone });
  }

  const unsubscribe = registry.subscribe(() => {
    if (!SHELL_VIEW_IDS.has(activePluginId) && !registry.isEnabled(activePluginId)) {
      activate(CHAT_PLUGIN_ID, { focus: false });
      return;
    }
    renderActivities();
    if (activePluginId === MANAGER_VIEW_ID) renderMain(MANAGER_VIEW_ID);
    updateActivitySelection(activePluginId);
  });
  const handleLocaleChange = () => {
    renderActivities();
    if (activePluginId !== CHAT_PLUGIN_ID) {
      renderSidebar(activePluginId);
      renderMain(activePluginId);
    }
    updateActivitySelection(activePluginId);
  };
  window.addEventListener("zicode:locale-changed", handleLocaleChange);

  renderActivities();
  activate(CHAT_PLUGIN_ID, { focus: false });
  writePluginHistory(CHAT_PLUGIN_ID);
  settingsApp?.setOpenHandler?.((tab) => {
    if (tab === null) {
      activate(CHAT_PLUGIN_ID, { focus: false });
      if (globalThis.history?.state?.[PLUGIN_HISTORY_STATE_KEY] === SETTINGS_VIEW_ID) {
        globalThis.history.back();
      }
    }
    else activate(SETTINGS_VIEW_ID);
  });
  helpApp?.setOpenHandler?.((pageId) => {
    if (pageId === null) {
      activate(CHAT_PLUGIN_ID, { focus: false });
      if (globalThis.history?.state?.[PLUGIN_HISTORY_STATE_KEY] === HELP_VIEW_ID) {
        globalThis.history.back();
      }
    }
    else activate(HELP_VIEW_ID);
  });
  setTarget();

  return {
    activate,
    getCommandPaletteEntries,
    getActivePluginId: () => activePluginId,
    registry,
    listCapabilities: () => {
      const sceneId = getTarget()?.sceneId ?? "programming";
      return capabilityGateway?.list(sceneId) ?? Promise.resolve({ capabilities: [] });
    },
    invokeCapability: (pluginId, capabilityId, input = {}) => {
      if (!capabilityGateway) {
        return Promise.reject(new Error("Plugin capability gateway is unavailable"));
      }
      const sceneId = getTarget()?.sceneId ?? "programming";
      return capabilityGateway.invoke(sceneId, pluginId, capabilityId, input);
    },
    executeCommand,
    setActivityBadge,
    incrementActivityBadge,
    setTarget,
    destroy() {
      unsubscribe();
      for (const application of new Set(applicationViews.values())) application.destroy?.();
      pluginViewHost?.destroy?.();
      window.removeEventListener("zicode:locale-changed", handleLocaleChange);
      window.removeEventListener("resize", handleMobileShellChange);
      globalThis.removeEventListener?.("popstate", handlePluginPopState);
      mobileShellMedia?.removeEventListener?.("change", handleMobileShellChange);
      mobileMenuHistory?.dispose();
      activityBar.remove();
      pluginSidebar.remove();
      pluginMain.remove();
      for (const element of [...chatSidebarElements, ...chatMainElements])
        toggleSurface(element, true);
      for (const element of sidePanels) element.classList.remove("plugin-shell-hidden");
      delete document.body.dataset.activePlugin;
    },
  };

  function updateActivitySelection(pluginId) {
    const mobile =
      globalThis.matchMedia?.(MOBILE_SHELL_QUERY)?.matches ?? globalThis.innerWidth <= 768;
    for (const button of activityBar.querySelectorAll("[data-plugin-id]")) {
      const selected = button.dataset.pluginId === pluginId;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      if (selected && mobile) {
        const reduceMotion =
          globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
        button.scrollIntoView?.({
          behavior: reduceMotion ? "instant" : "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
    let secondarySelected = false;
    let selectedSecondaryLabel = "";
    for (const button of activityBar.querySelectorAll("[data-mobile-plugin-id]")) {
      const selected = button.dataset.mobilePluginId === pluginId;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      if (selected) selectedSecondaryLabel = button.getAttribute("aria-label") || "";
      secondarySelected ||= selected;
    }
    mobileMoreButton.classList.toggle("active", secondarySelected);
    if (secondarySelected) mobileMoreButton.setAttribute("aria-current", "page");
    else mobileMoreButton.removeAttribute("aria-current");
    const moreLabel = secondarySelected
      ? `${t("More")}: ${selectedSecondaryLabel}`
      : t("More");
    mobileMoreButton.setAttribute("aria-label", moreLabel);
    mobileMoreButton.title = moreLabel;
  }

  function setPreviewStatus(commandId) {
    const status = pluginMain.querySelector("[data-plugin-preview-status]");
    if (status) status.textContent = `${t(commandLabel(commandId))} ${t("command dispatched")}`;
  }

  function openSettingsSurface(tab = "general") {
    if (settingsApp) {
      settingsApp.openSettings?.(tab);
      return;
    }
    openSettings(tab);
  }

  function openHelpSurface(pageId) {
    if (helpApp) {
      void helpApp.open?.(pageId);
      return;
    }
    openHelp(pageId);
  }

  function pluginOverview(plugin) {
    const grid = document.createElement("div");
    grid.className = "plugin-overview-grid";
    const target = getTarget?.();
    const cards =
      plugin.id === "com.zicode.notes"
        ? [
            ["Local Markdown", "Readable files remain the source of truth."],
            ["Web capture", "URL content becomes sourced Markdown without saving credentials."],
            ["Astro vault", "Content Collections prepare local publishing and future clients."],
          ]
        : plugin.id === "com.zicode.finance"
          ? [
              ["Current scene", target?.sceneName || target?.sceneId || "Unknown"],
              ["Deterministic engine", "Existing screening, backtests, and ledgers are preserved."],
              ["Workbench", "The current Finance Workbench remains available."],
            ]
          : [
              ["Unified library", "Reports, charts, files, and source metadata in one place."],
              ["Resource handles", "Large artifacts stay outside conversation payloads."],
              ["Exports", "Plugins contribute exports through audited commands."],
            ];
    for (const [title, description] of cards) {
      const card = document.createElement("article");
      card.className = "ui-card plugin-overview-card";
      const heading = document.createElement("strong");
      heading.textContent = t(title);
      const detail = document.createElement("p");
      detail.textContent = t(description);
      card.append(heading, detail);
      grid.append(card);
    }
    const status = document.createElement("p");
    status.className = "plugin-preview-status";
    status.dataset.pluginPreviewStatus = "";
    status.setAttribute("aria-live", "polite");
    status.textContent =
      plugin.id === "com.zicode.finance" && target?.sceneId !== "finance"
        ? t("Open a Finance scene to use the existing workbench.")
        : t("This area is ready for plugin data and actions.");
    const wrapper = document.createElement("div");
    wrapper.append(grid);
    if (plugin.id === "com.zicode.finance") {
      const actions = document.createElement("div");
      actions.className = "plugin-main-actions";
      const openWorkbench = document.createElement("button");
      openWorkbench.type = "button";
      openWorkbench.className = "ui-button ui-button--primary";
      openWorkbench.textContent = t("Open existing Finance Workbench");
      openWorkbench.disabled = target?.sceneId !== "finance";
      openWorkbench.addEventListener("click", () => executeCommand("finance.openWorkbench"));
      const configuration = document.createElement("button");
      configuration.type = "button";
      configuration.className = "ui-button ui-button--secondary";
      configuration.textContent = t("Open configuration");
      configuration.addEventListener("click", () => executeCommand("finance.configuration"));
      actions.append(openWorkbench, configuration);
      wrapper.append(actions);
    }
    wrapper.append(status);
    return wrapper;
  }
}

function buildActivityBar() {
  const bar = document.createElement("nav");
  bar.className = "plugin-activity-bar";
  bar.setAttribute("aria-label", t("Applications"));
  const brand = document.createElement("div");
  brand.className = "plugin-activity-brand";
  const logo = document.createElement("img");
  logo.src = "icons/zicode-mark.svg";
  logo.alt = "";
  brand.append(logo);
  const activities = document.createElement("div");
  activities.className = "plugin-activity-list";
  activities.dataset.pluginActivities = "";
  const spacer = document.createElement("div");
  spacer.className = "plugin-activity-spacer";
  const system = document.createElement("div");
  system.className = "plugin-activity-list plugin-activity-list--system";
  system.dataset.systemActivities = "";
  const more = activityButton({
    id: "core.more",
    label: t("More"),
    icon: "more",
    onClick: () => {},
    system: true,
  });
  more.classList.add("plugin-mobile-activity-more");
  more.dataset.mobileActivityMore = "";
  more.removeAttribute("data-plugin-id");
  more.setAttribute("aria-haspopup", "dialog");
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", "mobile-activity-menu");

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "plugin-mobile-activity-backdrop";
  backdrop.dataset.mobileActivityBackdrop = "";
  backdrop.setAttribute("aria-label", t("Close"));
  backdrop.hidden = true;

  const menu = document.createElement("section");
  menu.id = "mobile-activity-menu";
  menu.className = "plugin-mobile-activity-menu";
  menu.dataset.mobileActivityMenu = "";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-modal", "true");
  menu.setAttribute("aria-labelledby", "mobile-activity-menu-title");
  menu.hidden = true;
  const menuHeader = document.createElement("header");
  menuHeader.className = "plugin-mobile-activity-menu-header";
  const menuTitle = document.createElement("strong");
  menuTitle.id = "mobile-activity-menu-title";
  menuTitle.dataset.mobileActivityMenuTitle = "";
  menuTitle.textContent = t("All applications");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-btn plugin-mobile-activity-menu-close";
  close.dataset.mobileActivityMenuClose = "";
  close.setAttribute("aria-label", t("Close"));
  close.append(iconSvg("close"));
  menuHeader.append(menuTitle, close);
  const grid = document.createElement("div");
  grid.className = "plugin-mobile-activity-menu-grid";
  grid.dataset.mobileActivityMenuGrid = "";
  menu.append(menuHeader, grid);
  bar.append(brand, activities, spacer, system, more, backdrop, menu);
  return bar;
}

function buildPluginSidebar() {
  const surface = document.createElement("div");
  surface.className = "plugin-sidebar-surface plugin-surface-hidden";
  surface.setAttribute("aria-label", "Plugin views");
  return surface;
}

function buildPluginMain() {
  const surface = document.createElement("main");
  surface.className = "plugin-main-view plugin-surface-hidden";
  surface.tabIndex = -1;
  return surface;
}

function activityButton({ id, label, icon, onClick, system = false, badge = null }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `plugin-activity-button${system ? " plugin-activity-button--system" : ""}`;
  button.dataset.pluginId = id;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(iconSvg(icon));
  const tooltip = document.createElement("span");
  tooltip.className = "plugin-activity-tooltip";
  tooltip.textContent = label;
  button.append(tooltip);
  if (badge?.count > 0) {
    const indicator = document.createElement("span");
    indicator.className = `plugin-activity-badge tone-${badge.tone || "info"}`;
    indicator.textContent = badge.count > 9 ? "9+" : String(badge.count);
    indicator.setAttribute("aria-label", `${badge.count} ${t("background updates")}`);
    button.append(indicator);
  }
  button.addEventListener("click", onClick);
  return button;
}

function mobileActivityMenuButton({ id, label, icon, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "plugin-mobile-activity-menu-item";
  button.dataset.mobilePluginId = id;
  button.setAttribute("aria-label", label);
  button.append(iconSvg(icon), elementText("span", label));
  button.addEventListener("click", onClick);
  return button;
}

function elementText(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function accordionView({ title, description, items, action, expanded = false }) {
  const section = document.createElement("section");
  section.className = "plugin-sidebar-view";
  const body = document.createElement("div");
  body.className = "plugin-sidebar-view-body";
  body.hidden = !expanded;
  const header = document.createElement("button");
  header.type = "button";
  header.className = "plugin-sidebar-view-header";
  header.setAttribute("aria-expanded", String(expanded));
  header.append(iconSvg("chevron"));
  const label = document.createElement("span");
  label.textContent = title;
  header.append(label);
  header.addEventListener("click", () => {
    const nextExpanded = header.getAttribute("aria-expanded") !== "true";
    header.setAttribute("aria-expanded", String(nextExpanded));
    body.hidden = !nextExpanded;
  });
  if (description) {
    const empty = document.createElement("p");
    empty.className = "plugin-sidebar-empty";
    empty.textContent = description;
    body.append(empty);
  }
  if (items?.length) {
    const list = document.createElement("ul");
    list.className = "plugin-sidebar-items";
    for (const item of items) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = typeof item === "string" ? item : item.label;
      if (typeof item !== "string" && typeof item.action === "function") {
        button.addEventListener("click", item.action);
      }
      row.append(button);
      list.append(row);
    }
    body.append(list);
  }
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--sm ui-button--ghost plugin-sidebar-action";
    button.textContent = action;
    body.append(button);
  }
  section.append(header, body);
  return section;
}

function commandLabel(commandId) {
  return (
    {
      "notes.new": "New note",
      "notes.captureUrl": "Capture URL",
      "artifacts.export": "Export",
    }[commandId] ?? commandId
  );
}

function loadManagerFilter() {
  try {
    const saved = globalThis.sessionStorage?.getItem(MANAGER_FILTER_STORAGE_KEY);
    if (["installed", "builtIn", "disabled", "developer"].includes(saved)) return saved;
  } catch {
    // Session UI persistence is optional in restricted webviews and tests.
  }
  return "installed";
}

function commandPaletteIcon(icon) {
  return (
    {
      add: "+",
      clip: "↗",
      open: "↗",
      settings: "⚙",
      export: "⇧",
    }[icon] ?? "•"
  );
}

function escapeSelector(value) {
  return globalThis.CSS?.escape?.(value) ?? value.replaceAll(".", "\\.");
}

function iconSvg(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const paths = {
    chat: [
      ["path", { d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" }],
      ["path", { d: "M8 9h8M8 13h5" }],
    ],
    notes: [
      ["path", { d: "M6 3h9l3 3v15H6z" }],
      ["path", { d: "M14 3v4h4M9 11h6M9 15h6" }],
    ],
    finance: [
      ["path", { d: "M4 19V9M10 19V5M16 19v-7M22 19H2" }],
      ["path", { d: "m3 7 5-4 5 5 7-6" }],
    ],
    projects: [
      ["path", { d: "M3 6h7l2 2h9v11H3z" }],
      ["path", { d: "M7 13h10M7 16h6" }],
    ],
    tasks: [
      ["path", { d: "M6 3h12v18H6z" }],
      ["path", { d: "m9 9 1.5 1.5L14 7M9 15h5" }],
    ],
    automation: [
      ["path", { d: "M4 7h10M14 7l-2-2M14 7l-2 2M20 17H10M10 17l2-2M10 17l2 2" }],
      ["circle", { cx: "6", cy: "17", r: "2" }],
      ["circle", { cx: "18", cy: "7", r: "2" }],
    ],
    files: [
      ["path", { d: "M3 6h7l2 2h9v11H3z" }],
      ["path", { d: "M3 10h18" }],
    ],
    artifacts: [
      ["path", { d: "M4 4h16v16H4z" }],
      ["path", { d: "M8 15l3-3 2 2 3-4 2 3M8 8h3" }],
    ],
    plugins: [
      ["path", { d: "M8 3v4M16 3v4M5 7h14v5a7 7 0 0 1-14 0Z" }],
      ["path", { d: "M9 21v-3M15 21v-3" }],
    ],
    command: [
      [
        "path",
        { d: "M9 6H7a3 3 0 1 0 3 3V7a3 3 0 1 0-3 3H5M15 18h2a3 3 0 1 0-3-3v2a3 3 0 1 0 3-3h2" },
      ],
    ],
    settings: [
      ["circle", { cx: "12", cy: "12", r: "3" }],
      [
        "path",
        {
          d: "M19 12a7 7 0 0 0-.1-1l2-1-2-4-2 1a7 7 0 0 0-2-1l-.3-3h-5L9 6a7 7 0 0 0-2 1L5 6 3 10l2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a7 7 0 0 0 2 1l.5 3h5l.5-3a7 7 0 0 0 2-1l2 1 2-4-2-1a7 7 0 0 0 .1-1Z",
        },
      ],
    ],
    help: [
      ["circle", { cx: "12", cy: "12", r: "9" }],
      ["path", { d: "M9.8 9a2.4 2.4 0 1 1 4.4 1.3c-.7 1-2.2 1.2-2.2 2.7M12 17h.01" }],
    ],
    more: [
      ["circle", { cx: "5", cy: "12", r: "1" }],
      ["circle", { cx: "12", cy: "12", r: "1" }],
      ["circle", { cx: "19", cy: "12", r: "1" }],
    ],
    close: [
      ["path", { d: "M6 6l12 12M18 6 6 18" }],
    ],
    add: [["path", { d: "M12 5v14M5 12h14" }]],
    clip: [["path", { d: "m10 13 4-4a3 3 0 1 1 4 4l-6 6a5 5 0 0 1-7-7l6-6" }]],
    open: [
      ["path", { d: "M14 4h6v6M20 4l-9 9" }],
      ["path", { d: "M18 13v6H5V6h6" }],
    ],
    export: [
      ["path", { d: "M12 3v12M8 7l4-4 4 4" }],
      ["path", { d: "M5 13v7h14v-7" }],
    ],
    chevron: [["path", { d: "m9 18 6-6-6-6" }]],
  };
  for (const [tag, attributes] of paths[name] ?? paths.artifacts) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}
