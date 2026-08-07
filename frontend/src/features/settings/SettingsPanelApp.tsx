import { useEffect, useState } from "react";
// @ts-expect-error plain JS module without type declarations (public/i18n.js)
import { getLocale, setLocale, supportedLocales } from "../../../../public/i18n.js";
// @ts-expect-error plain JS module without type declarations (public/themes.js)
import { applyTheme, getCurrentTheme, themes } from "../../../../public/themes.js";
import { t } from "../../shared/i18n";
import { ConfigTab } from "./ConfigTab";
import type { ConfigStore } from "./configStore";
import { SETTINGS_TABS, type SettingsTabKey } from "./logic";
import { RemoteAccessTab } from "./RemoteAccessTab";
import type { RemoteAccessStore } from "./remoteAccessStore";
import type { SettingsStore } from "./store";

export interface SettingsController {
  configStore: ConfigStore;
  remoteAccessStore: RemoteAccessStore;
  loadForTab(tab: SettingsTabKey): void;
  wireVanilla(): void;
  reloadVisibleConfiguration(): void;
  setTarget(target: unknown): void;
}

export function SettingsApp({
  store,
  controller,
}: {
  store: SettingsStore;
  controller: SettingsController;
}) {
  const open = store((state) => state.open);
  const embedded = store((state) => state.embedded);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && store.getState().open) {
        store.getState().closeSettings();
      }
    };
    const onHash = () => store.getState().restoreFromHash();
    const onConfigGatewayReady = () => controller.reloadVisibleConfiguration();
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("picot-config-gateway-ready", onConfigGatewayReady);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("picot-config-gateway-ready", onConfigGatewayReady);
    };
  }, [store, controller]);

  if (embedded) return null;
  return (
    <>
      <div className="settings-overlay hidden" id="settings-overlay" />
      <div className={`settings-panel${open ? "" : " hidden"}`} id="settings-panel">
        <SettingsNav store={store} />
        <SettingsContent store={store} controller={controller} />
      </div>
    </>
  );
}

export function SettingsNav({ store }: { store: SettingsStore }) {
  const activeTab = store((state) => state.activeTab);
  const navigateTab = store((state) => state.navigateTab);
  const closeSettings = store((state) => state.closeSettings);
  return (
    <aside className="settings-nav">
      <div className="settings-nav-title">{t("Settings")}</div>
      {SETTINGS_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`settings-nav-item${activeTab === tab.key ? " active" : ""}`}
          data-settings-tab={tab.key}
          onClick={() => navigateTab(tab.key)}
        >
          {t(tab.label)}
        </button>
      ))}
      <button
        type="button"
        className="settings-nav-back"
        id="settings-close"
        onClick={() => closeSettings()}
      >
        <span className="settings-nav-back-icon">‹</span> {t("Back to chat")}
      </button>
    </aside>
  );
}

export function SettingsContent({
  store,
  controller,
}: {
  store: SettingsStore;
  controller: SettingsController;
}) {
  const activeTab = store((state) => state.activeTab);
  const open = store((state) => state.open);
  const embedded = store((state) => state.embedded);

  useEffect(() => {
    // Every mount creates a fresh React-owned DOM subtree. The vanilla
    // sub-panels (scene profiles, toggles, thinking effort, configuration,
    // remote access, package browse) bind by element id, so they must be
    // re-wired against the newly mounted elements.
    controller.wireVanilla();
  }, [controller]);

  useEffect(() => {
    if (!open && !embedded) return;
    controller.loadForTab(activeTab);
  }, [activeTab, open, embedded, controller]);

  return (
    <section className="settings-content">
      <div
        className={`settings-tab${activeTab === "general" ? " active" : ""}`}
        data-settings-panel="general"
      >
        <GeneralTab store={store} />
      </div>
      <div
        className={`settings-tab${activeTab === "extensions" ? " active" : ""}`}
        data-settings-panel="extensions"
      >
        <ExtensionsTab />
      </div>
      <div
        className={`settings-tab${activeTab === "usage" ? " active" : ""}`}
        data-settings-panel="usage"
      >
        <UsageTab />
      </div>
      <div
        className={`settings-tab${activeTab === "configuration" ? " active" : ""}`}
        data-settings-panel="configuration"
      >
        <ConfigTab store={controller.configStore} />
      </div>
      <div
        className={`settings-tab${activeTab === "remote-access" ? " active" : ""}`}
        data-settings-panel="remote-access"
      >
        <div id="settings-remote-access">
          <RemoteAccessTab store={controller.remoteAccessStore} />
        </div>
      </div>
      <chat-settings-panel
        className={`settings-tab${activeTab === "chat" ? " active" : ""}`}
        data-settings-panel="chat"
      />
    </section>
  );
}

function AppearancePreferences() {
  const [localeTick, setLocaleTick] = useState(0);
  useEffect(() => {
    const onLocaleChanged = () => setLocaleTick((value) => value + 1);
    window.addEventListener("zicode:locale-changed", onLocaleChanged);
    return () => window.removeEventListener("zicode:locale-changed", onLocaleChanged);
  }, []);
  void localeTick;
  const currentTheme = getCurrentTheme();
  const locale = getLocale();
  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("Appearance")}</div>
      <label className="settings-row" htmlFor="theme-select">
        <span className="settings-label">{t("Theme")}</span>
        <select
          className="ui-select settings-preference-select"
          id="theme-select"
          value={currentTheme}
          onChange={(event) => applyTheme(event.target.value)}
        >
          {Object.entries(themes as Record<string, { name: Record<string, string> }>).map(
            ([id, theme]) => (
            <option key={id} value={id}>
              {theme.name[locale] || theme.name.en}
            </option>
            ),
          )}
        </select>
      </label>
      <label className="settings-row" htmlFor="language-select">
        <span className="settings-label">{t("Language")}</span>
        <select
          className="ui-select settings-preference-select"
          id="language-select"
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
        >
          {Object.entries(supportedLocales).map(([id, name]) => (
            <option key={id} value={id}>
              {String(name)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function GeneralTab({ store }: { store: SettingsStore }) {
  const piVersion = store((state) => state.piVersion);
  const appVersion = store((state) => state.appVersion);
  return (
    <div className="settings-body">
      <AppearancePreferences />
      <div className="settings-section">
        <div className="settings-section-title">{t("Agent")}</div>
        <div className="settings-row" id="setting-auto-compact">
          <span className="settings-label">{t("Auto-compaction")}</span>
          <button type="button" className="settings-toggle" id="toggle-auto-compact"></button>
        </div>
        <div className="settings-row" id="setting-thinking">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Thinking effort")}</span>
            <span className="settings-label-sub">{t("Reasoning depth")}</span>
          </span>
          <div
            className="thinking-effort"
            id="thinking-effort"
            role="radiogroup"
            aria-label={t("Thinking effort")}
          >
            <div className="thinking-effort-ends">
              <span>{t("Faster")}</span>
              <span className="thinking-effort-name" id="thinking-effort-name">
                {t("off")}
              </span>
              <span>{t("Smarter")}</span>
            </div>
            <div className="thinking-effort-track" id="thinking-effort-steps">
              <span
                className="thinking-effort-thumb"
                id="thinking-effort-marker"
                aria-hidden="true"
              ></span>
              {(["off", "minimal", "low", "medium", "high"] as const).map((level, index) => (
                // biome-ignore lint/a11y/useSemanticElements: button-based radio pattern required by the vanilla thinking-effort control
                <button
                  key={level}
                  type="button"
                  className="thinking-effort-dot"
                  data-level={level}
                  role="radio"
                  aria-checked={index === 0 ? "true" : "false"}
                  aria-label={level}
                  title={level}
                ></button>
              ))}
            </div>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-label">{t("Show thinking")}</span>
          <button type="button" className="settings-toggle on" id="toggle-show-thinking"></button>
        </div>
      </div>
      <div className="settings-section hidden" id="mobile-task-notification-section">
        <div className="settings-section-title">{t("Mobile")}</div>
        <div className="settings-row">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Task completion alerts")}</span>
            <span className="settings-label-sub">
              Notify when Pi finishes in the background
            </span>
          </span>
          <button
            type="button"
            className="settings-toggle"
            id="toggle-mobile-task-notifications"
            role="switch"
            aria-checked="false"
            aria-label={t("Task completion alerts")}
          ></button>
        </div>
        <p
          className="settings-help"
          id="mobile-task-notification-status"
          role="status"
          aria-live="polite"
        ></p>
        <div className="settings-row hidden" id="mobile-draft-storage-row">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Protect local drafts")}</span>
            <span className="settings-label-sub">
              Ask the browser not to evict encrypted drafts automatically
            </span>
          </span>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            id="protect-mobile-draft-storage"
          >
            {t("Protect drafts")}
          </button>
        </div>
        <p
          className="settings-help"
          id="mobile-draft-storage-status"
          role="status"
          aria-live="polite"
        ></p>
      </div>
      <div className="settings-section" id="scene-profile-section">
        <div className="settings-section-title">{t("New session scene")}</div>
        <div className="settings-scene-context">
          <span className="settings-scene-context-label">{t("Current session")}</span>
          <strong id="scene-profile-current-name">Programming</strong>
          <code id="scene-profile-current-id">programming</code>
        </div>
        <p className="settings-help">
          Each scene has isolated model channels, credentials, extensions, and sessions. The
          selection applies when you create the next session.
        </p>
        <div className="settings-row">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Scene for the next session")}</span>
            <span className="settings-label-sub" id="scene-profile-description"></span>
          </span>
          <select className="ui-input scene-profile-select" id="scene-profile-select"></select>
        </div>
        <div className="scene-profile-actions">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            id="scene-profile-new"
          >
            {t("New custom scene")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary danger hidden"
            id="scene-profile-delete"
          >
            {t("Delete selected")}
          </button>
        </div>
        <form className="scene-profile-editor hidden" id="scene-profile-editor">
          <label>
            <span>{t("Scene ID")}</span>
            <input
              className="ui-input"
              id="scene-profile-id"
              required
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
              placeholder="research"
            />
          </label>
          <label>
            <span>{t("Name")}</span>
            <input
              className="ui-input"
              id="scene-profile-name"
              required
              maxLength={80}
              placeholder="Research"
            />
          </label>
          <label className="scene-profile-wide">
            <span>{t("Description")}</span>
            <input
              className="ui-input"
              id="scene-profile-description-input"
              maxLength={300}
            />
          </label>
          <label className="scene-profile-wide">
            <span>{t("Scene system instructions")}</span>
            <textarea
              className="ui-textarea"
              id="scene-profile-prompt"
              rows={5}
            ></textarea>
          </label>
          <label className="scene-profile-wide">
            <span>{t("Allowed tools (comma-separated; blank allows all)")}</span>
            <input className="ui-input" id="scene-profile-tools" placeholder="read, grep, find" />
          </label>
          <div
            className="settings-save-status hidden scene-profile-wide"
            id="scene-profile-status"
            aria-live="polite"
            role="status"
          ></div>
          <div className="settings-config-actions scene-profile-wide">
            <button
              type="button"
              className="ui-button ui-button--secondary"
              id="scene-profile-cancel"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              className="ui-button ui-button--primary"
              id="scene-profile-save"
            >
              {t("Save scene")}
            </button>
          </div>
        </form>
      </div>
      <div className="settings-section" id="setting-updater-section">
        <div className="settings-section-title">{t("Updates")}</div>
        <div className="settings-row" id="setting-pi-version">
          <span className="settings-label">{t("Pi version")}</span>
          <span className="settings-static-value" id="setting-pi-version-value">
            {piVersion}
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-label">{t("Desktop version")}</span>
          <span className="settings-static-value" id="setting-app-version-value">
            {appVersion}
          </span>
        </div>
        <div className="settings-row settings-update-row">
          <span className="settings-label">{t("Updates")}</span>
          <span className="settings-update-controls">
            <span
              className="settings-static-value"
              id="setting-update-status"
              role="status"
              aria-live="polite"
            >
              {t("Click to check")}
            </span>
            <button
              type="button"
              className="ui-button ui-button--secondary settings-value-btn"
              id="btn-check-updates"
            >
              {t("Check now")}
            </button>
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Beta updates")}</span>
            <span className="settings-label-sub">{t("Receive prerelease desktop builds")}</span>
          </span>
          <button
            type="button"
            className="settings-toggle"
            id="toggle-beta-updates"
            role="switch"
            aria-label={t("Receive prerelease desktop builds")}
            aria-checked="false"
          ></button>
        </div>
      </div>
    </div>
  );
}

function ExtensionsTab() {
  return (
    <div className="settings-body">
      <div className="settings-section">
        <div className="settings-section-title">Browse Community Packages</div>
        <p className="settings-help">
          Discover extensions, skills, themes, and prompts from the Pi ecosystem. Install with
          one click.
        </p>
        <div className="pkg-browse-filters">
          <input
            type="text"
            id="pkg-browse-search"
            className="pkg-browse-search"
            placeholder="Search packages..."
            autoComplete="off"
            spellCheck={false}
          />
          <div className="pkg-browse-pills" id="pkg-browse-pills">
            <button type="button" className="pkg-browse-pill active" data-pkg-type="all">
              All
            </button>
            <button type="button" className="pkg-browse-pill" data-pkg-type="extension">
              Extensions
            </button>
            <button type="button" className="pkg-browse-pill" data-pkg-type="skill">
              Skills
            </button>
            <button type="button" className="pkg-browse-pill" data-pkg-type="theme">
              Themes
            </button>
            <button type="button" className="pkg-browse-pill" data-pkg-type="prompt">
              Prompts
            </button>
          </div>
          <label className="pkg-browse-installed-toggle">
            <input type="checkbox" id="pkg-browse-installed-only" />
            <span>Installed only</span>
          </label>
          <select
            id="pkg-browse-sort"
            className="pkg-browse-sort"
            aria-label="Sort packages"
          >
            <option value="downloads">Most downloads</option>
            <option value="name">Name (A–Z)</option>
            <option value="updated">Recently updated</option>
          </select>
          <span className="pkg-browse-count" id="pkg-browse-count"></span>
        </div>
        <div
          className="settings-extension-list pkg-browse-list"
          id="pkg-browse-list"
        ></div>
        <div className="pkg-browse-pagination" id="pkg-browse-pagination" hidden></div>
      </div>
    </div>
  );
}

function UsageTab() {
  return (
    <div className="settings-usage-embed">
      <cost-dashboard id="settings-cost-dashboard" defer-load embedded />
    </div>
  );
}
