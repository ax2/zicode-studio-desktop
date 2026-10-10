import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ProjectRunnerPanel } from "./ProjectRunnerPanel";
import { ProjectMain } from "./ProjectWorkspaceApp";
import type { ProjectRun, ProjectRunnerApi, TaskCatalog } from "./project-runner";
import { createProjectWorkspaceStore } from "./store";

const catalog: TaskCatalog = {
  manager: "bun",
  fingerprint: "original",
  tasks: [{ name: "dev", command: "bun app.ts", runnable: true }],
};
const running: ProjectRun = {
  id: "run-a",
  workspaceId: "a",
  name: "dev",
  manager: "bun",
  command: "bun app.ts",
  status: "running",
  startedAt: 1000,
  finishedAt: null,
  exitCode: null,
  stdout: "server ready",
  stderr: "",
  truncated: false,
};

function api(overrides: Partial<ProjectRunnerApi> = {}): ProjectRunnerApi {
  return {
    canRun: true,
    directories: vi.fn(async () => ({
      directories: [{ path: "", manifests: [] }],
      incomplete: false,
    })),
    catalog: vi.fn(async () => catalog),
    runs: vi.fn(async () => []),
    start: vi.fn(async (workspace, name, fingerprint, directory) => ({
      run: { ...running, workspaceId: workspace, name, fingerprint, directory },
    })),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLocale("zh-CN");
});

it("selects a nested directory and sends its preview with the start request", async () => {
  const gateway = api({
    directories: async () => ({
      directories: [{ path: "services/api", manifests: ["package.json"] }],
      incomplete: true,
    }),
    catalog: vi.fn(async (_workspace, directory) => ({
      ...catalog,
      fingerprint: directory || "root",
      directory,
    })),
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  await screen.findByRole("option", { name: "services/api" });
  fireEvent.change(screen.getByLabelText("Command directory"), {
    target: { value: "services/api" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Run project command: dev" }));
  await waitFor(() =>
    expect(gateway.start).toHaveBeenCalledWith("a", "dev", "services/api", "services/api"),
  );
  expect(screen.getByText(/Project discovery is incomplete/)).toBeTruthy();
});

it("ignores late catalog responses after changing directories and keeps active runs visible", async () => {
  let resolveRoot!: (value: TaskCatalog) => void;
  const gateway = api({
    directories: async () => ({
      directories: [{ path: "api", manifests: ["Cargo.toml"] }],
      incomplete: false,
    }),
    catalog: vi.fn(async (_workspace, directory) =>
      directory
        ? { ...catalog, directory, tasks: [{ name: "nested", command: "cargo check", runnable: true }] }
        : new Promise<TaskCatalog>((resolve) => {
            resolveRoot = resolve;
          }),
    ),
    runs: async () => [{ ...running, directory: "frontend" }],
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  await screen.findByRole("option", { name: "api" });
  fireEvent.change(screen.getByLabelText("Command directory"), { target: { value: "api" } });
  await screen.findByRole("button", { name: "Run project command: nested" });
  await act(async () => resolveRoot(catalog));
  expect(screen.queryByRole("button", { name: "Run project command: dev" })).toBeNull();
  expect(screen.getByText("Command directory: frontend")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Run project command: nested" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Stop project command" }));
  await waitFor(() => expect(gateway.stop).toHaveBeenCalledWith("a", "run-a"));
});

it("keeps root commands usable when directory discovery fails", async () => {
  const gateway = api({
    directories: async () => {
      throw new Error("offline");
    },
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  expect(await screen.findByText(/Project directories could not be refreshed/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Run project command: dev" }));
  await waitFor(() => expect(gateway.start).toHaveBeenCalledWith("a", "dev", "original", ""));
});

it("shows the selected Python interpreter and disables a broken virtual environment", async () => {
  const gateway = api({
    catalog: async () => ({
      ...catalog,
      manager: "python",
      tasks: [
        {
          id: "@python/unittest",
          name: "python -m unittest discover",
          command: "python -m unittest discover",
          source: "pyproject.toml",
          manager: "python",
          interpreter: "/project/.venv/bin/python",
          runnable: true,
        },
        {
          id: "@python/pytest",
          name: "python -m pytest",
          command: "python -m pytest",
          source: "pyproject.toml",
          manager: "python",
          runnable: false,
          unavailableReason: "task_python_environment_invalid",
        },
      ],
    }),
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  const available = await screen.findByRole("button", {
    name: "Run project command: python -m unittest discover",
  });
  expect(screen.getByText("Python interpreter: /project/.venv/bin/python")).toBeTruthy();
  const unavailable = screen.getByRole("button", { name: "Run project command: python -m pytest" });
  expect((unavailable as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(unavailable);
  expect(gateway.start).not.toHaveBeenCalled();
  fireEvent.click(available);
  await waitFor(() =>
    expect(gateway.start).toHaveBeenCalledWith("a", "@python/unittest", "original", ""),
  );
  expect(
    screen.getByText(
      "The project .venv is incomplete or points outside the project. Repair it, then refresh. The host Python will not be used as a fallback.",
    ),
  ).toBeTruthy();
});

it("uses distinct task IDs and renders the actual Cargo invocation", async () => {
  const gateway = api({
    catalog: async () => ({
      ...catalog,
      manager: "bun / cargo / go",
      tasks: [
        {
          id: "@package/cargo:check",
          name: "cargo:check",
          command: "echo js",
          runnable: true,
          source: "package.json",
        },
        {
          id: "@cargo/check",
          name: "cargo check",
          command: "cargo check",
          runnable: true,
          source: "Cargo.toml",
        },
      ],
    }),
    runs: vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          ...running,
          name: "cargo check",
          manager: "cargo",
          command: "cargo check",
          invocation: "cargo check",
        },
      ]),
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  fireEvent.click(await screen.findByRole("button", { name: "Run project command: cargo check" }));
  await screen.findByText("Task running");
  expect(gateway.start).toHaveBeenCalledWith("a", "@cargo/check", "original", "");
  expect(screen.getByText("Command source: Cargo.toml")).toBeTruthy();
  expect(screen.queryByText("cargo run cargo check")).toBeNull();
});

it("discovers without executing and reconciles explicit run and stop actions", async () => {
  let runs: ProjectRun[] = [];
  const gateway = api({
    runs: vi.fn(async () => runs),
    start: vi.fn(async () => {
      runs = [running];
      return { run: running };
    }),
    stop: vi.fn(async () => {
      runs = [{ ...running, status: "cancelled", finishedAt: 2000, exitCode: 1 }];
    }),
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  const run = await screen.findByRole("button", { name: "Run project command: dev" });
  expect(gateway.start).not.toHaveBeenCalled();
  expect(screen.getByText("bun app.ts")).toBeTruthy();
  fireEvent.click(run);
  fireEvent.click(run);
  await screen.findByText("Task running");
  expect(gateway.start).toHaveBeenCalledExactlyOnceWith("a", "dev", "original", "");
  expect((screen.getByLabelText("Standard output") as HTMLTextAreaElement).value).toBe(
    "server ready",
  );
  expect((run as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Stop project command" }));
  await screen.findByText("Task cancelled");
  expect(gateway.stop).toHaveBeenCalledWith("a", "run-a");
  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
});

it("keeps remote views read-only even when a task is running", async () => {
  const gateway = api({ canRun: false, runs: vi.fn(async () => [running]) });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  await screen.findByText("Task running");
  expect(
    (screen.getByRole("button", { name: "Run project command: dev" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const stop = screen.getByRole("button", { name: "Stop project command" });
  expect((stop as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(stop);
  expect(gateway.stop).not.toHaveBeenCalled();
});

it("requires a refreshed fingerprint after a manifest change", async () => {
  const gateway = api({
    start: vi
      .fn()
      .mockRejectedValueOnce(new Error("task_catalog_changed"))
      .mockResolvedValue(undefined),
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  fireEvent.click(await screen.findByRole("button", { name: "Run project command: dev" }));
  await screen.findByText("Project scripts or tool directories changed. Refresh the task list before running again.");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Refresh task list" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  vi.mocked(gateway.catalog).mockResolvedValue({ ...catalog, fingerprint: "changed" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh task list" }));
  await waitFor(() => expect(gateway.catalog).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole("button", { name: "Run project command: dev" }));
  await waitFor(() => expect(gateway.start).toHaveBeenLastCalledWith("a", "dev", "changed", ""));
});

it("discards late task data when the project shell switches workspaces", async () => {
  let resolveOld!: (value: { runs: ProjectRun[] }) => void;
  const old = new Promise<{ runs: ProjectRun[] }>((resolve) => {
    resolveOld = resolve;
  });
  const store = createProjectWorkspaceStore({
    getTarget: () => ({ workspaceId: "a" }),
    dataGateway: {
      projectTaskCatalog: async () => ({ catalog }),
      projectTaskRuns: vi.fn((workspace) =>
        workspace === "a"
          ? old
          : Promise.resolve({
              runs: [{ ...running, workspaceId: "b", stdout: "project-b-output" }],
            }),
      ),
    },
  });
  store.getState().setActiveView("runner");
  render(<ProjectMain store={store} />);
  await screen.findByRole("button", { name: "Run project command: dev" });
  await act(async () => store.getState().setTarget({ workspaceId: "b" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Standard output") as HTMLTextAreaElement).value).toBe(
      "project-b-output",
    ),
  );
  await act(async () => resolveOld({ runs: [running] }));
  expect((screen.getByLabelText("Standard output") as HTMLTextAreaElement).value).toBe(
    "project-b-output",
  );
});

it("stops polling on unmount without stopping the host task", async () => {
  vi.useFakeTimers();
  const gateway = api({ runs: vi.fn(async () => [running]) });
  const view = render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(gateway.runs).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(gateway.runs).toHaveBeenCalledTimes(2);
  view.unmount();
  await vi.advanceTimersByTimeAsync(5000);
  expect(gateway.runs).toHaveBeenCalledTimes(2);
  expect(gateway.stop).not.toHaveBeenCalled();
});

it("keeps last-known output visible but disables start after a failed refresh", async () => {
  vi.useFakeTimers();
  const gateway = api({
    runs: vi
      .fn()
      .mockResolvedValueOnce([{ ...running, status: "succeeded", finishedAt: 2000, exitCode: 0 }])
      .mockRejectedValue(new Error("offline")),
  });
  render(<ProjectRunnerPanel workspaceId="a" api={gateway} />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(
    screen.getByText("Run status could not be refreshed. Displayed results may be out of date."),
  ).toBeTruthy();
  expect((screen.getByLabelText("Standard output") as HTMLTextAreaElement).value).toBe(
    "server ready",
  );
  expect(
    (screen.getByRole("button", { name: "Run project command: dev" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
