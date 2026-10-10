import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error native shell module without declarations
import { installProjectWorkNavigation } from "../../../../public/native/features/project-work-navigation.js";
import { setLocale } from "../../shared/i18n.js";
import { AutomationMain } from "../automation/AutomationApp";
import { createAutomationStore } from "../automation/store";
import { createTaskCenterStore } from "../tasks/store";
import { TaskMain } from "../tasks/TaskCenterApp";
import { ProjectWorkPanel } from "./ProjectWorkPanel";
import { emptyProjectWork, projectWorkFromResponses } from "./project-work";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("disables project creation without an absolute project path", () => {
  render(
    <ProjectWorkPanel
      work={emptyProjectWork()}
      loading={false}
      projectPath="relative"
      openApp={vi.fn()}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "New task for this project" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "New automation for this project" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("cancels a project automation draft without saving it", async () => {
  const call = vi.fn(async (_operation: string, _params?: unknown) => ({
    ok: true,
    data: { workflows: [] },
  }));
  const store = createAutomationStore({ call, getTarget: () => ({ cwd: "/fallback" }) });
  render(<AutomationMain store={store} />);
  act(() => store.getState().requestCreation("/requested"));
  expect((screen.getByLabelText("Target project") as HTMLInputElement).value).toBe("/requested");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(store.getState().creationRequest).toBeNull();
  expect((screen.getByLabelText("Target project") as HTMLInputElement).value).toBe("/fallback");
  expect(
    call.mock.calls.some((args) => (args[1] as { action?: string })?.action === "upsert"),
  ).toBe(false);
  store.getState().destroy();
});

it("carries the clicked project through navigation, task creation and scoped readback", async () => {
  let persisted: Array<Record<string, unknown>> = [
    { id: "existing", status: "done", title: "Other project", targetProject: "/other" },
  ];
  const call = vi.fn(async (operation: string, params?: unknown) => {
    if (operation === "write_super_agent_tasks")
      persisted = (params as { tasks: typeof persisted }).tasks;
    return { ok: true, data: { tasks: persisted } };
  });
  const store = createTaskCenterStore({
    call,
    getCurrentProjectPath: () => "/different-current-project",
  });
  const remove = installProjectWorkNavigation({
    activate: vi.fn(),
    taskCenter: { newTask: (path: string) => store.getState().requestCreation(path) },
    automation: { newWorkflow: vi.fn() },
  });
  render(
    <>
      <ProjectWorkPanel
        work={emptyProjectWork()}
        loading={false}
        projectPath="C:/项目 A"
        openApp={vi.fn()}
      />
      <TaskMain store={store} />
    </>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "New task for this project" }));
    expect(((await screen.findByLabelText("Target project")) as HTMLInputElement).value).toBe(
      "C:/项目 A",
    );
    expect(call.mock.calls.some(([operation]) => operation === "write_super_agent_tasks")).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Build project" } });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Compile and report" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(persisted).toHaveLength(2));
    expect(persisted[1]).toMatchObject({ targetProject: "C:/项目 A", title: "Build project" });
    const selected = projectWorkFromResponses(
      { ok: true, data: { tasks: persisted } },
      { ok: true, data: { workflows: [] } },
      { cwd: "C:/项目 A" },
    );
    expect(selected.tasks.map((task) => task.title)).toEqual(["Build project"]);
    expect(store.getState().creationRequest).toBeNull();
  } finally {
    remove();
    store.getState().destroy();
  }
});

it("retains task input after a failed save and never writes after a failed initial read", async () => {
  let failRead = true;
  let failWrite = true;
  const call = vi.fn(async (operation: string) => ({
    ok: operation === "write_super_agent_tasks" ? !failWrite : !failRead,
    data: { tasks: [] },
  }));
  const store = createTaskCenterStore({ call });
  render(<TaskMain store={store} />);
  act(() => store.getState().requestCreation("/project/a"));
  fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Create task" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(call.mock.calls.some(([operation]) => operation === "write_super_agent_tasks")).toBe(
    false,
  );
  failRead = false;
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() =>
    expect(call.mock.calls.some(([operation]) => operation === "write_super_agent_tasks")).toBe(
      true,
    ),
  );
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep my draft");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Create task" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  failWrite = false;
  fireEvent.click(screen.getByRole("button", { name: "Create task" }));
  await waitFor(() => expect(screen.queryByLabelText("Title")).toBeNull());
  store.getState().destroy();
});

it("reinitializes an automation for a new project and preserves the editable target on save", async () => {
  const call = vi.fn(async (_operation: string, params?: unknown) => ({
    ok: true,
    data: {
      workflows: [],
      revision: "workflows-read",
      workspace: { workflows: [], revision: "workflows-saved" },
      workflow: (params as { workflow?: never })?.workflow,
    },
  }));
  const store = createAutomationStore({ call, getTarget: () => ({ cwd: "/fallback" }) });
  render(<AutomationMain store={store} />);
  act(() => store.getState().requestCreation("/project/a"));
  expect((screen.getByLabelText("Target project") as HTMLInputElement).value).toBe("/project/a");
  fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Draft A" } });
  act(() => store.getState().requestCreation("/project/b"));
  expect((screen.getByPlaceholderText("Name") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Target project") as HTMLInputElement).value).toBe("/project/b");
  fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Review B" } });
  fireEvent.change(screen.getByPlaceholderText("Task instructions"), {
    target: { value: "Review changes" },
  });
  fireEvent.change(screen.getByLabelText("Target project"), {
    target: { value: "/project/edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      "automation_workspace",
      expect.objectContaining({
        action: "upsert",
        expectedRevision: "workflows-read",
        workflow: expect.objectContaining({ targetProject: "/project/edited", title: "Review B" }),
      }),
      { target: { cwd: "/fallback" } },
    ),
  );
  await waitFor(() => expect(store.getState().creationRequest).toBeNull());
  store.getState().destroy();
});
