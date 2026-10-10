import { create } from "zustand";
import { friendlyPluginError } from "../../shared/hostErrors";
import { t } from "../../shared/i18n";
import type { Habit, HabitEntry } from "./habitsLogic";

export interface HabitsScope {
  sceneId: string;
  workspaceId: string;
}

export interface HabitsGateway {
  list(scope: HabitsScope): Promise<{ habits: Habit[]; entries: HabitEntry[] }>;
  upsert(
    scope: HabitsScope,
    habit: { id?: string; name: string; emoji: string; color: string },
  ): Promise<{ habit: Habit }>;
  toggle(scope: HabitsScope, habitId: string, date: string): Promise<{ entry: HabitEntry | null }>;
  remove(scope: HabitsScope, habitId: string): Promise<{ removed: boolean }>;
}

export class HabitsHttpGateway implements HabitsGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Habits gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async #request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await this.#fetch(new URL(path, this.#location.origin).toString(), {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = await response.json();
        detail = parsed?.error?.message || parsed?.error?.code || "";
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new Error(detail || `habits failed (${response.status})`);
    }
    return response.json();
  }

  async list(scope: HabitsScope): Promise<{ habits: Habit[]; entries: HabitEntry[] }> {
    const url = new URL("/v2/habits", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    url.searchParams.set("workspaceId", scope.workspaceId);
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`habits failed (${response.status})`);
    return response.json() as Promise<{ habits: Habit[]; entries: HabitEntry[] }>;
  }

  upsert(
    scope: HabitsScope,
    habit: { id?: string; name: string; emoji: string; color: string },
  ): Promise<{ habit: Habit }> {
    return this.#request("/v2/habits/upsert", {
      method: "POST",
      body: JSON.stringify({ ...scope, ...habit }),
    }) as Promise<{ habit: Habit }>;
  }

  toggle(scope: HabitsScope, habitId: string, date: string): Promise<{ entry: HabitEntry | null }> {
    return this.#request("/v2/habits/toggle", {
      method: "POST",
      body: JSON.stringify({ ...scope, habitId, date }),
    }) as Promise<{ entry: HabitEntry | null }>;
  }

  remove(scope: HabitsScope, habitId: string): Promise<{ removed: boolean }> {
    return this.#request("/v2/habits/remove", {
      method: "POST",
      body: JSON.stringify({ ...scope, habitId }),
    }) as Promise<{ removed: boolean }>;
  }
}

export interface HabitsState {
  habits: Habit[];
  entries: HabitEntry[];
  busy: boolean;
  error: string;
  draftName: string;
  draftEmoji: string;
  draftColor: string;
  editingId: string | null;
  setDraft(patch: Partial<Pick<HabitsState, "draftName" | "draftEmoji" | "draftColor">>): void;
  load(): Promise<void>;
  resetScope(): void;
  addHabit(): Promise<void>;
  startEdit(habit: Habit): void;
  cancelEdit(): void;
  saveEdit(): Promise<void>;
  toggle(habitId: string, date: string): Promise<void>;
  remove(habitId: string): Promise<void>;
}

export interface HabitsOptions {
  gateway?: HabitsGateway;
  getTarget(): HabitsScope;
  notify(message: string): void;
}

export function createHabitsStore(options: HabitsOptions) {
  const { gateway = new HabitsHttpGateway(), getTarget, notify } = options;
  let loadSeq = 0;
  return create<HabitsState>()((set, get) => ({
    habits: [],
    entries: [],
    busy: false,
    error: "",
    draftName: "",
    draftEmoji: "✅",
    draftColor: "#4f8cff",
    editingId: null,

    setDraft(patch) {
      set({ ...patch, error: "" });
    },

    resetScope() {
      loadSeq += 1;
      set({ habits: [], entries: [], busy: false, error: "", draftName: "", editingId: null });
    },

    async load() {
      const seq = ++loadSeq;
      set({ busy: true, error: "" });
      try {
        const result = await gateway.list(getTarget());
        if (seq !== loadSeq) return;
        set({ habits: result.habits, entries: result.entries, busy: false });
      } catch (error) {
        if (seq !== loadSeq) return;
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async addHabit() {
      const { draftName, draftEmoji, draftColor, busy } = get();
      if (!draftName.trim() || busy) return;
      set({ busy: true, error: "" });
      try {
        await gateway.upsert(getTarget(), {
          name: draftName,
          emoji: draftEmoji,
          color: draftColor,
        });
        set({ draftName: "", busy: false });
        notify(t("Habit added"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    startEdit(habit) {
      set({
        editingId: habit.id,
        draftName: habit.name,
        draftEmoji: habit.emoji,
        draftColor: habit.color,
        error: "",
      });
    },

    cancelEdit() {
      set({ editingId: null, draftName: "", draftEmoji: "✅", draftColor: "#4f8cff" });
    },

    async saveEdit() {
      const { editingId, draftName, draftEmoji, draftColor, busy } = get();
      if (!editingId || !draftName.trim() || busy) return;
      set({ busy: true, error: "" });
      try {
        await gateway.upsert(getTarget(), {
          id: editingId,
          name: draftName,
          emoji: draftEmoji,
          color: draftColor,
        });
        set({ busy: false, editingId: null, draftName: "" });
        notify(t("Habit updated"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async toggle(habitId, date) {
      try {
        await gateway.toggle(getTarget(), habitId, date);
        await get().load();
      } catch (error) {
        set({ error: friendlyPluginError(error) });
      }
    },

    async remove(habitId) {
      set({ busy: true, error: "" });
      try {
        await gateway.remove(getTarget(), habitId);
        set({ busy: false });
        notify(t("Habit removed"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },
  }));
}

export type HabitsStore = ReturnType<typeof createHabitsStore>;
