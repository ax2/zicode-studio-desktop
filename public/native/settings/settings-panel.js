import { getLocale, setLocale, supportedLocales } from "../../i18n.js";
import { applyTheme, getCurrentTheme, themes } from "../../themes.js";
import { loadCostDashboard } from "./cost-dashboard.js";
import { setupPackageBrowse } from "./package-browse.js";
import { setupRemoteAccessSettings } from "./remote-access-settings.js";
import { setupSceneProfiles } from "./scene-profiles.js";
import { setupSettingsConfig } from "./settings-config.js";
import { setupSettingsToggles } from "./settings-toggles.js";
import { setupThinkingEffortControl } from "./thinking-effort-control.js";

// Wires the settings overlay panel for the native runtime: open/close, tab
// switching, appearance preferences, the embedded pi version readout, the Usage tab (cost
// dashboard), the Extensions tab (community package browse), and the
// Configuration tab (API keys / model catalog + agent-config / models.json
// editors). When `data` + `getWorkspaceId` are supplied the Usage tab loads
// aggregated cost data from the native host on first open. `control` is a
// HostControlGateway (or null) used by the Extensions tab to list/install/remove
// packages via the embedded pi CLI. `configGateway` (or null) drives the
// Configuration tab via the picot-bridge extension. Both tabs are populated
// lazily whenever they are shown.
export function setupSettingsPanel({
  data,
  getWorkspaceId,
  control,
  remoteAccessGateway,
  configGateway,
  onModelConfigurationChanged,
  runtime,
  getTarget,
  onError,
  notify,
} = {}) {
  const panel = document.getElementById("settings-panel");
  const openBtn = document.getElementById("settings-btn");
  const closeBtn = document.getElementById("settings-close");
  const overlay = document.getElementById("settings-overlay");
  const navigation = panel?.querySelector(".settings-nav");
  const content = panel?.querySelector(".settings-content");
  if (!panel || !navigation || !content) return;

  const navItems = Array.from(document.querySelectorAll(".settings-nav-item"));
  const tabs = Array.from(document.querySelectorAll(".settings-tab"));
  const validTabKeys = new Set(navItems.map((item) => item.dataset.settingsTab));
  const themeSelect = document.getElementById("theme-select");
  const languageSelect = document.getElementById("language-select");
  const piVersionValue = document.getElementById("setting-pi-version-value");
  const appVersionValue = document.getElementById("setting-app-version-value");
  const costDashboard = document.getElementById("settings-cost-dashboard");
  const packageBrowse = setupPackageBrowse(control, { notify });
  const remoteAccess = setupRemoteAccessSettings({ gateway: remoteAccessGateway });
  const sceneProfiles = setupSceneProfiles({ getTarget });
  const config = configGateway
    ? setupSettingsConfig({ configGateway, onModelConfigurationChanged, getTarget })
    : null;
  const thinkingControl = runtime
    ? setupThinkingEffortControl({ runtime, getTarget, onError })
    : null;
  setupSettingsToggles();
  let usageLoaded = false;
  let activeTab = "general";
  let embeddedActive = false;
  let openHandler = null;

  function loadUsage() {
    if (usageLoaded || !costDashboard || !data || !getWorkspaceId) return;
    usageLoaded = true;
    void loadCostDashboard(costDashboard, { data, getWorkspaceId });
  }

  function loadConfiguration() {
    if (!config) return;
    void config.loadApiKeysPanel();
    void config.loadProviderChannels();
    void config.loadInlineConfigEditor();
    void config.loadInlineModelsEditor();
  }

  function reloadVisibleConfiguration() {
    if (activeTab !== "configuration") return;
    if (!embeddedActive && panel.classList.contains("hidden")) return;
    loadConfiguration();
  }

  function selectTab(tabKey = "general") {
    const target = tabKey === "auth" ? "configuration" : tabKey;
    activeTab = validTabKeys.has(target) ? target : "general";
    for (const item of navItems) {
      item.classList.toggle("active", item.dataset.settingsTab === activeTab);
    }
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.dataset.settingsPanel === activeTab);
    }

    if (activeTab === "usage") loadUsage();
    if (activeTab === "general") void sceneProfiles?.load();
    if (activeTab === "extensions") void packageBrowse.load();
    if (activeTab === "configuration") loadConfiguration();
    if (activeTab === "remote-access") void remoteAccess?.load();
  }

  function buildAppearancePreferences() {
    const current = getCurrentTheme();
    if (themeSelect) {
      themeSelect.replaceChildren();
      for (const [id, theme] of Object.entries(themes)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = theme.name[getLocale()] || theme.name.en;
        option.selected = current === id;
        themeSelect.append(option);
      }
      themeSelect.onchange = () => applyTheme(themeSelect.value);
    }
    if (!languageSelect) return;
    languageSelect.replaceChildren();
    for (const [id, name] of Object.entries(supportedLocales)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = name;
      option.selected = getLocale() === id;
      languageSelect.append(option);
    }
    languageSelect.onchange = () => {
      setLocale(languageSelect.value);
      buildAppearancePreferences();
    };
  }

  function refreshThemeNames() {
    if (!themeSelect) return;
    for (const [id, theme] of Object.entries(themes)) {
      const option = themeSelect.querySelector(`option[value="${id}"]`);
      if (option) option.textContent = theme.name[getLocale()] || theme.name.en;
    }
  }

  window.addEventListener("zicode:locale-changed", refreshThemeNames);
  window.addEventListener("picot-config-gateway-ready", reloadVisibleConfiguration);

  async function loadPiVersion() {
    if (!piVersionValue) return;
    piVersionValue.textContent = "Loading…";
    try {
      const response = await fetch("/health");
      const health = await response.json();
      piVersionValue.textContent = health?.piVersion || "Unavailable";
    } catch {
      piVersionValue.textContent = "Unavailable";
    }
  }

  async function loadAppVersion() {
    if (!appVersionValue) return;
    try {
      const version = await globalThis.__TAURI__?.app?.getVersion?.();
      appVersionValue.textContent = version ? `v${version}` : "Unavailable";
    } catch {
      appVersionValue.textContent = "Unavailable";
    }
  }

  // Persist "settings is open, on tab X" to the URL hash (independent of the
  // path-based session route) so a page refresh — or opening a link that
  // still has the hash from before a reload — reopens the same settings tab
  // instead of silently dropping back to the chat view.
  function normalizeSettingsTabKey(tabKey) {
    const rawTabKey = typeof tabKey === "string" ? tabKey : "general";
    const decodedTabKey = decodeURIComponent(rawTabKey || "general");
    const normalizedTabKey = decodedTabKey === "auth" ? "configuration" : decodedTabKey;
    return validTabKeys.has(normalizedTabKey) ? normalizedTabKey : "general";
  }

  function settingsHashForTab(tabKey) {
    return `#/settings/${encodeURIComponent(normalizeSettingsTabKey(tabKey))}`;
  }

  function updateSettingsHash(tabKey) {
    const nextHash = settingsHashForTab(tabKey);
    if (window.location.hash === nextHash) return;
    history.replaceState(
      history.state,
      "",
      `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }

  function clearSettingsHash() {
    if (!window.location.hash.startsWith("#/settings")) return;
    history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
  }

  function openSettings(tabKey = "general", { updateHash = true } = {}) {
    const normalizedTabKey = normalizeSettingsTabKey(tabKey);
    if (updateHash) updateSettingsHash(normalizedTabKey);
    selectTab(normalizedTabKey);
    if (openHandler) {
      openHandler(normalizedTabKey);
      return;
    }
    panel.classList.remove("hidden");
    buildAppearancePreferences();
    void loadPiVersion();
    void loadAppVersion();
  }

  function closeSettings({ clearHash = true } = {}) {
    if (clearHash) clearSettingsHash();
    if (openHandler) {
      openHandler(null);
      return;
    }
    panel.classList.add("hidden");
  }

  function restoreFromHash() {
    const route = window.location.hash.slice(1);
    if (route === "/settings" || route.startsWith("/settings/")) {
      const tabKey = route.split("/")[2] || "general";
      openSettings(tabKey, { updateHash: false });
      return;
    }
    if (embeddedActive || !panel.classList.contains("hidden")) {
      closeSettings({ clearHash: false });
    }
  }

  openBtn?.addEventListener("click", () => openSettings());
  closeBtn?.addEventListener("click", () => closeSettings());
  overlay?.addEventListener("click", () => closeSettings());
  for (const item of navItems) {
    item.addEventListener("click", () => {
      openSettings(item.dataset.settingsTab);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.classList.contains("hidden")) closeSettings();
  });
  window.addEventListener("hashchange", restoreFromHash);
  restoreFromHash();

  return {
    openSettings,
    closeSettings,
    getActiveTab: () => activeTab,
    setOpenHandler(handler) {
      openHandler = typeof handler === "function" ? handler : null;
      if (!openHandler) return;
      panel.classList.add("hidden");
      overlay?.classList.add("hidden");
      const route = window.location.hash.slice(1);
      if (route === "/settings" || route.startsWith("/settings/")) {
        openHandler(normalizeSettingsTabKey(route.split("/")[2] || "general"));
      }
    },
    renderNavigation(container) {
      closeBtn?.classList.add("hidden");
      navigation.querySelector(".settings-nav-title")?.classList.add("hidden");
      container.append(navigation);
    },
    renderContent(container) {
      embeddedActive = true;
      panel.classList.add("hidden");
      overlay?.classList.add("hidden");
      container.replaceChildren(content);
      selectTab(activeTab);
      buildAppearancePreferences();
      void loadPiVersion();
      void loadAppVersion();
    },
    deactivate() {
      embeddedActive = false;
    },
    thinkingControl,
    setTarget(nextTarget) {
      sceneProfiles?.setTarget(nextTarget);
      config?.setTarget(nextTarget);
      reloadVisibleConfiguration();
    },
  };
}
