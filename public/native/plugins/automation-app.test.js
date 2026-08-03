import { afterEach, describe, expect, it, vi } from "vitest";
import { isAutomationDue, nextAutomationRun, setupAutomationApp } from "./automation-app.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("automation app", () => {
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

  it("queues an approved automation through the global task store", async () => {
    const workflow = {
      id: "workflow-1",
      title: "Daily report",
      prompt: "Prepare the report",
      targetProject: "C:/work/project",
      enabled: true,
      schedule: "manual",
      requireApproval: true,
      approvalPending: true,
      history: [],
    };
    const call = vi.fn(async (operation, params) => {
      if (operation === "automation_workspace" && params.action === "list") {
        return { ok: true, data: { workflows: [workflow] } };
      }
      if (operation === "read_super_agent_tasks") return { ok: true, data: { tasks: [] } };
      if (operation === "write_super_agent_tasks") return { ok: true };
      if (operation === "automation_workspace" && params.action === "record_run") {
        return { ok: true, data: { workspace: { workflows: [{ ...workflow, approvalPending: false }] } } };
      }
      return { ok: true, data: { workflows: [workflow] } };
    });
    document.body.innerHTML = '<aside id="nav"></aside><main id="content"></main>';
    const app = setupAutomationApp({ call, pollIntervalMs: 60_000 });
    app.renderNavigation(document.getElementById("nav"));
    app.renderContent(document.getElementById("content"));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Daily report"));
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent.includes("批准"))
      .click();
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_super_agent_tasks",
        expect.objectContaining({ tasks: [expect.objectContaining({ title: "Daily report" })] }),
      ),
    );
    app.destroy();
  });

  it("creates a workflow from the rendered form controls", async () => {
    let workflows = [];
    const notify = vi.fn();
    const call = vi.fn(async (operation, params) => {
      if (operation === "automation_workspace" && params.action === "list") {
        return { ok: true, data: { workflows } };
      }
      if (operation === "automation_workspace" && params.action === "upsert") {
        const workflow = {
          ...params.workflow,
          id: params.workflow.id || "workflow-created",
          history: params.workflow.history || [],
        };
        workflows = [workflow];
        return { ok: true, data: { workflow, workspace: { workflows } } };
      }
      return { ok: true, data: { tasks: [] } };
    });
    document.body.innerHTML = '<aside id="nav"></aside><main id="content"></main>';
    const app = setupAutomationApp({ call, notify, pollIntervalMs: 60_000 });
    app.renderNavigation(document.getElementById("nav"));
    app.renderContent(document.getElementById("content"));
    await vi.waitFor(() => expect(document.querySelector(".automation-form")).toBeTruthy());

    const fields = [...document.querySelectorAll(".automation-field")];
    expect(fields).toHaveLength(6);
    expect(
      fields.every((field) => Boolean(field.querySelector(".automation-field-label")?.textContent)),
    ).toBe(true);
    expect(document.querySelector(".automation-form .ui-select").labels?.[0]).toBe(
      document.querySelector(".automation-form .ui-select").closest("label"),
    );

    const inputs = document.querySelectorAll(".automation-form .ui-input");
    inputs[0].value = "Weekly mobile report";
    inputs[1].value = "C:/work/mobile";
    document.querySelector(".automation-form .ui-textarea").value =
      "Summarize mobile validation results.";
    document.querySelector('.automation-form button[type="submit"]').click();

    await vi.waitFor(() =>
      expect(document.querySelector(".automation-card h2")?.textContent).toBe(
        "Weekly mobile report",
      ),
    );
    expect(call).toHaveBeenCalledWith(
      "automation_workspace",
      expect.objectContaining({
        action: "upsert",
        workflow: expect.objectContaining({
          title: "Weekly mobile report",
          targetProject: "C:/work/mobile",
          prompt: "Summarize mobile validation results.",
          schedule: "manual",
        }),
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String), type: "success" }),
    );
    app.destroy();
  });
});
