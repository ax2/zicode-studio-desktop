import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ProjectRunnerPanel } from "./ProjectRunnerPanel";
import type { ProjectRun, ProjectRunnerApi } from "./project-runner";
import { createProjectWorkspaceStore } from "./store";

const saved: ProjectRun = {
  id: "previous",
  workspaceId: "project",
  directory: "api",
  name: "build",
  manager: "bun",
  command: "",
  status: "unknown",
  historical: true,
  fingerprint: "saved-digest",
  startedAt: 1000,
  finishedAt: null,
  exitCode: null,
  stdout: "",
  stderr: "",
  truncated: false,
};
function api(overrides: Partial<ProjectRunnerApi> = {}): ProjectRunnerApi {
  return {
    canRun: true,
    directories: async () => ({ directories: [], incomplete: false }),
    catalog: async () => ({
      manager: "bun",
      fingerprint: "current",
      tasks: [{ name: "build", command: "bun build", runnable: true }],
    }),
    runs: async () => ({ runs: [saved], historyStatus: "persistent" }),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    clearHistory: vi.fn(async () => undefined),
    ...overrides,
  };
}
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLocale("zh-CN");
});

it("shows saved metadata and unknown outcome without offering stop or blocking new work", async () => {
  const gateway = api();
  render(<ProjectRunnerPanel workspaceId="project" api={gateway} />);
  await screen.findByText("Task outcome unknown");
  expect(screen.getByText("saved-digest")).toBeTruthy();
  expect(screen.queryByLabelText("Standard output")).toBeNull();
  expect(screen.queryByLabelText("Standard error")).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop project command" })).toBeNull();
  expect(screen.getByText(/Run summaries are saved locally/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Run project command: build" }));
  await waitFor(() =>
    expect(gateway.start).toHaveBeenCalledWith("project", "build", "current", ""),
  );
});

it("clears only after confirmation and refreshes the displayed history", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  let runs = [saved];
  const gateway = api({
    runs: async () => ({ runs, historyStatus: "persistent" }),
    clearHistory: vi.fn(async () => {
      runs = [];
    }),
  });
  render(<ProjectRunnerPanel workspaceId="project" api={gateway} />);
  await screen.findByText("Task outcome unknown");
  const button = screen.getByRole("button", { name: "Clear command history" });
  fireEvent.click(button);
  expect(gateway.clearHistory).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(button);
  await waitFor(() => expect(gateway.clearHistory).toHaveBeenCalledWith("project"));
  await waitFor(() => expect(screen.queryByText("Task outcome unknown")).toBeNull());
});

it("preserves results when clearing fails and explains the storage failure", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const gateway = api({
    clearHistory: async () => {
      throw new Error("task_history_unavailable");
    },
  });
  render(<ProjectRunnerPanel workspaceId="project" api={gateway} />);
  await screen.findByText("Task outcome unknown");
  fireEvent.click(screen.getByRole("button", { name: "Clear command history" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Saved command history is unavailable. History was not cleared.",
  );
  expect(screen.getByText("saved-digest")).toBeTruthy();
});

it("reports incomplete storage without disabling usable commands", async () => {
  const gateway = api({ runs: async () => ({ runs: [], historyStatus: "unavailable" }) });
  render(<ProjectRunnerPanel workspaceId="project" api={gateway} />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("unavailable or incomplete"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run project command: build" }));
  await waitFor(() => expect(gateway.start).toHaveBeenCalled());
});

it("keeps remote history read-only", async () => {
  render(<ProjectRunnerPanel workspaceId="project" api={api({ canRun: false })} />);
  await screen.findByText("Task outcome unknown");
  expect(screen.queryByRole("button", { name: "Clear command history" })).toBeNull();
});

it("passes persistence status and scoped clear through the store gateway", async () => {
  const clear = vi.fn(async () => ({}));
  const store = createProjectWorkspaceStore({
    dataGateway: { projectTaskRuns: async () => ({ runs: [saved], historyStatus: "persistent" }) },
    controlGateway: {
      startProjectTask: async () => ({}),
      stopProjectTask: async () => ({}),
      clearProjectTaskHistory: clear,
    },
  });
  expect(await store.getState().runner.runs("project")).toEqual({
    runs: [saved],
    historyStatus: "persistent",
  });
  await store.getState().runner.clearHistory?.("project");
  expect(clear).toHaveBeenCalledWith("project");
});

it("labels older host responses as memory-only", async () => {
  render(<ProjectRunnerPanel workspaceId="project" api={api({ runs: async () => [] })} />);
  expect(await screen.findByText("This host keeps command history in memory only.")).toBeTruthy();
  expect(screen.queryByText(/Run summaries are saved locally/)).toBeNull();
});
