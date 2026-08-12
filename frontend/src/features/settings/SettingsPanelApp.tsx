import { useEffect, useRef, useState } from "react";
import { getLocale, setLocale, supportedLocales } from "i18n";
import { applyTheme, getCurrentTheme, themes } from "themes";
import { t } from "../../shared/i18n";
import { ConfigTab } from "./ConfigTab";
import type { ConfigStore } from "./configStore";
import { CostDashboardTab } from "./CostDashboardTab";
import type { CostDashboardStore } from "./costDashboardStore";
import { SETTINGS_TABS, type SettingsTabKey } from "./logic";
import { PackageBrowseTab } from "./PackageBrowseTab";
import type { PackageBrowseStore } from "./packageBrowseStore";
import { RemoteAccessTab } from "./RemoteAccessTab";
import type { RemoteAccessStore } from "./remoteAccessStore";
import type { SettingsWidgetsStore } from "./settingsWidgetsStore";
import { useStoragePersistenceState } from "./storagePersistenceStore";
import type { SettingsStore } from "./store";
import { useTaskNotificationsState } from "./taskNotificationsStore";
import { useAppUpdaterStore } from "./updaterStore";
import {
  formatBackupSize,
  type BackupStore,
} from "./backupStore";

export interface SettingsController {
  configStore: ConfigStore;
  remoteAccessStore: RemoteAccessStore;
  backupStore: BackupStore;
  costDashboardStore: CostDashboardStore;
  packageBrowseStore: PackageBrowseStore;
  widgetsStore: SettingsWidgetsStore;
  getWorkspaceId?: () => string | undefined;
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
        <GeneralTab store={store} widgets={controller.widgetsStore} controller={controller} />
      </div>
      <div
        className={`settings-tab${activeTab === "extensions" ? " active" : ""}`}
        data-settings-panel="extensions"
      >
        <PackageBrowseTab store={controller.packageBrowseStore} />
      </div>
      <div
        className={`settings-tab${activeTab === "usage" ? " active" : ""}`}
        data-settings-panel="usage"
      >
        <CostDashboardTab
          store={controller.costDashboardStore}
          onRetry={() => controller.loadForTab("usage")}
        />
      </div>
      <div
        className={`settings-tab${activeTab === "configuration" ? " active" : ""}`}
        data-settings-panel="configuration"
      >
        <ConfigTab store={controller.configStore} widgets={controller.widgetsStore} />
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
  const [themeId, setThemeId] = useState(currentTheme);
  return (
    <div className="settings-section">
      <div className="settings-section-title">{t("Appearance")}</div>
      <label className="settings-row" htmlFor="theme-select">
        <span className="settings-label">{t("Theme")}</span>
        <select
          className="ui-select settings-preference-select"
          id="theme-select"
          value={themeId}
          onChange={(event) => {
            applyTheme(event.target.value);
            setThemeId(event.target.value);
          }}
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

function SettingsToggle({
  id,
  enabled,
  onChange,
  ariaLabel,
}: {
  id: string;
  enabled: boolean;
  onChange(): void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`settings-toggle${enabled ? " on" : ""}`}
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={onChange}
    ></button>
  );
}

function ThinkingEffortControl({
  widgets,
  level,
}: {
  widgets: SettingsWidgetsStore;
  level: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const levels = ["off", "minimal", "low", "medium", "high"];
  useEffect(() => {
    const track = trackRef.current;
    const marker = markerRef.current;
    const active = track?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    if (track && marker && active) {
      const thumbOffset = active.offsetLeft + (active.offsetWidth - marker.offsetWidth) / 2;
      marker.style.left = `${thumbOffset}px`;
      marker.dataset.level = level;
    }
  }, [level]);
  return (
    <div
      className="thinking-effort"
      id="thinking-effort"
      role="radiogroup"
      aria-label={t("Thinking effort")}
      onKeyDown={(event) => {
        const index = levels.indexOf(level);
        let nextIndex = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          nextIndex = (index + 1) % levels.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          nextIndex = (index - 1 + levels.length) % levels.length;
        } else {
          return;
        }
        void widgets.getState().setThinkingLevel(levels[nextIndex]);
      }}
    >
      <div className="thinking-effort-ends">
        <span>{t("Faster")}</span>
        <span className="thinking-effort-name" id="thinking-effort-name">
          {t(level)}
        </span>
        <span>{t("Smarter")}</span>
      </div>
      <div className="thinking-effort-track" id="thinking-effort-steps" ref={trackRef}>
        <span
          className="thinking-effort-thumb"
          id="thinking-effort-marker"
          aria-hidden="true"
          ref={markerRef}
        ></span>
        {levels.map((lvl) => (
          // biome-ignore lint/a11y/useSemanticElements: button-based radio pattern for the thinking effort control
          <button
            key={lvl}
            type="button"
            className="thinking-effort-dot"
            data-level={lvl}
            role="radio"
            aria-checked={level === lvl}
            aria-label={lvl}
            title={lvl}
            onClick={() => void widgets.getState().setThinkingLevel(lvl)}
          ></button>
        ))}
      </div>
    </div>
  );
}

function SceneProfilesSection({ widgets }: { widgets: SettingsWidgetsStore }) {
  const profiles = widgets((state) => state.sceneProfiles);
  const selectedId = widgets((state) => state.sceneSelectedId);
  const currentId = widgets((state) => state.sceneCurrentId);
  const editorOpen = widgets((state) => state.sceneEditorOpen);
  const form = widgets((state) => state.sceneForm);
  const status = widgets((state) => state.sceneStatus);
  const saving = widgets((state) => state.sceneSaving);
  const setForm = widgets((state) => state.setSceneForm);
  useEffect(() => {
    void widgets.getState().loadSceneProfiles();
  }, [widgets]);
  const selected = profiles.find((profile) => profile.id === selectedId) || profiles[0];
  const current = profiles.find((profile) => profile.id === currentId);
  return (
    <div className="settings-section" id="scene-profile-section">
      <div className="settings-section-title">{t("New session scene")}</div>
      <div className="settings-scene-context">
        <span className="settings-scene-context-label">{t("Current session")}</span>
        <strong id="scene-profile-current-name">{current?.name || currentId}</strong>
        <code id="scene-profile-current-id">{currentId}</code>
      </div>
      <p className="settings-help">
        Each scene has isolated model channels, credentials, extensions, and sessions. The
        selection applies when you create the next session.
      </p>
      <div className="settings-row">
        <span className="settings-label settings-label-stack">
          <span className="settings-label-main">{t("Scene for the next session")}</span>
          <span className="settings-label-sub" id="scene-profile-description">
            {selected?.description || ""}
          </span>
        </span>
        <select
          className="ui-input scene-profile-select"
          id="scene-profile-select"
          aria-label={t("Scene for the next session")}
          value={selectedId}
          onChange={(event) => widgets.getState().setSceneSelected(event.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>
      <div className="scene-profile-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          id="scene-profile-new"
          onClick={() => widgets.getState().openSceneEditor()}
        >
          {t("New custom scene")}
        </button>
        <button
          type="button"
          className={`ui-button ui-button--secondary danger${selected?.builtin !== false ? " hidden" : ""}`}
          id="scene-profile-delete"
          onClick={() => void widgets.getState().deleteSceneProfile()}
        >
          {t("Delete selected")}
        </button>
      </div>
      {editorOpen ? (
        <form
          className="scene-profile-editor"
          id="scene-profile-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void widgets.getState().saveSceneProfile();
          }}
        >
          <label>
            <span>{t("Scene ID")}</span>
            <input
              className="ui-input"
              id="scene-profile-id"
              required
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
              placeholder="research"
              value={form.id}
              onChange={(event) => setForm({ id: event.target.value })}
            />
          </label>
          <label>
            <span>{t("Name")}</span>
            <input
              className="ui-input"
              id="scene-profile-name"
              required
              maxLength={80}
              placeholder={t("Research")}
              value={form.name}
              onChange={(event) => setForm({ name: event.target.value })}
            />
          </label>
          <label className="scene-profile-wide">
            <span>{t("Description")}</span>
            <input
              className="ui-input"
              id="scene-profile-description-input"
              maxLength={300}
              value={form.description}
              onChange={(event) => setForm({ description: event.target.value })}
            />
          </label>
          <label className="scene-profile-wide">
            <span>{t("Scene system instructions")}</span>
            <textarea
              className="ui-textarea"
              id="scene-profile-prompt"
              rows={5}
              value={form.systemPrompt}
              onChange={(event) => setForm({ systemPrompt: event.target.value })}
            ></textarea>
          </label>
          <label className="scene-profile-wide">
            <span>{t("Allowed tools (comma-separated; blank allows all)")}</span>
            <input
              className="ui-input"
              id="scene-profile-tools"
              placeholder="read, grep, find"
              value={form.allowedTools}
              onChange={(event) => setForm({ allowedTools: event.target.value })}
            />
          </label>
          <div
            className={`settings-save-status scene-profile-wide${status ? "" : " hidden"}`}
            id="scene-profile-status"
            aria-live="polite"
            role="status"
            data-tone={status?.tone}
          >
            {status?.message || ""}
          </div>
          <div className="settings-config-actions scene-profile-wide">
            <button
              type="button"
              className="ui-button ui-button--secondary"
              id="scene-profile-cancel"
              onClick={() => widgets.getState().closeSceneEditor()}
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              className="ui-button ui-button--primary"
              id="scene-profile-save"
              disabled={saving}
            >
              {saving ? "Saving…" : t("Save scene")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function WorkspaceBackupSection({ store }: { store: BackupStore }) {
  const backups = store((state) => state.backups);
  const loading = store((state) => state.loading);
  const creating = store((state) => state.creating);
  const deletingId = store((state) => state.deletingId);
  const status = store((state) => state.status);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const createBackup = store((state) => state.createBackup);
  const deleteBackup = store((state) => state.deleteBackup);

  return (
    <div className="settings-section" id="workspace-backup-section">
      <div className="settings-section-title">{t("Workspace data backup")}</div>
      <div className="settings-row">
        <span className="settings-label settings-label-stack">
          <span className="settings-label-main">{t("Back up this workspace")}</span>
          <span className="settings-label-sub">
            {t(
              "Snapshots notes, conversations, artifacts, tasks and automations into ~/.zicode/backups. Startup auto-backup runs at most once per day; the newest 7 are kept.",
            )}
          </span>
        </span>
        <button
          type="button"
          id="create-workspace-backup"
          className="ui-button ui-button--secondary settings-value-btn"
          disabled={creating}
          onClick={() => void createBackup()}
        >
          {creating ? t("Backing up…") : t("Back up now")}
        </button>
      </div>
      <p
        className="settings-help"
        id="workspace-backup-status"
        role="status"
        aria-live="polite"
        data-tone={error ? "error" : undefined}
      >
        {status ||
          error ||
          (backups.length > 0
            ? `${t("Latest backup")}: ${new Date(backups[0].createdAt).toLocaleString()}`
            : t("No backups yet"))}
      </p>
      {backups.length > 0 ? (
        <ul className="workspace-backup-list" aria-label={t("Workspace backups")}>
          {backups.slice(0, 7).map((backup) => (
            <li key={backup.id} className="workspace-backup-item">
              <span className="workspace-backup-meta">
                <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
                <span>
                  {formatBackupSize(backup.sizeBytes)} · {backup.apps.join(", ")}
                </span>
              </span>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                disabled={deletingId === backup.id}
                onClick={() => {
                  if (
                    globalThis.confirm?.(
                      `${t("Delete workspace backup")} “${new Date(
                        backup.createdAt,
                      ).toLocaleString()}”? ${t("This cannot be undone.")}`,
                    ) === false
                  ) {
                    return;
                  }
                  void deleteBackup(backup.id);
                }}
              >
                {deletingId === backup.id ? t("Deleting…") : t("Delete")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="ui-button ui-button--ghost ui-button--sm"
        onClick={() => void load()}
        disabled={loading}
      >
        {t("Refresh")}
      </button>
    </div>
  );
}

export function GeneralTab({
  store,
  widgets,
  controller,
}: {
  store: SettingsStore;
  widgets: SettingsWidgetsStore;
  controller: SettingsController;
}) {
  const piVersion = store((state) => state.piVersion);
  const appVersion = store((state) => state.appVersion);
  const toggles = widgets((state) => state.toggles);
  const thinkingLevel = widgets((state) => state.thinkingLevel);
  const updater = useAppUpdaterStore();
  const taskNotifications = useTaskNotificationsState();
  const storagePersistence = useStoragePersistenceState();
  const [sessionExportState, setSessionExportState] = useState<
    "idle" | "busy" | "done" | "error"
  >("idle");
  const [sessionImportState, setSessionImportState] = useState<
    "idle" | "busy" | "done" | "error"
  >("idle");
  const [sessionImportMessage, setSessionImportMessage] = useState("");
  const sessionImportInputRef = useRef<HTMLInputElement | null>(null);
  const exportSessions = async () => {
    const workspaceId = controller.getWorkspaceId?.();
    if (!workspaceId) {
      setSessionExportState("error");
      return;
    }
    setSessionExportState("busy");
    try {
      const response = await fetch(
        `/v2/sessions/export?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { backup?: unknown };
      const blob = new Blob([JSON.stringify(payload.backup ?? {}, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `zicode-sessions-${workspaceId.slice(0, 8)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setSessionExportState("done");
    } catch {
      setSessionExportState("error");
    }
  };
  const importSessions = async (file: File) => {
    const workspaceId = controller.getWorkspaceId?.();
    if (!workspaceId) {
      setSessionImportState("error");
      return;
    }
    setSessionImportState("busy");
    setSessionImportMessage("");
    try {
      const parsed = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      const payload = JSON.parse(parsed) as {
        sessions?: Array<{ sessionId?: unknown; projectPath?: unknown; content?: unknown }>;
      };
      const sessions = Array.isArray(payload.sessions)
        ? payload.sessions
            .map((entry) => ({
              sessionId: String(entry.sessionId ?? ""),
              projectPath: String(entry.projectPath ?? ""),
              content: String(entry.content ?? ""),
            }))
            .filter((entry) => entry.sessionId && entry.content)
        : [];
      if (sessions.length === 0) {
        setSessionImportState("error");
        return;
      }
      const response = await fetch("/v2/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, sessions }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const result = (await response.json()) as {
        imported?: string[];
        skipped?: string[];
        errors?: string[];
      };
      setSessionImportMessage(
        t("Imported {imported}, skipped {skipped}")
          .replace("{imported}", String(result.imported?.length ?? 0))
          .replace("{skipped}", String(result.skipped?.length ?? 0)),
      );
      setSessionImportState("done");
    } catch {
      setSessionImportState("error");
    }
  };
  return (
    <div className="settings-body">
      <AppearancePreferences />
      <div className="settings-section">
        <div className="settings-section-title">{t("Agent")}</div>
        <div className="settings-row" id="setting-auto-compact">
          <span className="settings-label">{t("Auto-compaction")}</span>
          <SettingsToggle
            id="toggle-auto-compact"
            enabled={Boolean(toggles["auto-compact"])}
            ariaLabel={t("Auto-compaction")}
            onChange={() => widgets.getState().toggle("auto-compact")}
          />
        </div>
        <div className="settings-row" id="setting-thinking">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Thinking effort")}</span>
            <span className="settings-label-sub">{t("Reasoning depth")}</span>
          </span>
          <ThinkingEffortControl widgets={widgets} level={thinkingLevel} />
        </div>
        <div className="settings-row">
          <span className="settings-label">{t("Show thinking")}</span>
          <SettingsToggle
            id="toggle-show-thinking"
            enabled={Boolean(toggles["show-thinking"])}
            ariaLabel={t("Show thinking")}
            onChange={() => widgets.getState().toggle("show-thinking")}
          />
        </div>
      </div>
      <div
        className={`settings-section${taskNotifications.hidden ? " hidden" : ""}`}
        id="mobile-task-notification-section"
      >
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
            className={`settings-toggle${taskNotifications.enabled ? " on" : ""}`}
            id="toggle-mobile-task-notifications"
            role="switch"
            aria-checked={taskNotifications.enabled}
            disabled={
              taskNotifications.requesting ||
              !taskNotifications.supported ||
              taskNotifications.permission === "denied"
            }
            aria-busy={taskNotifications.requesting}
            aria-label={t("Task completion alerts")}
            onClick={() =>
              void taskNotifications.setEnabled(!taskNotifications.enabled)
            }
          ></button>
        </div>
        <p
          className="settings-help"
          id="mobile-task-notification-status"
          role="status"
          aria-live="polite"
        >
          {t(taskNotifications.statusKey)}
        </p>
        <div
          className={`settings-row${storagePersistence.hidden ? " hidden" : ""}`}
          id="mobile-draft-storage-row"
        >
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Protect local drafts")}</span>
            <span className="settings-label-sub">
              {t("Ask the browser not to evict encrypted drafts automatically")}
            </span>
          </span>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            id="protect-mobile-draft-storage"
            disabled={storagePersistence.buttonDisabled}
            aria-busy={storagePersistence.requesting}
            onClick={() =>
              void storagePersistence.requestProtection()
            }
          >
            {t(storagePersistence.buttonKey)}
          </button>
        </div>
        <p
          className="settings-help"
          id="mobile-draft-storage-status"
          role="status"
          aria-live="polite"
        >
          {storagePersistence.statusText}
        </p>
      </div>
      <SceneProfilesSection widgets={widgets} />
      <div className="settings-section">
        <div className="settings-section-title">{t("Data")}</div>
        <div className="settings-row">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Export session backup")}</span>
            <span className="settings-label-sub">
              {t("Download every conversation in this workspace as readable JSON.")}
            </span>
          </span>
          <button
            type="button"
            id="export-sessions"
            className="ui-button ui-button--secondary settings-value-btn"
            disabled={sessionExportState === "busy"}
            onClick={() => void exportSessions()}
          >
            {sessionExportState === "busy" ? t("Exporting session backup…") : t("Export")}
          </button>
        </div>
        <p
          className="settings-help"
          id="session-export-status"
          role="status"
          aria-live="polite"
          data-tone={sessionExportState === "error" ? "error" : undefined}
        >
          {sessionExportState === "done"
            ? t("Session backup exported")
            : sessionExportState === "error"
              ? t("Export failed")
              : ""}
        </p>
        <div className="settings-row">
          <span className="settings-label settings-label-stack">
            <span className="settings-label-main">{t("Import session backup")}</span>
            <span className="settings-label-sub">
              {t("Restore conversations from a session backup file (existing sessions are kept).")}
            </span>
          </span>
          <input
            ref={sessionImportInputRef}
            id="import-sessions-input"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importSessions(file);
            }}
          />
          <button
            type="button"
            id="import-sessions"
            className="ui-button ui-button--secondary settings-value-btn"
            disabled={sessionImportState === "busy"}
            onClick={() => sessionImportInputRef.current?.click()}
          >
            {sessionImportState === "busy" ? t("Importing session backup…") : t("Import")}
          </button>
        </div>
        <p
          className="settings-help"
          id="session-import-status"
          role="status"
          aria-live="polite"
          data-tone={sessionImportState === "error" ? "error" : undefined}
        >
          {sessionImportState === "done"
            ? sessionImportMessage
            : sessionImportState === "error"
              ? t("Import failed")
              : ""}
        </p>
        <WorkspaceBackupSection store={controller.backupStore} />
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
                  // Auto-updates are not configured for this build; send the
                  // user to the GitHub Releases page through the global
                  // external-link handler instead of an inert disabled button.
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
            enabled={Boolean(toggles["beta-updates"])}
            ariaLabel={t("Receive prerelease desktop builds")}
            onChange={() => widgets.getState().toggle("beta-updates")}
          />
        </div>
      </div>
    </div>
  );
}
