import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "../../shared/i18n.js";
import { createTaskCenterApp, TaskMain, TaskNav } from "./TaskCenterApp";
import { createTaskCenterStore } from "./store";
import {
  dateRangeLabel,
  formatDate,
  filteredTasks,
  groupTasksByWorkspace,
  isDefaultWorkspace,
  isScheduledTemplate,
  matchesTaskDateRange,
  nextTaskRunAt,
  scheduledTaskStats,
  sortTaskList,
  taskLastActivity,
} from "./logic";

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
  it("filters tasks by activity date range", () => {
    const now = new Date("2026-08-22T12:00:00Z");
    const today = {
      id: "today",
      status: "done",
      result: { completedAt: "2026-08-22T08:00:00Z" },
    };
    const lastWeek = {
      id: "week",
      status: "done",
      result: { completedAt: "2026-08-18T08:00:00Z" },
    };
    const oldTask = {
      id: "old",
      status: "done",
      result: { completedAt: "2026-07-01T08:00:00Z" },
    };
    const untracked = { id: "none", status: "done" };
    expect(matchesTaskDateRange(today, "all", now)).toBe(true);
    expect(matchesTaskDateRange(today, "today", now)).toBe(true);
    expect(matchesTaskDateRange(lastWeek, "today", now)).toBe(false);
    expect(matchesTaskDateRange(lastWeek, "week", now)).toBe(true);
    expect(matchesTaskDateRange(oldTask, "week", now)).toBe(false);
    expect(matchesTaskDateRange(oldTask, "month", now)).toBe(false);
    expect(matchesTaskDateRange(untracked, "today", now)).toBe(false);
    expect(matchesTaskDateRange(untracked, "all", now)).toBe(true);
    expect(dateRangeLabel("week")).toBe("Last 7 days");
  });

  it("formats recent task timestamps as relative time", () => {
    expect(formatDate(new Date().toISOString())).toBeTruthy();
    expect(formatDate(null)).toBe("—");
    expect(formatDate("invalid")).toBe("invalid");
  });

  it("filters the task list by date range from the header select", async () => {
    setLocale("zh-CN");
    const todayIso = new Date().toISOString();
    const call = mockCall([
      { id: "t1", title: "今天完成的任务", status: "done", result: { completedAt: todayIso } },
      { id: "t2", title: "旧任务", status: "done", result: { completedAt: "2026-01-01T00:00:00Z" } },
    ]);
    renderStore(call);
    await waitFor(() => expect(screen.getByText("今天完成的任务")).toBeTruthy());
    expect(screen.getByText("旧任务")).toBeTruthy();

    const select = document.querySelector(".task-center-date") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "today" } });
    expect(screen.getByText("今天完成的任务")).toBeTruthy();
    expect(screen.queryByText("旧任务")).toBeNull();

    fireEvent.change(select, { target: { value: "all" } });
    expect(screen.getByText("旧任务")).toBeTruthy();
  });

  it("focuses a task card by id and highlights it", async () => {
    setLocale("zh-CN");
    const call = mockCall([{ id: "t-focus", title: "聚焦目标任务", status: "done" }]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("聚焦目标任务")).toBeTruthy());
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    act(() => {
      store.getState().focusTask("t-focus");
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const card = document.querySelector('[data-task-id="t-focus"]');
    expect(card?.classList.contains("is-focused")).toBe(true);
    expect(store.getState().filter).toBe("all");
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

  it("filters tasks by clicking a summary card", async () => {
    setLocale("en");
    const call = mockCall([
      { id: "fail", title: "Failed report", status: "failed" },
      { id: "done", title: "Finished report", status: "done" },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Failed report")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Failed: 1"));
    expect(screen.getByText("Failed report")).toBeTruthy();
    expect(screen.queryByText("Finished report")).toBeNull();
    store.getState().destroy();
  });

  it("searches tasks by title or description", async () => {
    setLocale("en");
    const call = mockCall([
      { id: "a", title: "Alpha report", status: "done" },
      { id: "b", title: "Beta", description: "monthly digest", status: "pending" },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Alpha report")).toBeTruthy());
    const input = document.querySelector(".task-center-search") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(
      input,
      "monthly",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(screen.queryByText("Alpha report")).toBeNull();
    expect(screen.getByText("Beta")).toBeTruthy();
    store.getState().destroy();
  });

  it("jumps from a scheduled instance to its template via the scheduled filter", async () => {
    setLocale("en");
    const call = mockCall([
      {
        id: "tpl",
        title: "Daily digest",
        status: "pending",
        schedule: "daily",
        dailyTime: "09:00",
        enabled: true,
      },
      {
        id: "inst",
        title: "Daily digest run",
        status: "done",
        scheduledFrom: "tpl",
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Daily digest run")).toBeTruthy());
    const jump = screen.getByText("View scheduled task");
    fireEvent.click(jump);
    expect(screen.getByText("Daily digest")).toBeTruthy();
    expect(screen.queryByText("Daily digest run")).toBeNull();
    store.getState().destroy();
  });

  it("shows run history on the scheduled template card", async () => {
    setLocale("en");
    const call = mockCall([
      {
        id: "tpl",
        title: "Daily digest",
        status: "pending",
        schedule: "daily",
        dailyTime: "09:00",
        enabled: true,
      },
      {
        id: "i1",
        title: "Daily digest run",
        status: "done",
        scheduledFrom: "tpl",
        dispatch: { startedAt: "2026-08-20T01:00:00.000Z" },
        result: { status: "done", summary: "ok", completedAt: "2026-08-20T01:30:00.000Z" },
        events: [{ at: "2026-08-20T01:30:00.000Z", type: "completed", status: "done", message: "ok" }],
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Daily digest")).toBeTruthy());
    const history = Array.from(document.querySelectorAll(".task-center-history summary"))
      .find((node) => /Run history/.test(node.textContent || ""));
    expect(history).toBeTruthy();
    expect(history?.textContent).toContain("1");
    fireEvent.click(history as HTMLElement);
    const historyList = history?.closest(".task-center-history");
    expect(historyList?.textContent).toContain("Completed");
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

  it("clears all completed tasks from the card header", async () => {
    setLocale("en");
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    try {
      const call = mockCall([
        { id: "done-1", title: "Finished A", status: "done" },
        { id: "done-2", title: "Finished B", status: "done" },
        { id: "run", title: "Running task", status: "running" },
      ]);
      const store = renderStore(call);
      await waitFor(() => expect(screen.getByText("Finished A")).toBeTruthy());
      fireEvent.click(screen.getByText("Clear completed"));
      expect(confirmSpy).toHaveBeenCalledWith("Clear 2 completed tasks?");
      await waitFor(() => expect(screen.queryByText("Finished A")).toBeNull());
      const write = call.mock.calls.find(
        ([operation]) => operation === "write_super_agent_tasks",
      )?.[1] as { tasks?: Array<{ status: string }> } | undefined;
      expect(write?.tasks?.every((task) => task.status !== "done")).toBe(true);
      expect(screen.getByText("Running task")).toBeTruthy();
      store.getState().destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("re-runs a finished automation task from the card", async () => {
    setLocale("en");
    const call = mockCall([
      {
        id: "done-auto",
        title: "Daily blog post",
        status: "done",
        automation: { workflowId: "wf-1", trigger: "schedule" },
      },
      {
        id: "failed-auto",
        title: "Failed automation",
        status: "failed",
        automation: { workflowId: "wf-2", trigger: "schedule" },
      },
      { id: "done-plain", title: "Plain done", status: "done" },
    ]);
    const reruns: string[] = [];
    document.addEventListener("sa-rerun-workflow", (event) => {
      reruns.push((event as CustomEvent<{ workflowId: string }>).detail.workflowId);
    });
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Daily blog post")).toBeTruthy());
    const buttons = screen.getAllByText("Run again");
    expect(buttons.length).toBe(3);
    const cardButton = (title: string) => {
      const card = Array.from(document.querySelectorAll(".task-center-card")).find((node) =>
        (node.textContent || "").includes(title),
      );
      return Array.from(card?.querySelectorAll("button") ?? []).find(
        (button) => button.textContent === "Run again",
      );
    };
    fireEvent.click(cardButton("Daily blog post") as HTMLElement);
    expect(reruns).toEqual(["wf-1"]);
    fireEvent.click(cardButton("Failed automation") as HTMLElement);
    expect(reruns).toEqual(["wf-1", "wf-2"]);
    fireEvent.click(cardButton("Plain done") as HTMLElement);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("write_super_agent_tasks", expect.anything()),
    );
    const written = call.mock.calls.filter(
      ([operation]) => operation === "write_super_agent_tasks",
    );
    const last = written.at(-1)?.[1] as { tasks?: Array<Record<string, unknown>> };
    expect(last?.tasks?.at(-1)?.title).toBe("Plain done");
    expect(last?.tasks?.at(-1)?.status).toBe("pending");
    store.getState().destroy();
  });

  it("copies the task result summary", async () => {
    setLocale("zh-CN");
    const call = mockCall([
      {
        id: "done-summary",
        title: "每日技术博客文章生成",
        status: "done",
        result: { status: "done", summary: "已生成 3 篇技术文章：Cerebras / Turbovec / GLM" },
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector(".task-center-result-copy")).toBeTruthy());
    const copy = document.querySelector(".task-center-result-copy") as HTMLElement;
    fireEvent.click(copy);
    expect(copy.textContent).toContain("已复制");
    store.getState().destroy();
  });

  it("answers a needs-input task from the card", async () => {
    setLocale("zh-CN");
    const request = vi.fn().mockResolvedValue(undefined);
    const call = mockCall([
      {
        id: "ask",
        title: "需要确认",
        status: "needs_input",
        dispatch: {
          childWorkspaceId: "workspace-a",
          childInstanceId: "instance-a",
          childSessionId: "session-a",
        },
      },
    ]);
    const store = renderStore(call, { runtime: { request } });
    await waitFor(() => expect(document.querySelector(".task-center-reply")).toBeTruthy());
    // The reply box is the primary action for a needs-input task; keep the
    // "Retry" affordance secondary so the hierarchy is obvious.
    const retry = Array.from(document.querySelectorAll(".task-center-actions button")).find(
      (button) => button.textContent === "重试",
    );
    expect(retry?.className).toContain("ui-button--secondary");
    expect(retry?.className).not.toContain("ui-button--primary");
    const input = document.querySelector(".task-center-reply-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "用 /tmp/out 目录" } });
    fireEvent.click(document.querySelector(".task-center-reply button") as HTMLElement);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(
      { type: "prompt", message: "用 /tmp/out 目录" },
      {
        workspaceId: "workspace-a",
        instanceId: "instance-a",
        sessionId: "session-a",
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
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
    expect(written?.tasks?.[0].status).toBe("running");
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

  it("explains that a pending manual task without a target project cannot be run", async () => {
    setLocale("en");
    const call = mockCall([
      {
        id: "no-target-1",
        title: "Task without target",
        status: "pending",
        targetProject: null,
      },
    ]);
    const store = renderStore(call);
    await waitFor(() =>
      expect(
        screen.getByText("Set a target project to run this manual task."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Approve and run")).toBeNull();
    store.getState().destroy();
  });

  it("retries and dispatches a failed task in one action", async () => {
    setLocale("en");
    const call = mockCall([
      {
        id: "fail-1",
        title: "Daily blog post",
        status: "failed",
        targetProject: "C:/Users/me/blog",
        failReason: "timeout",
        retryCount: 0,
      },
    ]);
    const dispatches: string[] = [];
    document.addEventListener("sa-dispatch", (event) => {
      dispatches.push((event as CustomEvent<{ id: string }>).detail.id);
    });
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Retry and run")).toBeTruthy());
    fireEvent.click(screen.getByText("Retry and run"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_super_agent_tasks",
        expect.objectContaining({ tasks: expect.any(Array) }),
      ),
    );
    const write = call.mock.calls.find(([operation]) => operation === "write_super_agent_tasks");
    const tasks = (write?.[1] as {
      tasks: Array<{ id: string; status: string; retryCount: number }>;
    }).tasks;
    const updated = tasks.find((task) => task.id === "fail-1");
    expect(updated?.status).toBe("running");
    expect(updated?.retryCount).toBe(1);
    expect(dispatches).toContain("fail-1");
    store.getState().destroy();
  });

  it("keeps a plain retry when a failed task has no project", async () => {
    setLocale("en");
    const call = mockCall([
      { id: "fail-2", title: "Failed report", status: "failed", failReason: "timeout" },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Retry")).toBeTruthy());
    expect(screen.queryByText("Retry and run")).toBeNull();
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

  it("offers a Continue entry for tasks with a bound child session", async () => {
    setLocale("en");
    const openApp = vi.fn();
    const dispatched = {
      id: "run",
      title: "Running research",
      status: "running",
      dispatch: {
        childWorkspaceId: "workspace-a",
        childSessionId: "session-a",
        childInstanceId: "instance-a",
      },
    };
    const call = mockCall([dispatched]);
    const store = renderStore(call, { openApp });
    await waitFor(() => expect(screen.getByText("Running research")).toBeTruthy());
    const listener = vi.fn();
    document.addEventListener("sa-view-session", listener);
    fireEvent.click(screen.getByText("Continue"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(openApp).toHaveBeenCalledWith("core.chat");
    document.removeEventListener("sa-view-session", listener);
    store.getState().destroy();
  });

  it("shows how long a running task has been in progress", async () => {
    setLocale("en");
    const started = new Date(Date.now() - 5 * 60_000).toISOString();
    const call = mockCall([
      {
        id: "run",
        title: "Running research",
        status: "running",
        dispatch: { startedAt: started },
      },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Running research")).toBeTruthy());
    const status = document.querySelector(".task-center-status");
    expect(status?.textContent).toContain("5m running");
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

  it("auto-retries once after a runtime-readiness failure", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("Runtime request rejected: UnknownInstance"))
      .mockResolvedValueOnce({
        ok: true,
        data: { tasks: [{ id: "run", title: "Running research", status: "running" }] },
      });
    const store = createTaskCenterStore({ call, pollIntervalMs: 60_000 });
    await store.getState().load();
    expect(store.getState().error).toBeTruthy();
    await vi.waitFor(() => expect(store.getState().tasks.length).toBe(1), {
      timeout: 3_000,
    });
    expect(store.getState().error).toBeNull();
    store.getState().destroy();
  });

  it("keeps retrying with backoff while the runtime is not ready", async () => {
    vi.useFakeTimers();
    try {
      const call = vi
        .fn()
        .mockRejectedValueOnce(new Error("Runtime request rejected: UnknownInstance"))
        .mockRejectedValueOnce(new Error("Runtime request rejected: UnknownInstance"))
        .mockRejectedValueOnce(new Error("Runtime request rejected: UnknownInstance"))
        .mockResolvedValueOnce({
          ok: true,
          data: { tasks: [{ id: "run", title: "Running research", status: "running" }] },
        });
      const store = createTaskCenterStore({ call, pollIntervalMs: 60_000 });
      await store.getState().load();
      expect(store.getState().error).toBeTruthy();
      // Backoff delays: 1200 + 2000 + 3000 ms; the 4th attempt succeeds.
      await vi.advanceTimersByTimeAsync(7000);
      expect(call).toHaveBeenCalledTimes(4);
      expect(store.getState().tasks.length).toBe(1);
      expect(store.getState().error).toBeNull();
      store.getState().destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("task center task management", () => {
  function managementStore(initial: unknown[] = []) {
    const calls: Array<{ operation: string; params?: unknown }> = [];
    const call = vi.fn(async (operation: string, params?: unknown) => {
      calls.push({ operation, params });
      if (operation === "read_super_agent_tasks") {
        return { ok: true, data: { tasks: initial } };
      }
      if (operation === "write_super_agent_tasks") {
        return { ok: true, data: { tasks: (params as { tasks?: unknown[] })?.tasks ?? [] } };
      }
      if (operation === "list_super_agent_projects") {
        return {
          ok: true,
          data: {
            projects: [
              { cwd: "C:/work/project-a" },
              { cwd: "C:/work/project-b" },
            ],
          },
        };
      }
      return { ok: false, error: `unhandled ${operation}` };
    });
    const store = createTaskCenterStore({ call, pollIntervalMs: 60_000 });
    return { store, call, calls };
  }

  it("creates a manual task that auto-dispatches", async () => {
    const { store, calls } = managementStore();
    await store.getState().createTask({
      title: "Review PR",
      description: "Check the diff",
      targetProject: "C:/repo",
      schedule: "manual",
    });
    const write = calls.find((entry) => entry.operation === "write_super_agent_tasks");
    const tasks = (write?.params as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Review PR");
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].automation).toMatchObject({ autoDispatch: true, trigger: "manual" });
    expect(store.getState().tasks[0].title).toBe("Review PR");
  });

  it("lists registered project paths for the target field", async () => {
    const { store } = managementStore([
      { id: "t1", targetProject: "C:/used/project" },
    ]);
    const paths = await store.getState().listProjects();
    expect(paths).toEqual([
      "C:/work/project-a",
      "C:/work/project-b",
      "C:/used/project",
    ]);
  });

  it("renders project path suggestions in the task form", async () => {
    setLocale("en");
    const { store } = managementStore();
    render(
      <div>
        <TaskMain store={store} />
      </div>,
    );
    fireEvent.click(screen.getAllByText("New task")[0]);
    await waitFor(() => {
      expect(document.querySelector("datalist#task-project-paths option")).toBeTruthy();
    });
    const options = Array.from(
      document.querySelectorAll("datalist#task-project-paths option"),
    ).map((node) => node.getAttribute("value"));
    expect(options).toEqual(["C:/work/project-a", "C:/work/project-b"]);
    store.getState().destroy();
  });

  it("switches execution mode between automatic and confirmation", async () => {
    setLocale("en");
    const { store } = managementStore([]);
    render(
      <div>
        <TaskMain store={store} />
      </div>,
    );
    fireEvent.click(screen.getAllByText("New task")[0]);
    const form = document.querySelector(".task-center-form");
    expect(form?.textContent).toContain("Execution mode");
    const checked = () =>
      form?.querySelector('input[name="task-execution-mode"]:checked')?.closest("label")
        ?.textContent ?? "";
    expect(checked()).toContain("Run automatically (full access)");
    fireEvent.click(screen.getByText("Confirm before every run (default permission)"));
    expect(checked()).toContain("Confirm before every run (default permission)");
    fireEvent.click(screen.getByText("Run automatically (full access)"));
    expect(checked()).toContain("Run automatically (full access)");
    store.getState().destroy();
  });

  it("creates a daily scheduled template that waits for its first run", async () => {
    const { store, calls } = managementStore();
    await store.getState().createTask({
      title: "Daily digest",
      description: "Summarize the news",
      targetProject: "C:/blog",
      schedule: "daily",
      dailyTime: "09:00",
      requireApproval: true,
    });
    const write = calls.find((entry) => entry.operation === "write_super_agent_tasks");
    const tasks = (write?.params as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks[0].schedule).toBe("daily");
    expect(tasks[0].dailyTime).toBe("09:00");
    expect(tasks[0].automation).toMatchObject({ autoDispatch: false, trigger: "schedule" });
    expect(String(tasks[0].nextRunAt)).toContain("T01:00:00");
    expect(store.getState().tasks[0].nextRunAt).toBeTruthy();
  });

  it("runs a scheduled template immediately without disturbing its next run", async () => {
    const template = {
      id: "tpl-run",
      title: "Daily digest",
      description: "",
      targetProject: "C:/work",
      status: "pending",
      schedule: "daily",
      dailyTime: "09:00",
      nextRunAt: "2099-01-01T00:00:00.000Z",
      enabled: true,
      requireApproval: false,
      automation: { workflowId: null, trigger: "schedule", autoDispatch: false },
      events: [],
    };
    const { store } = managementStore([template]);
    await store.getState().load();
    await store.getState().runTaskNow(template as never);
    const tasks = store.getState().tasks;
    expect(tasks).toHaveLength(2);
    const instance = tasks.find((task) => task.scheduledFrom === "tpl-run");
    expect(instance).toBeTruthy();
    expect(instance?.schedule).toBeNull();
    expect(instance?.status).toBe("pending");
    expect(instance?.automation).toMatchObject({ trigger: "manual", autoDispatch: true });
    const tpl = tasks.find((task) => task.id === "tpl-run");
    expect(tpl?.nextRunAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("edits a task's title, instructions, target, and schedule", async () => {
    const template = {
      id: "tpl-1",
      title: "Old title",
      description: "Old instructions",
      targetProject: "C:/old",
      status: "pending",
      schedule: "interval",
      intervalMinutes: 60,
      nextRunAt: "2099-01-01T00:00:00.000Z",
      enabled: true,
      automation: { trigger: "schedule", autoDispatch: false },
    };
    const { store, calls } = managementStore([template]);
    await store.getState().load();
    await store.getState().updateTaskMeta("tpl-1", {
      title: "New title",
      description: "New instructions",
      targetProject: "C:/new",
      schedule: "daily",
      dailyTime: "10:30",
    });
    const updated = store.getState().tasks.find((task) => task.id === "tpl-1");
    expect(updated?.title).toBe("New title");
    expect(updated?.description).toBe("New instructions");
    expect(updated?.targetProject).toBe("C:/new");
    expect(updated?.schedule).toBe("daily");
    expect(updated?.dailyTime).toBe("10:30");
    expect(String(updated?.nextRunAt)).toContain("T02:30:00");
    expect(calls.some((entry) => entry.operation === "write_super_agent_tasks")).toBe(true);
  });

  it("spawns an instance from a due template and advances its next run", async () => {
    const due = {
      id: "tpl-due",
      title: "Every 5 min",
      description: "",
      targetProject: "C:/work",
      status: "pending",
      schedule: "interval",
      intervalMinutes: 5,
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      enabled: true,
      requireApproval: false,
      automation: { trigger: "schedule", autoDispatch: false },
      events: [],
    };
    const { store } = managementStore([due]);
    await store.getState().load();
    await store.getState().tick();
    const tasks = store.getState().tasks;
    expect(tasks).toHaveLength(2);
    const instance = tasks.find((task) => task.scheduledFrom === "tpl-due");
    expect(instance).toBeTruthy();
    expect(instance?.schedule).toBeNull();
    expect(instance?.status).toBe("pending");
    expect(instance?.automation).toMatchObject({ autoDispatch: true, trigger: "schedule" });
    const template = tasks.find((task) => task.id === "tpl-due");
    expect(new Date(template?.nextRunAt ?? "").getTime()).toBeGreaterThan(Date.now());
  });

  it("skips disabled or not-yet-due templates", async () => {
    const disabled = {
      id: "tpl-off",
      title: "Paused",
      status: "pending",
      schedule: "daily",
      dailyTime: "09:00",
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      enabled: false,
      automation: { trigger: "schedule", autoDispatch: false },
    };
    const future = {
      id: "tpl-future",
      title: "Future",
      status: "pending",
      schedule: "daily",
      dailyTime: "09:00",
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
      enabled: true,
      automation: { trigger: "schedule", autoDispatch: false },
    };
    const { store } = managementStore([disabled, future]);
    await store.getState().load();
    await store.getState().tick();
    expect(store.getState().tasks).toHaveLength(2);
  });

  it("re-ticks after a failed first load so a due template still spawns", async () => {
    vi.useFakeTimers();
    const due = {
      id: "tpl-boot",
      title: "Boot template",
      status: "pending",
      schedule: "interval",
      intervalMinutes: 5,
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      enabled: true,
      requireApproval: true,
      automation: { trigger: "schedule", autoDispatch: false },
      events: [],
    };
    let reads = 0;
    const call = vi.fn(async (operation: string) => {
      if (operation === "read_super_agent_tasks") {
        reads += 1;
        if (reads === 1) {
          return { ok: false, error: "Runtime request rejected: UnknownInstance" };
        }
        return { ok: true, data: { tasks: [due] } };
      }
      if (operation === "write_super_agent_tasks") {
        return { ok: true };
      }
      return { ok: false };
    });
    const store = createTaskCenterStore({
      call,
      pollIntervalMs: 60_000,
      schedulerIntervalMs: 60_000,
    });
    await store.getState().tick();
    expect(reads).toBe(1);
    // The store's readiness retry (1.2s) reloads, then the tick retry (2s)
    // proceeds and spawns the instance.
    await vi.advanceTimersByTimeAsync(2500);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(store.getState().tasks.some((task) => task.scheduledFrom === "tpl-boot")).toBe(
      true,
    );
    vi.useRealTimers();
    store.getState().destroy();
  });

  it("labels scheduled templates and computes their next run", () => {
    expect(
      isScheduledTemplate({ schedule: "daily", dailyTime: "09:00" } as never),
    ).toBe(true);
    expect(isScheduledTemplate({ schedule: "manual" } as never)).toBe(false);
    const next = nextTaskRunAt({ schedule: "interval", intervalMinutes: 30 });
    expect(next).toBeTruthy();
  });

  it("summarizes a scheduled template's spawned instances", () => {
    const template = {
      id: "tpl",
      title: "Daily",
      status: "pending",
      schedule: "daily",
      dailyTime: "09:00",
      enabled: true,
    };
    const instances = [
      {
        id: "i1",
        scheduledFrom: "tpl",
        status: "done",
        dispatch: { startedAt: "2026-08-20T01:00:00.000Z" },
        result: { completedAt: "2026-08-20T01:30:00.000Z" },
      },
      {
        id: "i2",
        scheduledFrom: "tpl",
        status: "running",
        dispatch: { startedAt: "2026-08-21T01:00:00.000Z" },
      },
      { id: "other", scheduledFrom: "other-tpl" },
    ];
    const stats = scheduledTaskStats(template as never, instances as never);
    expect(stats.runCount).toBe(2);
    expect(stats.lastRunAt).toBe("2026-08-21T01:00:00.000Z");
  });

  it("sorts templates and active tasks ahead of finished history", () => {
    const tasks = [
      { id: "old-done", title: "Old done", status: "done", events: [{ at: "2026-08-19T00:00:00Z" }] },
      { id: "pending-1", title: "Pending", status: "pending", events: [{ at: "2026-08-21T02:00:00Z" }] },
      { id: "tpl-later", title: "Later template", status: "pending", schedule: "daily", nextRunAt: "2099-01-01T00:00:00Z", enabled: true },
      { id: "recent-done", title: "Recent done", status: "done", events: [{ at: "2026-08-21T01:00:00Z" }] },
      { id: "tpl-soon", title: "Soon template", status: "pending", schedule: "daily", nextRunAt: "2026-08-22T01:00:00Z", enabled: true },
    ];
    const sorted = sortTaskList(tasks as never);
    expect(sorted.map((t) => t.id)).toEqual([
      "tpl-soon",
      "tpl-later",
      "pending-1",
      "recent-done",
      "old-done",
    ]);
  });

  it("hides archived tasks from normal views and lists them under Archived", () => {
    const tasks = [
      { id: "a", title: "A", status: "done" },
      { id: "b", title: "B", status: "done", archived: true },
      { id: "c", title: "C", status: "running" },
    ];
    expect(filteredTasks(tasks as never, "all").map((t) => t.id)).toEqual(["c", "a"]);
    expect(filteredTasks(tasks as never, "archived").map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps pinned tasks above every other list group", () => {
    const tasks = [
      { id: "old-done", title: "Old done", status: "done" },
      { id: "pinned-history", title: "Pinned history", status: "done", pinned: true },
      { id: "pending-1", title: "Pending", status: "pending" },
      { id: "pinned-template", title: "Pinned template", status: "pending", schedule: "daily", nextRunAt: "2099-01-01T00:00:00Z", enabled: true, pinned: true },
      { id: "tpl-soon", title: "Soon template", status: "pending", schedule: "daily", nextRunAt: "2026-08-22T01:00:00Z", enabled: true },
    ];
    const sorted = sortTaskList(tasks as never);
    expect(sorted.map((t) => t.id).slice(0, 2)).toEqual([
      "pinned-template",
      "pinned-history",
    ]);
    expect(sorted.map((t) => t.id).slice(-3)).toEqual([
      "tpl-soon",
      "pending-1",
      "old-done",
    ]);
  });

  it("groups tasks by workspace preserving list order", () => {
    const tasks = [
      { id: "a", title: "A", status: "pending", targetProject: "C:/work/a" },
      { id: "b", title: "B", status: "done" },
      { id: "c", title: "C", status: "failed", dispatch: { targetProject: "C:/work/a" } },
      { id: "d", title: "D", status: "done", targetProject: "C:/work/b" },
    ];
    const groups = groupTasksByWorkspace(tasks as never);
    expect(groups.map((g) => g.workspace)).toEqual([
      "C:/work/a",
      "__default__",
      "C:/work/b",
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a", "c"]);
    expect(isDefaultWorkspace(groups[1].workspace)).toBe(true);
    expect(taskLastActivity({ events: [{ at: "2026-08-21T01:00:00Z" }] } as never)).toBe(
      "2026-08-21T01:00:00Z",
    );
    expect(taskLastActivity({} as never)).toBeNull();
  });

  it("groups the visible list by workspace from the header toggle", async () => {
    setLocale("en");
    const call = mockCall([
      { id: "a", title: "Alpha task", status: "pending", targetProject: "C:/work/a" },
      { id: "b", title: "Beta task", status: "done" },
    ]);
    const store = renderStore(call);
    await waitFor(() => expect(screen.getByText("Alpha task")).toBeTruthy());
    fireEvent.click(screen.getByText("Group by workspace"));
    const groups = document.querySelectorAll(".task-center-workspace-group");
    expect(groups.length).toBe(2);
    expect(groups[0].textContent).toContain("C:/work/a");
    expect(groups[0].textContent).toContain("Alpha task");
    expect(groups[1].textContent).toContain("Default workspace");
    expect(groups[1].textContent).toContain("Beta task");
    store.getState().destroy();
  });

  it("pins and unpins a task through the card action", async () => {
    setLocale("en");
    const call = mockCall([{ id: "t1", title: "Alpha task", status: "done" }]);
    const store = renderStore(call);
    await waitFor(() => expect(document.querySelector(".task-center-card")).toBeTruthy());
    fireEvent.click(screen.getByText("Pin"));
    await waitFor(() => expect(call).toHaveBeenCalledWith("write_super_agent_tasks", expect.anything()));
    const written = call.mock.calls.find(
      ([operation]) => operation === "write_super_agent_tasks",
    )?.[1] as { tasks?: Array<{ pinned?: boolean }> } | undefined;
    expect(written?.tasks?.[0].pinned).toBe(true);
    fireEvent.click(screen.getByText("Unpin"));
    await waitFor(() => {
      const latest = call.mock.calls.filter(
        ([operation]) => operation === "write_super_agent_tasks",
      );
      const last = latest.at(-1)?.[1] as { tasks?: Array<{ pinned?: boolean }> } | undefined;
      expect(last?.tasks?.[0].pinned).toBe(false);
    });
    store.getState().destroy();
  });

  it("reruns a completed one-off task with the same settings", async () => {
    const { store, calls } = managementStore([
      {
        id: "done-1",
        title: "Weekly digest",
        description: "Collect the news",
        targetProject: "C:/work",
        status: "done",
      },
    ]);
    await store.getState().load();
    expect(store.getState().tasks[0].status).toBe("done");
    await store.getState().rerunTask(store.getState().tasks[0]);
    const write = calls.filter((entry) => entry.operation === "write_super_agent_tasks");
    const last = write.at(-1)?.params as { tasks: Array<Record<string, unknown>> };
    const newTask = last.tasks.at(-1) as Record<string, unknown>;
    expect(newTask.title).toBe("Weekly digest");
    expect(newTask.status).toBe("pending");
    expect(newTask.automation).toMatchObject({ trigger: "manual", autoDispatch: true });
    expect(newTask.id).not.toBe("done-1");
    store.getState().destroy();
  });
});
