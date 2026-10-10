import { afterEach, expect, it, vi } from "vitest";
import { HostControlGateway } from "./control-gateway.js";
import { HostDataGateway } from "./data-gateway.js";
import { createInMemoryRuntimeAdapter } from "./runtime-gateway.js";

afterEach(() => vi.useRealTimers());

it("uses write requests for start/stop/clear and preserves the preview fingerprint", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const control = new HostControlGateway(adapter);
  for (const [promise, expected] of [
    [
      control.startProjectTask("workspace", "dev", "sha", "services/api"),
      {
        operation: "start_project_task",
        workspaceId: "workspace",
        name: "dev",
        fingerprint: "sha",
        directory: "services/api",
      },
    ],
    [
      control.clearProjectTaskHistory("workspace"),
      { operation: "clear_project_task_history", workspaceId: "workspace" },
    ],
    [
      control.stopProjectTask("workspace", "run"),
      { operation: "stop_project_task", workspaceId: "workspace", runId: "run" },
    ],
  ]) {
    const frame = adapter.takeSent();
    expect(frame).toMatchObject({ type: "host_request", ...expected });
    adapter.receive({ type: "host_response", requestId: frame.requestId, run: { id: "run" } });
    await expect(promise).resolves.toMatchObject({ run: { id: "run" } });
  }
});

it("times out a control request instead of leaving the run button pending forever", async () => {
  vi.useFakeTimers();
  const adapter = createInMemoryRuntimeAdapter();
  const control = new HostControlGateway(adapter);
  const request = control.startProjectTask("workspace", "dev", "sha");
  const checked = expect(request).rejects.toThrow("task_request_timed_out");
  await vi.advanceTimersByTimeAsync(15000);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});

it("allows catalog/history reads and rejects attempts to mutate through the read gateway", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const data = new HostDataGateway(adapter);
  for (const method of ["projectTaskCatalog", "projectTaskRuns", "projectTaskDirectories"]) {
    const request = data[method]("workspace", "services/api");
    await Promise.resolve();
    const frame = adapter.takeSent();
    expect(frame.type).toBe("data_request");
    expect(frame.workspaceId).toBe("workspace");
    if (method === "projectTaskCatalog") expect(frame.directory).toBe("services/api");
    adapter.receive({ type: "data_response", requestId: frame.requestId });
    await request;
  }
  await expect(data.request("start_project_task", {})).rejects.toThrow("Unsupported read-only");
  await expect(data.request("clear_project_task_history", {})).rejects.toThrow(
    "Unsupported read-only",
  );
});
