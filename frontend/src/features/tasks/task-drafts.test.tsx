import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { filteredTasks, isScheduledTemplate, type SuperAgentTask } from "./logic";
import { createTaskCenterStore } from "./store";
import { TaskMain, TaskNav } from "./TaskCenterApp";

function service(initial: SuperAgentTask[] = []) {
  let tasks = structuredClone(initial);
  let revision = 0;
  const call = vi.fn(async (operation: string, params?: unknown) => {
    if (operation === "read_super_agent_tasks")
      return { ok: true, data: { tasks: structuredClone(tasks), revision: String(revision) } };
    if (operation !== "write_super_agent_tasks") return { ok: true, data: { projects: [] } };
    const value = params as { tasks: SuperAgentTask[]; revision: string };
    if (value.revision !== String(revision)) return { ok: false, error: "task_conflict" };
    tasks = structuredClone(value.tasks);
    return { ok: true, data: { revision: String(++revision) } };
  });
  return {
    call,
    read: () => tasks,
    change: () => {
      revision++;
    },
  };
}

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  vi.restoreAllMocks();
});

it("saves a scheduled draft, reopens it in a fresh center and activates the same task", async () => {
  setLocale("en");
  const backend = service();
  const store = createTaskCenterStore({ call: backend.call });
  await store.getState().createTask({
    title: "Later",
    description: "Unfinished plan",
    targetProject: "/project",
    schedule: "interval",
    intervalMinutes: 15,
    saveAsDraft: true,
  });
  expect(backend.read()[0]).toMatchObject({
    status: "draft",
    enabled: false,
    nextRunAt: null,
    automation: { autoDispatch: false },
  });
  const id = backend.read()[0].id;
  store.getState().destroy();
  const restored = createTaskCenterStore({ call: backend.call });
  try {
    await restored.getState().load();
    expect(filteredTasks(restored.getState().tasks, "draft")).toHaveLength(1);
    expect(filteredTasks(restored.getState().tasks, "scheduled")).toHaveLength(0);
    // A draft remains inert even if stale scheduling flags look due.
    restored.setState({
      tasks: restored
        .getState()
        .tasks.map((task) => ({ ...task, enabled: true, nextRunAt: "2020-01-01T00:00:00Z" })),
    });
    const writeCalls = () =>
      backend.call.mock.calls.filter(([operation]) => operation === "write_super_agent_tasks");
    const writes = writeCalls().length;
    await restored.getState().tick();
    await restored.getState().runTaskNow(restored.getState().tasks[0]);
    await restored.getState().approveTask(restored.getState().tasks[0]);
    await restored.getState().retryAndRunTask(restored.getState().tasks[0]);
    await restored.getState().rerunTask(restored.getState().tasks[0]);
    expect(writeCalls()).toHaveLength(writes);
    expect(backend.read()[0]).toMatchObject({ id, status: "draft", enabled: false });
    render(<TaskMain store={restored} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Interval (minutes)") as HTMLInputElement).value).toBe("15");
    fireEvent.click(screen.getByRole("button", { name: "Activate task" }));
    await waitFor(() => expect(backend.read()[0].status).toBe("pending"));
    expect(backend.read()).toHaveLength(1);
    expect(backend.read()[0]).toMatchObject({ id, enabled: true, schedule: "interval" });
    expect(isScheduledTemplate(backend.read()[0])).toBe(true);
    expect(backend.read()[0].nextRunAt).toBeTruthy();
  } finally {
    restored.getState().destroy();
  }
});

it("retains edits on conflict, then saves the draft after refresh and can delete it", async () => {
  setLocale("en");
  const backend = service([
    { id: "draft", title: "Idea", description: "", status: "draft", targetProject: "/a" },
  ]);
  const store = createTaskCenterStore({ call: backend.call });
  await store.getState().load();
  render(
    <>
      <TaskNav store={store} />
      <TaskMain store={store} />
    </>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Drafts 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Continue tomorrow" },
    });
    backend.change();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect((screen.getByLabelText("Instructions") as HTMLTextAreaElement).value).toBe(
      "Continue tomorrow",
    );
    expect(backend.read()[0].description).toBe("");
    await act(async () => {
      await store.getState().load();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByLabelText("Instructions")).toBeNull());
    expect(backend.read()[0]).toMatchObject({
      status: "draft",
      description: "Continue tomorrow",
      nextRunAt: null,
      automation: { autoDispatch: false },
    });
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(backend.read()).toHaveLength(0));
  } finally {
    store.getState().destroy();
  }
});

it("creates a draft from the form and preserves the chosen target without dispatching", async () => {
  setLocale("en");
  const backend = service();
  const store = createTaskCenterStore({ call: backend.call });
  await store.getState().load();
  render(<TaskMain store={store} />);
  try {
    fireEvent.click(screen.getAllByRole("button", { name: "New task" })[0]);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Read docs" } });
    fireEvent.change(screen.getByLabelText("Target project"), {
      target: { value: "C:/开发/工具" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(backend.read()).toHaveLength(1));
    expect(backend.read()[0]).toMatchObject({
      status: "draft",
      targetProject: "C:/开发/工具",
      automation: { autoDispatch: false },
    });
    await act(async () => {
      expect(
        await store.getState().updateTaskMeta(backend.read()[0].id, { saveAsDraft: false }),
      ).toBe(true);
    });
    expect(backend.read()[0]).toMatchObject({
      status: "pending",
      automation: { autoDispatch: true },
    });
    expect(await store.getState().updateTaskMeta(backend.read()[0].id, { saveAsDraft: true })).toBe(
      false,
    );
    expect(backend.read()[0].status).toBe("pending");
  } finally {
    store.getState().destroy();
  }
});
