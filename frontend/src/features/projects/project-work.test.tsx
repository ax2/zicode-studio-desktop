import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ProjectMain } from "./ProjectWorkspaceApp";
import { projectPathKey, projectWorkFromResponses } from "./project-work";
import { createProjectWorkspaceStore } from "./store";

const target = { workspaceId: "a", cwd: "C:/Work/A" };
const tasks = [
  { id: "a-task", title: "Implement A", targetProject: "c:\\work\\a\\", status: "running" },
  { id: "b-task", title: "Other project", targetProject: "C:/Work/B", status: "failed" },
  { id: "unassigned", title: "Unassigned", status: "pending" },
  { id: "child", title: "Workspace match", dispatch: { childWorkspaceId: "a" }, status: "done" },
  {
    id: "conflict",
    targetProject: "C:/Work/B",
    dispatch: { childWorkspaceId: "a" },
    status: "running",
  },
  { id: "archived", targetProject: "C:/Work/A", archived: true, status: "done" },
];
const workflows = [
  {
    id: "a-flow",
    title: "Review A",
    targetProject: "C:/work/a",
    enabled: true,
    approvalPending: true,
  },
  { id: "b-flow", title: "Review B", targetProject: "C:/work/b", enabled: true },
];
const response = (data: unknown) => ({ ok: true, data });
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("associates only explicit paths or workspace IDs, with platform-appropriate case rules", () => {
  const work = projectWorkFromResponses(response({ tasks }), response({ workflows }), target);
  expect(work.tasks.map((task) => task.id)).toEqual(["a-task", "child"]);
  expect(work.automations.map((workflow) => workflow.id)).toEqual(["a-flow"]);
  expect(projectPathKey("\\\\?\\UNC\\Server\\Share\\A\\")).toBe(projectPathKey("//server/share/a"));
  expect(projectPathKey("\\\\?\\C:\\Work\\A")).toBe(projectPathKey("c:/work/a"));
  expect(projectPathKey("/work/A")).not.toBe(projectPathKey("/work/a"));
  expect(projectPathKey("/work/a\\b")).not.toBe(projectPathKey("/work/a/b"));
  for (const path of ["relative", "C:relative", "/work/../a", "C:/work/./a"])
    expect(projectPathKey(path)).toBe("");
  expect(
    projectWorkFromResponses(response({ tasks }), response({ workflows }), null).tasks,
  ).toEqual([]);
  expect(
    projectWorkFromResponses(
      response({ tasks: [{ id: "nested", targetProject: "C:/Work/A/sub" }] }),
      response({ workflows: [] }),
      target,
    ).tasks,
  ).toEqual([]);
});

it("preserves prior matching work on failed reads and accepts an explicit empty recovery", () => {
  const previous = projectWorkFromResponses(
    response({ tasks }),
    response({ workspace: { workflows } }),
    target,
  );
  const failed = projectWorkFromResponses(
    { ok: false },
    response({ workflows: "invalid" }),
    target,
    previous,
  );
  expect(failed.tasksUnavailable).toBe(true);
  expect(failed.automationsUnavailable).toBe(true);
  expect(failed.tasks).toEqual(previous.tasks);
  const recovered = projectWorkFromResponses(
    response({ tasks: [] }),
    response({ workflows: [] }),
    target,
    failed,
  );
  expect(recovered.tasks).toEqual([]);
  expect(recovered.tasksUnavailable).toBe(false);
});

it("opens project work from the scoped totals and dispatches exact task and workflow links", async () => {
  const store = createProjectWorkspaceStore({
    getTarget: () => target,
    call: async (operation) =>
      operation === "read_super_agent_tasks"
        ? response({ tasks })
        : operation === "automation_workspace"
          ? response({ workflows })
          : response({}),
  });
  render(<ProjectMain store={store} />);
  await act(() => store.getState().load());
  expect(store.getState().snapshot.taskCount).toBe(2);
  expect(store.getState().snapshot.automationCount).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "2 Tasks" }));
  expect(screen.queryByText("Other project")).toBeNull();
  expect(screen.queryByText("Review B")).toBeNull();
  const listener = vi.fn();
  window.addEventListener("zicode:open-task", listener);
  window.addEventListener("zicode:open-automation", listener);
  try {
    fireEvent.click(screen.getByRole("button", { name: /Implement A/ }));
    expect(listener.mock.calls[0][0].detail).toEqual({ taskId: "a-task" });
    fireEvent.click(screen.getByRole("button", { name: /Review A/ }));
    expect(listener.mock.calls[1][0].detail).toEqual({ workflowId: "a-flow" });
  } finally {
    window.removeEventListener("zicode:open-task", listener);
    window.removeEventListener("zicode:open-automation", listener);
  }
});

it("clears previous project data before a switch and ignores late reads", async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  let reads = 0;
  const store = createProjectWorkspaceStore({
    getTarget: () => target,
    call: async (operation) => {
      if (operation === "read_super_agent_tasks" && ++reads === 1)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return operation === "read_super_agent_tasks"
        ? response({ tasks })
        : operation === "automation_workspace"
          ? response({ workflows })
          : response({});
    },
  });
  const first = store.getState().load();
  store.getState().setTarget({ workspaceId: "b", cwd: "C:/Work/B" });
  expect(store.getState().snapshot.work.tasks).toEqual([]);
  await waitFor(() => expect(store.getState().snapshot.work.tasks[0]?.id).toBe("b-task"));
  resolveOld(response({ tasks }));
  await first;
  expect(store.getState().snapshot.work.tasks.map((task) => task.id)).toEqual([
    "b-task",
    "conflict",
  ]);
});

it("shows an unavailable source instead of a false empty list and recovers on refresh", async () => {
  let fail = false;
  const store = createProjectWorkspaceStore({
    getTarget: () => target,
    call: async (operation) => {
      if (fail) return { ok: false };
      return response(
        operation === "read_super_agent_tasks"
          ? { tasks }
          : operation === "automation_workspace"
            ? { workflows }
            : {},
      );
    },
  });
  render(<ProjectMain store={store} />);
  await act(() => store.getState().load());
  act(() => store.getState().setActiveView("work"));
  fail = true;
  await act(() => store.getState().load());
  expect(screen.getByText(/Project tasks could not be refreshed/)).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Project tasks" })).getByText("Implement A"),
  ).toBeTruthy();
  expect(screen.queryByText("No tasks are linked to this project.")).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(screen.queryByText(/Project tasks could not be refreshed/)).toBeNull(),
  );
});
