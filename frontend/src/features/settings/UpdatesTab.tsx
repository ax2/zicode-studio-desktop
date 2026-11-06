import { t } from "../../shared/i18n";
import { SettingsToggle } from "./SettingsToggle";
import type { SettingsStore } from "./store";
import type { SettingsWidgetsStore } from "./settingsWidgetsStore";
import { useAppUpdaterStore } from "./updaterStore";

export function UpdatesTab({ store, widgets }: { store: SettingsStore; widgets: SettingsWidgetsStore }) {
  const piVersion = store(state => state.piVersion), appVersion = store(state => state.appVersion);
  const toggles = widgets(state => state.toggles);
  const updater = useAppUpdaterStore();
  return <>
      <div className="settings-section" id="setting-updater-section">
        <div className="settings-section-title">{t("Software updates")}</div>
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
              {updater.status || t("Click to check")}
            </span>
            <button
              type="button"
              className="ui-button ui-button--secondary settings-value-btn"
              id="btn-check-updates"
              disabled={updater.disabled}
              data-mode={updater.canInstall ? "install" : "check"}
              aria-busy={updater.disabled ? "true" : "false"}
              onClick={() => {
                if (!updater.enabled) {
                  // Signed auto-updates are disabled; open the manual
                  // installer list advertised by this button.
                  const url = "https://github.com/ax2/zicode-studio-desktop/releases";
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.target = "_blank";
                  anchor.rel = "noopener noreferrer";
                  document.body.append(anchor);
                  anchor.click();
                  anchor.remove();
                  return;
                }
                if (updater.canInstall) {
                  void updater.installUpdate();
                } else {
                  void updater.checkNow();
                }
              }}
            >
              {updater.button || t("Check now")}
            </button>
          </span>
        </div>
        <div className={`settings-row${updater.enabled ? "" : " hidden"}`}>
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Beta updates")}</span>
            <span className="settings-label-sub">{t("Receive prerelease desktop builds")}</span>
          </span>
          <SettingsToggle
            id="toggle-beta-updates"
            disabled={updater.installing || updater.checking}
            enabled={Boolean(toggles["beta-updates"])}
            ariaLabel={t("Receive prerelease desktop builds")}
            onChange={() => widgets.getState().toggle("beta-updates")}
          />
        </div>
      </div>
    {updater.update?.body && <details className="ui-card"><summary>{t("Release notes")}</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} translate="no">{updater.update.body.slice(0, 16000)}</p></details>}
    <p className="ui-muted">{t("Installing an update will restart Studio. Save your work first.")}</p>
  </>;
}
