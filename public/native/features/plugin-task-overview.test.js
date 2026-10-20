import { describe, expect, it, vi } from "vitest";
import { createPluginTaskDetailClient, createPluginTaskOverviewClient } from "./plugin-task-overview.js";

describe("plugin task overview client", () => {
  it("requests one workspace and forwards an opaque cursor", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        operation: "plugin-tasks.workspace.list",
        page: { tasks: [], nextCursor: null },
      }),
    }));
    const list = createPluginTaskOverviewClient(fetch);
    await list("workspace-a", { updatedAtMs: 4, taskRef: "task-a" });
    expect(fetch).toHaveBeenCalledWith("/v2/plugin-task-center/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        workspaceId: "workspace-a",
        limit: 30,
        before: { updatedAtMs: 4, taskRef: "task-a" },
      }),
    });
  });

  it("rejects a response with an unexpected operation", async () => {
    const list = createPluginTaskOverviewClient(async () => ({
      ok: true,
      json: async () => ({ schemaVersion: 1, operation: "other", page: { tasks: [] } }),
    }));
    await expect(list("workspace-a")).rejects.toThrow("plugin_task_overview_invalid");
  });
});

it("requests one task detail and rejects a mismatched task reference", async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ schemaVersion: 1, operation: "plugin-tasks.workspace.detail",
      detail: { snapshot: { taskRef: "task-a" }, events: [], earlierEventsAvailable: false } }),
  }));
  const detail = createPluginTaskDetailClient(fetch);
  await detail("workspace-a", "task-a");
  expect(fetch).toHaveBeenCalledWith("/v2/plugin-task-center/detail", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, workspaceId: "workspace-a", taskRef: "task-a" }),
  });
  await expect(detail("workspace-a", "task-b")).rejects.toThrow("plugin_task_detail_invalid");
  await detail("workspace-a", "task-a", 8);
  expect(fetch).toHaveBeenLastCalledWith("/v2/plugin-task-center/detail", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, workspaceId: "workspace-a", taskRef: "task-a", beforeSequence: 8 }),
  });
});
