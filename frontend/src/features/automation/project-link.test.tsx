import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { AutomationMain } from "./AutomationApp";
import { createAutomationStore } from "./store";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("opens the selected workflow despite an existing search and can return to all workflows", async () => {
  const workflows = [
    { id: "a", title: "Build A", prompt: "Build", enabled: true, schedule: "manual" as const },
    { id: "b", title: "Review B", prompt: "Review", enabled: true, schedule: "manual" as const },
  ];
  const store = createAutomationStore({
    call: async (operation) =>
      operation === "automation_workspace"
        ? { ok: true, data: { workflows, revision: "workflows-a" } }
        : { ok: true, data: { tasks: [] } },
  });
  render(<AutomationMain store={store} />);
  await act(() => store.getState().load());
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Review B" } });
  expect(screen.queryByText("Build A")).toBeNull();
  act(() => store.getState().focusWorkflow("a"));
  expect(screen.getByText("Build A")).toBeTruthy();
  expect(screen.queryByText("Review B")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all automations" }));
  expect(screen.getByText("Build A")).toBeTruthy();
  expect(screen.getByText("Review B")).toBeTruthy();
  act(() => store.getState().focusWorkflow("removed"));
  await waitFor(() =>
    expect(screen.getByText("The selected automation is no longer available.")).toBeTruthy(),
  );
  store.getState().destroy();
});
