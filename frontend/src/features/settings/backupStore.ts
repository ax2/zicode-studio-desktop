import { create } from "zustand";
import { t } from "../../shared/i18n";

export interface WorkspaceBackup {
  id: string;
  workspaceId: string;
  workspaceRoot: string;
  createdAt: string;
  sizeBytes: number;
  apps: string[];
}

export interface BackupStoreOptions {
  invoke?(
    command: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  getWorkspaceId?(): string | undefined;
}

interface BackupState {
  backups: WorkspaceBackup[];
  available: boolean;
  loading: boolean;
  creating: boolean;
  deletingId: string | null;
  restoringId: string | null;
  status: string;
  error: string;
  load(): Promise<void>;
  createBackup(): Promise<void>;
  deleteBackup(id: string): Promise<void>;
  restoreBackup(id: string): Promise<void>;
}

function resolveInvoke(
  options: BackupStoreOptions,
): BackupStoreOptions["invoke"] | null {
  if (options.invoke) return options.invoke;
  const tauriInvoke = (
    globalThis as {
      __TAURI__?: { core?: { invoke?: BackupStoreOptions["invoke"] } };
    }
  ).__TAURI__?.core?.invoke;
  return tauriInvoke ?? null;
}

export function createBackupStore(options: BackupStoreOptions = {}) {
  const invoke = resolveInvoke(options);
  const getWorkspaceId = options.getWorkspaceId ?? (() => undefined);

  return create<BackupState>()((set, get) => ({
    backups: [],
    available: Boolean(invoke),
    loading: false,
    creating: false,
    deletingId: null,
    restoringId: null,
    status: "",
    error: "",

    async load() {
      const workspaceId = getWorkspaceId();
      if (!workspaceId || !invoke) return;
      set({ loading: true, error: "" });
      try {
        const result = await invoke("list_workspace_backups", { workspaceId });
        set({
          backups: Array.isArray(result) ? (result as WorkspaceBackup[]) : [],
        });
      } catch (error) {
        set({ error: friendlyBackupError(error) });
      } finally {
        set({ loading: false });
      }
    },

    async createBackup() {
      const workspaceId = getWorkspaceId();
      if (!workspaceId || !invoke || get().creating) return;
      set({ creating: true, status: "", error: "" });
      try {
        const created = (await invoke("create_workspace_backup", {
          workspaceId,
        })) as WorkspaceBackup | undefined;
        if (!created) throw new Error(t("Workspace backup failed"));
        set({ status: t("Workspace backup created") });
        await get().load();
      } catch (error) {
        set({ error: friendlyBackupError(error) });
      } finally {
        set({ creating: false });
      }
    },

    async deleteBackup(id) {
      const workspaceId = getWorkspaceId();
      if (!workspaceId || !invoke || get().deletingId) return;
      set({ deletingId: id, error: "" });
      try {
        await invoke("delete_workspace_backup", { workspaceId, backupId: id });
        await get().load();
      } catch (error) {
        set({ error: friendlyBackupError(error) });
      } finally {
        set({ deletingId: null });
      }
    },

    async restoreBackup(id) {
      const workspaceId = getWorkspaceId();
      if (!workspaceId || !invoke || get().restoringId) return;
      set({ restoringId: id, status: "", error: "" });
      try {
        const report = (await invoke("restore_workspace_backup", {
          workspaceId,
          backupId: id,
        })) as { apps?: string[] } | undefined;
        if (!report) throw new Error(t("Workspace restore failed"));
        set({
          status: t("Workspace restored from backup — restart ZiCode Studio to load the data."),
        });
        await get().load();
      } catch (error) {
        set({ error: friendlyBackupError(error) });
      } finally {
        set({ restoringId: null });
      }
    },
  }));
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
    [/cannot replace /i, t("Could not restore the backup data.")],
    [
      /backup contains no restorable app data/i,
      t("The backup contains no restorable app data."),
    ],
  ];
  for (const [pattern, friendly] of fallbacks) {
    if (pattern.test(message)) return friendly;
  }
  return message;
}
