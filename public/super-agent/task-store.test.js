// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { updateSuperAgentTask } from "./task-store.js";

describe("updateSuperAgentTask", () => {
  it("re-reads a conflicting version and preserves edits made by another client", async () => {
    let reads = 0;
    const call = vi.fn(async (op, params) => {
      if (op === "read_super_agent_tasks") {
        reads += 1;
        return {
          ok: true,
          data: {
            tasks: [
              { id: "a", title: reads === 1 ? "old" : "edited elsewhere", status: "running" },
            ],
            revision: `version-${reads}`,
          },
        };
      }
      if (params.revision === "version-1") return { ok: false, error: "task_conflict" };
      return { ok: true };
    });
    const result = await updateSuperAgentTask(call, "a", (task) => ({ ...task, status: "done" }));
    expect(result.title).toBe("edited elsewhere");
    expect(call).toHaveBeenLastCalledWith(
      "write_super_agent_tasks",
      expect.objectContaining({ revision: "version-2" }),
    );
  });

  it("bounds conflict retries and reports the final failure", async () => {
    const call = vi.fn(async (op) =>
      op === "read_super_agent_tasks"
        ? { ok: true, data: { tasks: [{ id: "a" }], revision: "v" } }
        : { ok: false, error: "task_conflict" },
    );
    await expect(updateSuperAgentTask(call, "a", (task) => task)).rejects.toThrow("task_conflict");
    expect(call).toHaveBeenCalledTimes(6);
  });
  it("re-reads, mutates the matching task, and writes the full list back", async () => {
    const stored = {
      tasks: [
        { id: "task-1", status: "running", title: "A" },
        { id: "task-2", status: "pending", title: "B" },
      ],
    };
    const call = vi.fn(async (op, params) => {
      if (op === "read_super_agent_tasks") return { ok: true, data: stored };
      if (op === "write_super_agent_tasks") {
        stored.tasks = params.tasks;
        return { ok: true };
      }
      return { ok: false };
    });

    const next = await updateSuperAgentTask(call, "task-2", (task) => ({
      ...task,
      status: "done",
    }));

    expect(next.status).toBe("done");
    expect(stored.tasks.find((t) => t.id === "task-2").status).toBe("done");
    expect(stored.tasks.find((t) => t.id === "task-1").status).toBe("running");
  });

  it("returns null when the task id is missing", async () => {
    const call = vi.fn(async (op) =>
      op === "read_super_agent_tasks" ? { ok: true, data: { tasks: [] } } : { ok: true },
    );
    const updater = vi.fn();
    const result = await updateSuperAgentTask(call, "nope", updater);
    expect(result).toBeNull();
    expect(updater).not.toHaveBeenCalled();
  });

  it("no-ops without a callable config bridge", async () => {
    const result = await updateSuperAgentTask(null, "task-1", (t) => t);
    expect(result).toBeNull();
  });
});
