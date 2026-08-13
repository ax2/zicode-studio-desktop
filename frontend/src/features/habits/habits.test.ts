import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { createHabitsStore, type HabitsGateway } from "./habitsStore";
import { currentStreak, lastDates, toDateKey } from "./habitsLogic";

const HABIT = {
  id: "h1",
  name: "Read",
  emoji: "📖",
  color: "#4f8cff",
  createdAt: "2026-08-13T10:00:00Z",
  archived: false,
};

function stubGateway(overrides: Partial<HabitsGateway> = {}): HabitsGateway {
  return {
    list: vi.fn(async () => ({ habits: [HABIT], entries: [] })),
    upsert: vi.fn(async () => ({ habit: HABIT })),
    toggle: vi.fn(async () => ({ entry: null })),
    remove: vi.fn(async () => ({ removed: true })),
    ...overrides,
  };
}

function createStore(gateway: HabitsGateway) {
  const notify = vi.fn();
  const store = createHabitsStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify,
  });
  return { store, notify };
}

describe("habits logic", () => {
  it("builds a contiguous streak", () => {
    const dates = lastDates(4);
    const entries = dates.slice(0, 3).map((date) => ({ habitId: "h1", date, value: 1 }));
    expect(currentStreak(entries, "h1")).toBeGreaterThanOrEqual(2);
  });

  it("formats a stable date key", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("habits store", () => {
  beforeEach(() => setLocale("en"));

  it("loads habits and entries", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().load();
    expect(store.getState().habits).toEqual([HABIT]);
  });

  it("adds a habit and reloads", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().setDraft({ draftName: "  Meditate  ", draftEmoji: "🧘", draftColor: "#c15f9f" });
    await store.getState().addHabit();
    expect(gateway.upsert).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      { name: "  Meditate  ", emoji: "🧘", color: "#c15f9f" },
    );
    expect(notify).toHaveBeenCalledWith("Habit added");
  });

  it("edits an existing habit", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().startEdit(HABIT);
    store.getState().setDraft({ draftName: "Read daily" });
    await store.getState().saveEdit();
    expect(gateway.upsert).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      { id: "h1", name: "Read daily", emoji: "📖", color: "#4f8cff" },
    );
    expect(notify).toHaveBeenCalledWith("Habit updated");
  });

  it("toggles a date and removes a habit", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    await store.getState().toggle("h1", "2026-08-13");
    expect(gateway.toggle).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "h1",
      "2026-08-13",
    );
    await store.getState().remove("h1");
    expect(gateway.remove).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "h1",
    );
    expect(notify).toHaveBeenCalledWith("Habit removed");
  });
});
