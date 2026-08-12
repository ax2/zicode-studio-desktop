import { describe, expect, it, vi } from "vitest";
import { createBackupStore, formatBackupSize } from "./backupStore";

describe("workspace backup store", () => {
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

  it("formats backup sizes", () => {
    expect(formatBackupSize(0)).toBe("0 B");
    expect(formatBackupSize(2048)).toBe("2.0 KB");
    expect(formatBackupSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
