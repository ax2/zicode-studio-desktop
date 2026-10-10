import { create } from "zustand";
import { t } from "../../shared/i18n";

export interface WorkspaceBackup {
  formatVersion?: number;
  id: string;
  workspaceId: string;
  workspaceRoot: string;
  createdAt: string;
  sizeBytes: number;
  apps: string[];
  contentSha256?: string;
  damaged?: boolean;
}

const BACKUP_APPS = new Set([
  "sessions",
  "notes",
  "artifacts",
  "tasks",
  "automation",
  "finance",
  "idphoto",
  "imagetools",
  "clipboard",
  "habits",
  "watch",
]);

export function hasRestorableBackupMetadata(backup: WorkspaceBackup): boolean {
  if (
    backup.damaged ||
    backup.apps.length === 0 ||
    new Set(backup.apps).size !== backup.apps.length ||
    !backup.apps.every((app) => BACKUP_APPS.has(app)) ||
    (backup.formatVersion !== undefined && ![1, 2].includes(backup.formatVersion))
  ) {
    return false;
  }
  if (backup.formatVersion === 2 && !backup.contentSha256) return false;
  return backup.contentSha256 === undefined || /^[a-f\d]{64}$/i.test(backup.contentSha256);
}

export interface BackupStoreOptions {
  invoke?(command: string, params?: Record<string, unknown>): Promise<unknown>;
  getWorkspaceId?(): string | undefined;
}

interface BackupState {
  workspaceId: string | null;
  backups: WorkspaceBackup[];
  available: boolean;
  loading: boolean;
  creating: boolean;
  deletingId: string | null;
  restoringId: string | null;
  status: string;
  error: string;
  syncWorkspace(): void;
  load(): Promise<void>;
  createBackup(): Promise<void>;
  deleteBackup(id: string, expectedWorkspaceId?: string): Promise<void>;
  restoreBackup(id: string, expectedWorkspaceId?: string): Promise<void>;
}

function resolveInvoke(options: BackupStoreOptions): BackupStoreOptions["invoke"] | null {
  if (options.invoke) return options.invoke;
  const tauriInvoke = (
    globalThis as {
      __TAURI__?: { core?: { invoke?: BackupStoreOptions["invoke"] } };
    }
  ).__TAURI__?.core?.invoke;
  return tauriInvoke ?? null;
}

function isBackupRecord(value: unknown, workspaceId: string): value is WorkspaceBackup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const backup = value as Record<string, unknown>;
  return (
    typeof backup.id === "string" &&
    backup.id.length > 0 &&
    backup.workspaceId === workspaceId &&
    typeof backup.workspaceRoot === "string" &&
    typeof backup.createdAt === "string" &&
    Number.isFinite(Date.parse(backup.createdAt)) &&
    typeof backup.sizeBytes === "number" &&
    Number.isFinite(backup.sizeBytes) &&
    backup.sizeBytes >= 0 &&
    (backup.formatVersion === undefined ||
      (typeof backup.formatVersion === "number" && Number.isInteger(backup.formatVersion))) &&
    (backup.contentSha256 === undefined || typeof backup.contentSha256 === "string") &&
    (backup.damaged === undefined || typeof backup.damaged === "boolean") &&
    Array.isArray(backup.apps) &&
    backup.apps.every((app: unknown) => typeof app === "string") &&
    (backup.damaged === true ||
      (backup.apps.length > 0 &&
        new Set(backup.apps).size === backup.apps.length &&
        backup.apps.every((app: string) => BACKUP_APPS.has(app))))
  );
}

function isRestoreReport(value: unknown, backupId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    report.backupId === backupId &&
    typeof report.preRestoreBackupId === "string" &&
    report.preRestoreBackupId.length > 0 &&
    Array.isArray(report.apps) &&
    report.apps.every((app: unknown) => typeof app === "string") &&
    typeof report.sizeBytes === "number" &&
    Number.isFinite(report.sizeBytes) &&
    report.sizeBytes >= 0
  );
}

export function createBackupStore(options: BackupStoreOptions = {}) {
  const invoke = resolveInvoke(options);
  const getWorkspaceId = options.getWorkspaceId ?? (() => undefined);

  return create<BackupState>()((set, get) => {
    let scopeEpoch = 0;
    let loadRequest = 0;
    const currentWorkspace = () => getWorkspaceId() ?? null;
    const syncWorkspace = () => {
      const workspaceId = currentWorkspace();
      if (get().workspaceId !== workspaceId) {
        scopeEpoch += 1;
        loadRequest += 1;
        set({
          workspaceId,
          backups: [],
          loading: false,
          creating: false,
          deletingId: null,
          restoringId: null,
          status: "",
          error: "",
        });
      }
      return workspaceId;
    };
    const isCurrent = (workspaceId: string, epoch: number) =>
      currentWorkspace() === workspaceId &&
      get().workspaceId === workspaceId &&
      scopeEpoch === epoch;

    return {
      workspaceId: null,
      backups: [],
      available: Boolean(invoke),
      loading: false,
      creating: false,
      deletingId: null,
      restoringId: null,
      status: "",
      error: "",
      syncWorkspace() {
        syncWorkspace();
      },

      async load() {
        const workspaceId = syncWorkspace();
        if (!workspaceId || !invoke) return;
        const epoch = scopeEpoch;
        const request = ++loadRequest;
        set({ loading: true, error: "" });
        try {
          const result = await invoke("list_workspace_backups", { workspaceId });
          if (
            !Array.isArray(result) ||
            !result.every((backup) => isBackupRecord(backup, workspaceId))
          ) {
            throw new Error(t("Could not load workspace backups."));
          }
          if (isCurrent(workspaceId, epoch) && request === loadRequest) {
            set({ backups: result });
          }
        } catch (error) {
          if (isCurrent(workspaceId, epoch) && request === loadRequest)
            set({ error: friendlyBackupError(error) });
        } finally {
          if (isCurrent(workspaceId, epoch) && request === loadRequest) set({ loading: false });
        }
      },

      async createBackup() {
        const workspaceId = syncWorkspace();
        if (!workspaceId || !invoke || get().creating || get().deletingId || get().restoringId)
          return;
        const epoch = scopeEpoch;
        loadRequest += 1;
        set({ creating: true, loading: false, status: "", error: "" });
        try {
          const created = await invoke("create_workspace_backup", {
            workspaceId,
          });
          if (!isBackupRecord(created, workspaceId) || created.damaged) {
            throw new Error(
              t(
                "Backup result could not be confirmed. Refresh the backup list before trying again.",
              ),
            );
          }
          if (isCurrent(workspaceId, epoch)) {
            set({ status: t("Workspace backup created") });
            await get().load();
          }
        } catch (error) {
          if (isCurrent(workspaceId, epoch)) set({ error: friendlyBackupError(error) });
        } finally {
          if (isCurrent(workspaceId, epoch)) set({ creating: false });
        }
      },

      async deleteBackup(id, expectedWorkspaceId) {
        const workspaceId = syncWorkspace();
        if (
          !workspaceId ||
          (expectedWorkspaceId && expectedWorkspaceId !== workspaceId) ||
          !invoke ||
          get().creating ||
          get().deletingId ||
          get().restoringId
        )
          return;
        const epoch = scopeEpoch;
        loadRequest += 1;
        set({ deletingId: id, loading: false, error: "" });
        try {
          await invoke("delete_workspace_backup", { workspaceId, backupId: id });
          if (isCurrent(workspaceId, epoch)) await get().load();
        } catch (error) {
          if (isCurrent(workspaceId, epoch)) set({ error: friendlyBackupError(error) });
        } finally {
          if (isCurrent(workspaceId, epoch)) set({ deletingId: null });
        }
      },

      async restoreBackup(id, expectedWorkspaceId) {
        const workspaceId = syncWorkspace();
        if (
          !workspaceId ||
          (expectedWorkspaceId && expectedWorkspaceId !== workspaceId) ||
          !invoke ||
          get().creating ||
          get().deletingId ||
          get().restoringId
        )
          return;
        const epoch = scopeEpoch;
        loadRequest += 1;
        set({ restoringId: id, loading: false, status: "", error: "" });
        try {
          const report = await invoke("restore_workspace_backup", {
            workspaceId,
            backupId: id,
          });
          if (!isRestoreReport(report, id)) {
            throw new Error(
              t(
                "Restore result could not be confirmed. Inspect workspace data before trying again.",
              ),
            );
          }
          if (isCurrent(workspaceId, epoch)) {
            set({
              status: t("Workspace restored from backup — restart ZiCode Studio to load the data."),
            });
            await get().load();
          }
        } catch (error) {
          if (isCurrent(workspaceId, epoch)) set({ error: friendlyBackupError(error) });
        } finally {
          if (isCurrent(workspaceId, epoch)) set({ restoringId: null });
        }
      },
    };
  });
}

export type BackupStore = ReturnType<typeof createBackupStore>;

export function formatBackupSize(bytes: unknown): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let unit = 0;
  let size = value;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 || size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

/**
 * Map raw Rust errors from workspace backup commands to friendly localized
 * messages so users see understandable feedback instead of internal strings.
 */
export function friendlyBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const rollbackPath =
    /^Rollback incomplete after restore failure: .*; previous data remains in (.+)$/s.exec(
      message,
    )?.[1];
  if (rollbackPath) {
    return `${t("Restore rollback did not finish. Stop using this workspace and keep its backups. Recovery files:")} ${rollbackPath}`;
  }
  const fallbacks: Array<[RegExp, string]> = [
    [/cannot read backups/i, t("Could not load workspace backups.")],
    [/cannot delete backup/i, t("Could not delete the backup.")],
    [/cannot (serialize|write|finalize) backup/i, t("Could not create the backup.")],
    [/backup does not exist/i, t("The backup no longer exists.")],
    [
      /backup metadata is missing|backup metadata is invalid/i,
      t("The backup is damaged or incomplete."),
    ],
    [
      /backup does not belong to this workspace/i,
      t("The backup belongs to a different workspace."),
    ],
    [
      /^Restore rolled back after failure:/i,
      t("Restore failed; the previous workspace data was put back."),
    ],
    [/^Backup contains unsupported entry:/i, t("The backup is damaged or incomplete.")],
    [/cannot replace /i, t("Could not restore the backup data.")],
    [/backup contains no restorable app data/i, t("The backup contains no restorable app data.")],
  ];
  for (const [pattern, friendly] of fallbacks) {
    if (pattern.test(message)) return friendly;
  }
  return message;
}
