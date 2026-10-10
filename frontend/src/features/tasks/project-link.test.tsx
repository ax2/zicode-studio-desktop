import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { createTaskCenterStore } from "./store";
import { TaskMain } from "./TaskCenterApp";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("clears search and date filters to reveal a task opened from its project", async () => {
  const tasks = [
    {
      id: "old-task",
      title: "Project build",
      status: "done",
      result: { completedAt: "2020-01-01T00:00:00Z" },
    },
  ];
  const store = createTaskCenterStore({ call: async () => ({ ok: true, data: { tasks } }) });
  render(<TaskMain store={store} />);
  await act(() => store.getState().load());
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "something else" } });
  fireEvent.change(screen.getByLabelText("Filter by date"), { target: { value: "today" } });
  expect(screen.queryByText("Project build")).toBeNull();
  act(() => store.getState().focusTask("old-task"));
  await waitFor(() => expect(screen.getByText("Project build")).toBeTruthy());
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Filter by date") as HTMLSelectElement).value).toBe("all");
  expect(
    document.querySelector('[data-task-id="old-task"]')?.classList.contains("is-focused"),
  ).toBe(true);
  store.getState().destroy();
});

it("reports a removed task and lets the user dismiss the stale link", async () => {
  const store = createTaskCenterStore({ call: async () => ({ ok: true, data: { tasks: [] } }) });
  render(<TaskMain store={store} />);
  await act(() => store.getState().load());
  act(() => store.getState().focusTask("removed"));
  expect(screen.getByText("The selected task is no longer available.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(store.getState().focusTaskId).toBeNull();
  store.getState().destroy();
});
