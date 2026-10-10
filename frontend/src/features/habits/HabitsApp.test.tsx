import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHabitsApp, HabitsMain } from "./HabitsApp";
import { createHabitsStore, type HabitsGateway } from "./habitsStore";

function stubGateway(overrides: Partial<HabitsGateway> = {}): HabitsGateway {
  return {
    list: vi.fn(async () => ({ habits: [], entries: [] })),
    upsert: vi.fn(async () => ({
      habit: {
        id: "h1",
        name: "Read",
        emoji: "📖",
        color: "#4f8cff",
        createdAt: "",
        archived: false,
      },
    })),
    toggle: vi.fn(async () => ({ entry: null })),
    remove: vi.fn(async () => ({ removed: true })),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("keeps inactive scope changes local and loads when the app is opened", async () => {
  const gateway = stubGateway();
  const app = createHabitsApp({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "isolated" }),
    notify: vi.fn(),
  });
  await app.setTarget();
  expect(gateway.list).not.toHaveBeenCalled();
  const container = document.createElement("div");
  document.body.append(container);
  act(() => app.renderContent(container));
  await waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(1));
  await act(async () => {
    app.deactivate();
    await app.setTarget();
  });
  expect(gateway.list).toHaveBeenCalledTimes(1);
  act(() => app.destroy());
});

it("rejects a late list response after a scope reset", async () => {
  let complete: (value: Awaited<ReturnType<HabitsGateway["list"]>>) => void = () => {};
  const gateway = stubGateway({
    list: vi.fn(
      () =>
        new Promise<Awaited<ReturnType<HabitsGateway["list"]>>>((resolve) => {
          complete = resolve;
        }),
    ),
  });
  const store = createHabitsStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "isolated" }),
    notify: vi.fn(),
  });
  const pending = store.getState().load();
  store.getState().resetScope();
  complete({
    habits: [
      { id: "old", name: "Old workspace", emoji: "", color: "", createdAt: "", archived: false },
    ],
    entries: [],
  });
  await pending;
  expect(store.getState().busy).toBe(false);
  expect(store.getState().habits).toEqual([]);
});

describe("habits composer", () => {
  it("adds a habit when the composer form is submitted", async () => {
    const gateway = stubGateway();
    const store = createHabitsStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const { container } = render(<HabitsMain store={store} />);
    await waitFor(() => expect(store.getState().busy).toBe(false));
    const input = container.querySelector(".habits-name-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Meditate");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const form = container.querySelector(".habits-composer-row") as HTMLFormElement;
    form.requestSubmit();

    await waitFor(() => expect(gateway.upsert).toHaveBeenCalled());
  });
});
