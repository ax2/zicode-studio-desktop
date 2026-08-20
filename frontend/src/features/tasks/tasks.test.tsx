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

  it("shows the first-run guide on first visit", async () => {
    localStorage.clear();
    const call = mockCall([]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector("[data-first-run-guide]")).toBeTruthy());
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

  it("shows a friendly message for internal dispatch errors", async () => {
    setLocale("zh-CN");
    const call = mockCall([
      {
        id: "fail",
        title: "每日技术博客文章生成",
        status: "failed",
        failReason: "getSelectedSceneId is not defined",
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector(".task-center-card")).toBeTruthy());
    const result = document.querySelector(".task-center-result");
    expect(result?.textContent).toContain("任务派发失败");
    expect(result?.getAttribute("title")).toBe("getSelectedSceneId is not defined");
    store.getState().destroy();
  });

  it("still allows a manual retry after the automatic retry limit", async () => {
    setLocale("zh-CN");
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const call = mockCall([
      {
        id: "fail",
        title: "每日技术博客文章生成",
        status: "failed",
        maxRetries: 2,
        retryCount: 2,
        failReason: "getSelectedSceneId is not defined",
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector(".task-center-card")).toBeTruthy());
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "重试",
    );
    expect(retry).toBeTruthy();
    expect(document.querySelector(".task-center-result")?.textContent).toContain(
      "已达到重试上限",
    );
    fireEvent.click(retry as HTMLElement);
    expect(confirmSpy).toHaveBeenCalledWith(
      "已超过自动重试上限，仍要手动重试此任务吗？",
    );
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
    vi.unstubAllGlobals();
    store.getState().destroy();
  });

  it("collapses long task descriptions behind a show-more toggle", async () => {
    setLocale("zh-CN");
    const call = mockCall([
      {
        id: "long",
        title: "每日技术博客文章生成",
        status: "failed",
        description: "一、收集（最近 1 天）\n1. 浏览最近 24 小时的主要技术站点。\n".repeat(20),
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector(".task-center-card")).toBeTruthy());
    const description = document.querySelector(".task-center-description");
    expect(description?.className).not.toContain("expanded");
    const toggle = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "显示更多",
    );
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as HTMLElement);
    expect(document.querySelector(".task-center-description")?.className).toContain(
      "expanded",
    );
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent === "显示更少",
      ),
    ).toBe(true);
    store.getState().destroy();
  });

  it("dismisses a finished task from the list", async () => {
    setLocale("zh-CN");
    const call = mockCall([
      { id: "done-1", title: "已完成任务", status: "done" },
      { id: "keep", title: "运行中任务", status: "running" },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelectorAll(".task-center-card").length).toBe(2));
    const dismiss = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "忽略",
    );
    expect(dismiss).toBeTruthy();
    fireEvent.click(dismiss as HTMLElement);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_super_agent_tasks",
        expect.objectContaining({ tasks: expect.any(Array) }),
      ),
    );
    const written = call.mock.calls.find(
      ([operation]) => operation === "write_super_agent_tasks",
    )?.[1] as { tasks?: Array<{ id: string }> } | undefined;
    expect(written?.tasks?.map((task) => task.id)).toEqual(["keep"]);
    store.getState().destroy();
  });

  it("approves a pending task and dispatches it to the project agent", async () => {
    setLocale("en");
    const call = mockCall([
      {
        id: "pending-1",
        title: "Pending task",
        status: "pending",
        targetProject: "C:/work/project",
      },
    ]);
    const dispatches: string[] = [];
    document.addEventListener("sa-dispatch", (event) => {
      dispatches.push((event as CustomEvent<{ id: string }>).detail.id);
    });
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Approve and run")).toBeTruthy());
    fireEvent.click(screen.getByText("Approve and run"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_super_agent_tasks",
        expect.objectContaining({ tasks: expect.any(Array) }),
      ),
    );
    const write = call.mock.calls.find(([operation]) => operation === "write_super_agent_tasks");
    const tasks = (write?.[1] as { tasks: Array<{ id: string; status: string }> }).tasks;
    expect(tasks.find((task) => task.id === "pending-1")?.status).toBe("running");
    expect(dispatches).toContain("pending-1");
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
      "Pi 运行时连接已断开。请重试或新建一个会话。",
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
