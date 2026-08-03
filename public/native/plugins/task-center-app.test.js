import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { setupTaskCenterApp } from "./task-center-app.js";

function render(call, options = {}) {
  document.body.innerHTML = '<aside id="nav"></aside><main id="content"></main>';
  const app = setupTaskCenterApp({ call, pollIntervalMs: 60_000, ...options });
  app.renderNavigation(document.getElementById("nav"));
  app.renderContent(document.getElementById("content"));
  return app;
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("task center app", () => {
  it("groups tasks and exposes recoverable actions", async () => {
    const call = vi.fn(async (operation) => {
      if (operation === "read_super_agent_tasks") {
        return {
          ok: true,
          data: {
            tasks: [
              { id: "run", title: "Running research", status: "running" },
              { id: "fail", title: "Failed report", status: "failed", failReason: "timeout" },
            ],
          },
        };
      }
      return { ok: true };
    });
    const app = render(call);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Running research"));
    expect(document.body.textContent).toContain("Failed report");
    expect(document.querySelectorAll(".task-center-summary-card strong")[0].textContent).toBe("1");
    app.destroy();
  });

  it("returns a failed task to pending", async () => {
    const call = vi.fn(async (operation) =>
      operation === "read_super_agent_tasks"
        ? { ok: true, data: { tasks: [{ id: "fail", title: "Failed report", status: "failed" }] } }
        : { ok: true },
    );
    const app = render(call);
    await vi.waitFor(() => expect(document.querySelector(".task-center-card")).toBeTruthy());
    document.querySelector(".task-center-actions .ui-button--primary").click();
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith("write_super_agent_tasks", expect.anything()));
    const written = call.mock.calls.find(([operation]) => operation === "write_super_agent_tasks")[1].tasks;
    expect(written[0].status).toBe("pending");
    app.destroy();
  });

  it("aborts the bound child runtime before pausing a running task", async () => {
    const running = {
      id: "run",
      title: "Running research",
      status: "running",
      dispatch: {
        childWorkspaceId: "workspace-a",
        childSessionId: "session-a",
        childInstanceId: "instance-a",
      },
    };
    const call = vi.fn(async (operation) =>
      operation === "read_super_agent_tasks"
        ? { ok: true, data: { tasks: [running] } }
        : { ok: true },
    );
    const runtime = { request: vi.fn(async () => ({ ok: true })) };
    const cancelRuntimeUi = vi.fn(async () => {});
    const app = render(call, { runtime, cancelRuntimeUi });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Running research"));
    [...document.querySelectorAll("button")].find((item) => item.textContent === "暂停").click();
    await vi.waitFor(() => expect(runtime.request).toHaveBeenCalled());
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "abort" },
      { workspaceId: "workspace-a", sessionId: "session-a", instanceId: "instance-a" },
    );
    expect(cancelRuntimeUi).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      const written = call.mock.calls.find(([operation]) => operation === "write_super_agent_tasks")?.[1]?.tasks;
      expect(written?.[0].status).toBe("paused");
    });
    app.destroy();
  });
});
