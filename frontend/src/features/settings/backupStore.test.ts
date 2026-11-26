import { describe, expect, it, vi } from "vitest";
import {
  createBackupStore,
  formatBackupSize,
  friendlyBackupError,
} from "./backupStore";

describe("workspace backup store", () => {
  it("reports availability only when a Tauri invoke is present", () => {
    const withInvoke = createBackupStore({
      invoke: vi.fn(async () => []),
      getWorkspaceId: () => "ws-1",
    });
    expect(withInvoke.getState().available).toBe(true);
    const withoutInvoke = createBackupStore({ getWorkspaceId: () => "ws-1" });
    expect(withoutInvoke.getState().available).toBe(false);
  });

  it("maps raw Rust backup errors to friendly localized messages", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_workspace_backups") {
        throw new Error("Cannot read backups: access denied");
      }
      return [];
    });
    const store = createBackupStore({
      invoke,
      getWorkspaceId: () => "ws-1",
    });
    await store.getState().load();
    expect(store.getState().error).toMatch(
      /Could not load workspace backups|无法读取工作区备份/,
    );
    expect(friendlyBackupError(new Error("Backup does not exist"))).toMatch(
      /The backup no longer exists|备份已不存在/,
    );
    expect(
      friendlyBackupError(new Error("Cannot replace C:\\x: permission denied")),
    ).toMatch(/Could not restore the backup data|无法恢复备份数据/);
    expect(friendlyBackupError(new Error("Some other failure"))).toBe(
      "Some other failure",
    );
  });

  it("loads workspace backups through invoke", async () => {
    const invoke = vi.fn(async () => [
      {
        id: "b1",
        workspaceId: "ws-1",
        workspaceRoot: "C:/work",
        createdAt: "2026-08-12T00:00:00.000Z",
        sizeBytes: 2048,
        apps: ["notes", "sessions"],
      },
    ]);
    const store = createBackupStore({
      invoke,
      getWorkspaceId: () => "ws-1",
    });
    await store.getState().load();
    expect(invoke).toHaveBeenCalledWith("list_workspace_backups", {
      workspaceId: "ws-1",
    });
    expect(store.getState().backups).toHaveLength(1);
    expect(store.getState().backups[0].id).toBe("b1");
  });

  it("creates a backup and refreshes the list", async () => {
    let list = [
      {
        id: "b1",
        workspaceId: "ws-1",
        workspaceRoot: "C:/work",
        createdAt: "2026-08-12T00:00:00.000Z",
        sizeBytes: 10,
        apps: ["notes"],
      },
    ];
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_workspace_backups") {
        return list;
      }
      if (command === "create_workspace_backup") {
        list = [
          {
            id: "b2",
            workspaceId: "ws-1",
            workspaceRoot: "C:/work",
            createdAt: "2026-08-12T01:00:00.000Z",
            sizeBytes: 10,
            apps: ["notes"],
          },
        ];
        return {
          id: "b2",
          workspaceId: "ws-1",
          workspaceRoot: "C:/work",
          createdAt: "2026-08-12T01:00:00.000Z",
          sizeBytes: 10,
          apps: ["notes"],
        };
      }
      return undefined;
    });
    const store = createBackupStore({
      invoke,
      getWorkspaceId: () => "ws-1",
    });
    await store.getState().createBackup();
    expect(invoke).toHaveBeenCalledWith("create_workspace_backup", {
      workspaceId: "ws-1",
    });
    expect(store.getState().status).toBeTruthy();
    expect(store.getState().backups[0].id).toBe("b2");
  });

  it("deletes a backup through invoke", async () => {
    const invoke = vi.fn(async () => []);
    const store = createBackupStore({
      invoke,
      getWorkspaceId: () => "ws-1",
    });
    await store.getState().deleteBackup("b1");
    expect(invoke).toHaveBeenCalledWith("delete_workspace_backup", {
      workspaceId: "ws-1",
      backupId: "b1",
    });
  });

  it("queues a restore and reports that it will apply on restart", async () => {
    const request = {
      backupId: "b1",
      workspaceId: "ws-1",
      requestId: "0123456789abcdef0123456789abcdef",
    };
    let queued = false;
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_workspace_backups") return [];
      if (command === "restore_workspace_backup") {
        queued = true;
        return request;
      }
      return queued ? { pending: request } : null;
    });
    const store = createBackupStore({ invoke, getWorkspaceId: () => "ws-1" });
    await store.getState().restoreBackup("b1");
    expect(invoke).toHaveBeenCalledWith("restore_workspace_backup", {
      workspaceId: "ws-1",
      backupId: "b1",
    });
    expect(store.getState().status).toMatch(/Restore queued|恢复请求已排队/);
  });

  it("formats backup sizes", () => {
    expect(formatBackupSize(0)).toBe("0 B");
    expect(formatBackupSize(2048)).toBe("2.0 KB");
    expect(formatBackupSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("reports completion from the persisted outcome after restart", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_workspace_backups") return [];
      return {
        workspaceId: "ws-1",
        requestId: "0123456789abcdef0123456789abcdef",
        report: { backupId: "b1", preRestoreBackupId: "b0", apps: ["notes"], sizeBytes: 42 },
      };
    });
    const store = createBackupStore({ invoke, getWorkspaceId: () => "ws-1" });
    await store.getState().load();
    expect(store.getState().status).toMatch(/Workspace restored from backup|已从备份恢复工作区/);
  });
});

it("learns a pending restore while the list is still waiting and keeps it when either read fails", async () => {
  const pending = { workspaceId: "ws-1", backupId: "queued", requestId: "0123456789abcdef0123456789abcdef" };
  const backup = {
    id: "existing",
    workspaceId: "ws-1",
    workspaceRoot: "C:/work",
    createdAt: "2026-08-12T00:00:00.000Z",
    sizeBytes: 10,
    apps: ["notes"],
  };
  let failList: ((error: Error) => void) | undefined;
  let failingList = true;
  const invoke = vi.fn(async (command: string) => {
    if (command === "list_workspace_backups") {
      if (failingList) return new Promise((_, reject) => { failList = reject; });
      return [backup];
    }
    if (command === "workspace_restore_outcome") {
      if (failingList) return { pending };
      throw Error("Fixture restore outcome unavailable");
    }
    throw Error("Unexpected backup mutation");
  });
  const store = createBackupStore({ invoke, getWorkspaceId: () => "ws-1" });
  const firstLoad = store.getState().load();
  await vi.waitFor(() => expect(store.getState().queuedBackupId).toBe("queued"));
  expect(store.getState().loading).toBe(true);
  failList?.(Error("Cannot read backups: fixture"));
  await firstLoad;
  expect(store.getState().queuedBackupId).toBe("queued");
  expect(store.getState().error).toMatch(/Could not load workspace backups|无法读取工作区备份/);

  failingList = false;
  await store.getState().load();
  expect(store.getState().backups).toEqual([backup]);
  expect(store.getState().queuedBackupId).toBe("queued");
  expect(store.getState().error).toBe("Fixture restore outcome unavailable");
  await store.getState().deleteBackup("queued");
  await store.getState().restoreBackup("existing");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "list_workspace_backups", "workspace_restore_outcome",
    "list_workspace_backups", "workspace_restore_outcome",
  ]);
});

it("shows a persisted queued restore before an older completion and blocks another restore", async () => {
  const queued = { workspaceId: "ws-1", backupId: "new", requestId: "fedcba9876543210fedcba9876543210" };
  const previous = {
    workspaceId: "ws-1", requestId: "0123456789abcdef0123456789abcdef",
    report: { backupId: "old", preRestoreBackupId: "previous", apps: ["notes"], sizeBytes: 7 },
  };
  const invoke = vi.fn(async (command: string) => {
    if (command === "list_workspace_backups") return [];
    return { ...previous, pending: queued };
  });
  const store = createBackupStore({ invoke, getWorkspaceId: () => "ws-1" });
  await store.getState().load();
  expect(store.getState().status).toMatch(/Restore queued|恢复请求已排队/);
  await store.getState().restoreBackup("another");
  await store.getState().deleteBackup("new");
  expect(invoke.mock.calls.map(([command]) => command)).not.toContain("delete_workspace_backup");
  expect(invoke.mock.calls.map(([command]) => command)).not.toContain("restore_workspace_backup");
  expect(store.getState().status).toMatch(/Restore queued|恢复请求已排队/);
});
