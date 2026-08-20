import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "../../shared/i18n.js";
import { AutomationMain, AutomationNav } from "./AutomationApp";
import {
  isAutomationDue,
  nextAutomationRun,
  type AutomationRun,
  type AutomationWorkflow,
} from "./logic";
import { createAutomationStore } from "./store";

const WORKFLOW: AutomationWorkflow = {
  id: "workflow-1",
  title: "Daily report",
  prompt: "Prepare the report",
  targetProject: "C:/work/project",
  enabled: true,
  schedule: "manual",
  requireApproval: true,
  approvalPending: true,
  maxRetries: 2,
  history: [],
};

function mockCall() {
  const call = vi.fn(
    async (
      operation: string,
      params?: unknown,
    ): Promise<{
      ok?: boolean;
      error?: string;
      data?: {
        workflows?: AutomationWorkflow[];
        workflow?: AutomationWorkflow;
        tasks?: unknown[];
        workspace?: { workflows?: AutomationWorkflow[] };
      };
    }> => {
    const p = (params ?? {}) as Record<string, unknown>;
      if (operation === "automation_workspace" && p.action === "list") {
        return { ok: true, data: { workflows: [WORKFLOW] } };
      }
      if (operation === "automation_workspace" && p.action === "upsert") {
        const workflow = p.workflow as AutomationWorkflow;
        return {
          ok: true,
          data: {
            workspace: { workflows: [WORKFLOW, workflow] },
            workflow,
          },
        };
      }
      if (operation === "automation_workspace" && p.action === "remove") {
        return { ok: true, data: { workflows: [] } };
      }
      if (operation === "read_super_agent_tasks") {
        return { ok: true, data: { tasks: [] } };
      }
      if (operation === "write_super_agent_tasks") {
        return { ok: true, data: { tasks: p.tasks as unknown[] } };
      }
      if (operation === "automation_workspace" && p.action === "record_run") {
        return {
          ok: true,
          data: {
            workspace: {
              workflows: [
                { ...WORKFLOW, approvalPending: false, history: [p.run as AutomationRun] },
              ],
            },
          },
        };
      }
      return { ok: false, error: `unhandled ${operation}` };
    },
  );
  return call;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("automation logic", () => {
  it("calculates interval schedules and ignores approval-pending workflows", () => {
    expect(
      nextAutomationRun(
        { enabled: true, schedule: "interval", intervalMinutes: 30 },
        new Date("2026-07-31T10:00:00.000Z"),
      ),
    ).toBe("2026-07-31T10:30:00.000Z");
    expect(
      isAutomationDue(
        { enabled: true, schedule: "daily", nextRunAt: "2026-07-31T09:00:00.000Z" },
        new Date("2026-07-31T10:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isAutomationDue({ enabled: true, schedule: "daily", approvalPending: true }),
    ).toBe(false);
  });
});

describe("automation store host errors", () => {
  it("localizes a closed Pi runtime in the error state", async () => {
    setLocale("zh-CN");
    const call = vi.fn(async () => {
      throw new Error("Pi RPC request failed: ProcessClosed");
    });
    const store = createAutomationStore({ call, retryDelayMs: 0 });
    await store.getState().load();
    expect(store.getState().error?.message).toBe(
      "Pi 运行时连接已断开。请重试或新建一个会话。",
    );
    store.getState().destroy();
  });

  it("retries briefly when the Pi runtime is still starting", async () => {
    setLocale("zh-CN");
    let attempts = 0;
    const call = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Pi RPC request failed: ProcessClosed");
      }
      return { ok: true, data: { workflows: [WORKFLOW] } };
    });
    const store = createAutomationStore({ call, retryDelayMs: 0 });
    const workflows = await store.getState().load();
    expect(workflows).toEqual([WORKFLOW]);
    expect(store.getState().error).toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
    store.getState().destroy();
  });

  it("skips removing a workflow when the confirmation is declined", async () => {
    const call = mockCall();
    const store = createAutomationStore({ call, confirmRemove: () => false });
    await store.getState().load();
    await store.getState().removeWorkflow("workflow-1");
    expect(call).not.toHaveBeenCalledWith(
      "automation_workspace",
      expect.objectContaining({ action: "remove" }),
    );
  });

  it("removes a workflow only after confirmation", async () => {
    const call = mockCall();
    const store = createAutomationStore({ call, confirmRemove: () => true });
    await store.getState().load();
    await store.getState().removeWorkflow("workflow-1");
    expect(call).toHaveBeenCalledWith(
      "automation_workspace",
      expect.objectContaining({ action: "remove", id: "workflow-1" }),
    );
  });

  it("keeps scheduling remaining automations when one fails", async () => {
    const dueWorkflow = (id: string): AutomationWorkflow => ({
      ...WORKFLOW,
      id,
      title: id,
      enabled: true,
      schedule: "interval",
      intervalMinutes: 30,
      requireApproval: false,
      approvalPending: false,
      nextRunAt: null,
    });
    const readTasks = vi.fn(async () => {
      throw new Error("task service down");
    });
    const call = vi.fn(async (operation: string, params?: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      if (operation === "automation_workspace" && p.action === "list") {
        return {
          ok: true,
          data: { workflows: [dueWorkflow("wf-1"), dueWorkflow("wf-2")] },
        };
      }
      if (operation === "read_super_agent_tasks") {
        return readTasks();
      }
      return { ok: true, data: {} };
    });
    const store = createAutomationStore({ call });
    await store.getState().tick();
    expect(readTasks).toHaveBeenCalledTimes(2);
    store.getState().destroy();
  });

  it("creates an approval task when a due workflow requires approval", async () => {
    const call = mockCall();
    const store = createAutomationStore({ call });
    call.mockImplementation(async (operation: string, params?: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      if (operation === "automation_workspace" && p.action === "list") {
        return {
          ok: true,
          data: {
            workflows: [
              {
                ...WORKFLOW,
                id: "wf-approve",
                enabled: true,
                schedule: "daily",
                dailyTime: "00:00",
                requireApproval: true,
                approvalPending: false,
                nextRunAt: new Date(Date.now() - 60_000).toISOString(),
              },
            ],
          },
        };
      }
      if (operation === "read_super_agent_tasks") {
        return { ok: true, data: { tasks: [] } };
      }
      if (operation === "automation_workspace" && p.action === "record_run") {
        return { ok: true, data: {} };
      }
      return { ok: true, data: {} };
    });
    await store.getState().tick();
    const write = call.mock.calls.find(
      ([operation, params]) =>
        operation === "write_super_agent_tasks" &&
        (params as { tasks?: unknown[] })?.tasks !== undefined,
    );
    const tasks = (write?.[1] as { tasks: Array<Record<string, unknown>> }).tasks;
    const task = tasks.find((item) => {
      const source = (item.source ?? {}) as { channel?: string };
      return source.channel === "automation";
    });
    expect(task?.automation).toMatchObject({
      workflowId: "wf-approve",
      trigger: "schedule",
      autoDispatch: false,
    });
    expect(task?.status).toBe("pending");
    store.getState().destroy();
  });
});

describe("automation auto-dispatch flag", () => {
  it("marks non-approval workflow tasks for automatic dispatch", async () => {
    const call = mockCall();
    const store = createAutomationStore({ call });
    await store
      .getState()
      .runWorkflow({ ...WORKFLOW, requireApproval: false }, "schedule");
    const write = call.mock.calls.find(
      ([operation, params]) =>
        operation === "write_super_agent_tasks" &&
        (params as { tasks?: unknown[] })?.tasks !== undefined,
    );
    const written = (write?.[1] as { tasks: Array<Record<string, unknown>> }).tasks;
    const task = written.find((item) => {
      const source = (item.source ?? {}) as { channel?: string };
      return source.channel === "automation";
    });
    expect(task?.automation).toMatchObject({ autoDispatch: true });
    store.getState().destroy();
  });

  it("keeps approval workflows pending for manual approval", async () => {
    const call = mockCall();
    const store = createAutomationStore({ call });
    await store
      .getState()
      .runWorkflow({ ...WORKFLOW, requireApproval: true }, "schedule");
    const write = call.mock.calls.find(
      ([operation, params]) =>
        operation === "write_super_agent_tasks" &&
        (params as { tasks?: unknown[] })?.tasks !== undefined,
    );
    const written = (write?.[1] as { tasks: Array<Record<string, unknown>> }).tasks;
    const task = written.find((item) => {
      const source = (item.source ?? {}) as { channel?: string };
      return source.channel === "automation";
    });
    expect(task?.automation).toMatchObject({ autoDispatch: false });
    store.getState().destroy();
  });
});

describe("automation React app", () => {
  it("renders workflows from the workspace and shows approval actions", async () => {
    setLocale("en");
    const call = mockCall();
    const store = createAutomationStore({ call });
    await store.getState().load();
    render(
      <div>
        <AutomationNav store={store} />
        <AutomationMain store={store} />
      </div>,
    );
    await waitFor(() => expect(screen.getByText("Daily report")).toBeTruthy());
    expect(screen.getByText("Approve and run")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("creates a workflow through the form and calls upsert", async () => {
    setLocale("en");
    const call = mockCall();
    const store = createAutomationStore({ call });
    render(<AutomationMain store={store} />);
    fireEvent.input(screen.getByPlaceholderText("Name"), {
      target: { value: "Weekly digest" },
    });
    fireEvent.input(screen.getByPlaceholderText("Task instructions"), {
      target: { value: "Summarize the week" },
    });
    fireEvent.click(screen.getByText("Create automation"));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("automation_workspace", expect.objectContaining({})),
    );
    const upsert = call.mock.calls.find(
      ([operation, params]) =>
        operation === "automation_workspace" &&
        (params as Record<string, unknown>)?.action === "upsert",
    );
    expect(upsert?.[1]).toMatchObject({
      workflow: { title: "Weekly digest", prompt: "Summarize the week" },
    });
  });

  it("explains the approval mode with a contextual form hint", async () => {
    setLocale("en");
    const call = mockCall();
    const store = createAutomationStore({ call });
    const { container } = render(<AutomationMain store={store} />);
    const hint = () =>
      container.querySelector(".automation-checkbox-hint")?.textContent?.trim() ?? "";
    // Scheduled tasks run automatically by default; approval is opt-in.
    expect(hint()).toContain("Runs automatically when due");
    fireEvent.click(screen.getByText("Require approval before every run"));
    expect(hint()).toContain("waits for your approval");
    fireEvent.click(screen.getByText("Require approval before every run"));
    expect(hint()).toContain("Runs automatically when due");
  });

  it("approves and queues an automation through the task store", async () => {
    setLocale("en");
    const call = mockCall();
    const store = createAutomationStore({ call });
    await store.getState().load();
    render(<AutomationMain store={store} />);
    await waitFor(() => expect(screen.getByText("Approve and run")).toBeTruthy());
    fireEvent.click(screen.getByText("Approve and run"));
    await waitFor(() => expect(call).toHaveBeenCalledWith("read_super_agent_tasks"));
    expect(call).toHaveBeenCalledWith(
      "write_super_agent_tasks",
      expect.objectContaining({ tasks: expect.any(Array) }),
    );
    expect(
      call.mock.calls.some(
        ([operation, params]) =>
          operation === "automation_workspace" &&
          (params as Record<string, unknown>)?.action === "record_run",
      ),
    ).toBe(true);
  });
});
