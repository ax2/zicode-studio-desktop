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
