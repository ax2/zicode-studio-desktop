import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "../../shared/i18n.js";
import { createTaskCenterApp, TaskMain, TaskNav } from "./TaskCenterApp";
import { createTaskCenterStore } from "./store";
import { formatDate } from "./logic";

function mockCall(tasks: unknown[]) {
  return vi.fn(async (operation: string, _params?: unknown) => {
    if (operation === "read_super_agent_tasks") {
      return { ok: true, data: { tasks } };
    }
    return { ok: true };
  });
}

function renderStore(call: ReturnType<typeof vi.fn>, options: Record<string, unknown> = {}) {
  const store = createTaskCenterStore({
    call,
    pollIntervalMs: 60_000,
    ...options,
  });
  render(
    <div>
      <TaskNav store={store} />
      <TaskMain store={store} />
    </div>,
  );
  void store.getState().load();
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("task center React app", () => {
  it("formats recent task timestamps as relative time", () => {
    expect(formatDate(new Date().toISOString())).toBeTruthy();
    expect(formatDate(null)).toBe("—");
    expect(formatDate("invalid")).toBe("invalid");
  });

  it("groups tasks and exposes recoverable actions", async () => {
    setLocale("en");
    const call = mockCall([
      { id: "run", title: "Running research", status: "running" },
      { id: "fail", title: "Failed report", status: "failed", failReason: "timeout" },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Running research")).toBeTruthy());
    expect(screen.getByText("Failed report")).toBeTruthy();
    expect(document.querySelectorAll(".task-center-summary-card strong")[0].textContent).toBe(
      "1",
    );
    store.getState().destroy();
  });

  it("returns a failed task to pending", async () => {
    setLocale("en");
    const call = mockCall([{ id: "fail", title: "Failed report", status: "failed" }]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector(".task-center-card")).toBeTruthy());
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_super_agent_tasks",
        expect.objectContaining({ tasks: expect.any(Array) }),
      ),
    );
    const written = call.mock.calls.find(
      ([operation]) => operation === "write_super_agent_tasks",
    )?.[1] as { tasks?: Array<{ status: string }> } | undefined;
    expect(written?.tasks?.[0].status).toBe("pending");
    store.getState().destroy();
  });

  it("aborts the bound child runtime before pausing a running task", async () => {
    setLocale("en");
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
    const call = mockCall([running]);
    const runtime = { request: vi.fn(async () => ({ ok: true })) };
    const cancelRuntimeUi = vi.fn(async () => {});
    const store = renderStore(call, { runtime, cancelRuntimeUi });
    await waitFor(() => expect(screen.getByText("Running research")).toBeTruthy());
    fireEvent.click(screen.getByText("Pause"));
    await waitFor(() => expect(runtime.request).toHaveBeenCalled());
    expect(runtime.request).toHaveBeenCalledWith(
      { type: "abort" },
      { workspaceId: "workspace-a", sessionId: "session-a", instanceId: "instance-a" },
    );
    expect(cancelRuntimeUi).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const written = call.mock.calls.find(
        ([operation]) => operation === "write_super_agent_tasks",
      )?.[1] as { tasks?: Array<{ status: string }> } | undefined;
      expect(written?.tasks?.[0]?.status).toBe("paused");
    });
    store.getState().destroy();
  });

  it("re-renders its main view after the shell clears the shared container", async () => {
    setLocale("en");
    const call = mockCall([{ id: "run", title: "Running research", status: "running" }]);
    const app = createTaskCenterApp({ call, pollIntervalMs: 50 });
    const container = document.createElement("div");
    document.body.append(container);

    app.renderContent(container);
    await waitFor(
      () => expect(container.textContent).toContain("Running research"),
      { timeout: 2_000 },
    );

    // The plugin shell clears the shared container before every activation;
    // re-rendering must create a fresh root instead of reusing a stale one.
    container.replaceChildren();
    app.renderContent(container);
    await waitFor(
      () => expect(container.textContent).toContain("Running research"),
      { timeout: 2_000 },
    );
    expect(container.querySelector(".task-center-main")).toBeTruthy();

    app.destroy();
    container.remove();
  });
});

describe("task center store host errors", () => {
  it("localizes a closed Pi runtime in the error state", async () => {
    setLocale("zh-CN");
    const call = vi.fn(async () => {
      throw new Error("Pi RPC request failed: ProcessClosed");
    });
    const store = createTaskCenterStore({ call, pollIntervalMs: 60_000 });
    await store.getState().load();
    expect(store.getState().error?.message).toBe(
      "Pi 运行时连接已断开。新建一个会话即可恢复连接。",
    );
    store.getState().destroy();
  });

  it("loads immediately when polling starts", async () => {
    const call = vi.fn(async () => ({ ok: true, data: { tasks: [] } }));
    const store = createTaskCenterStore({ call, pollIntervalMs: 60_000 });
    store.getState().startPolling();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    store.getState().destroy();
  });
});
