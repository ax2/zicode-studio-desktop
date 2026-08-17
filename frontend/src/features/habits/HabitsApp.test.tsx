import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { HabitsMain } from "./HabitsApp";
import { createHabitsStore, type HabitsGateway } from "./habitsStore";

function stubGateway(overrides: Partial<HabitsGateway> = {}): HabitsGateway {
  return {
    list: vi.fn(async () => ({ habits: [], entries: [] })),
    upsert: vi.fn(async () => ({ habit: { id: "h1", name: "Read", emoji: "📖", color: "#4f8cff", createdAt: "", archived: false } })),
    toggle: vi.fn(async () => ({ entry: null })),
    remove: vi.fn(async () => ({ removed: true })),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
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
    const input = container.querySelector(
      ".habits-name-input",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "Meditate");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const form = container.querySelector(
      ".habits-composer-row",
    ) as HTMLFormElement;
    form.requestSubmit();

    await waitFor(() => expect(gateway.upsert).toHaveBeenCalled());
  });
});
