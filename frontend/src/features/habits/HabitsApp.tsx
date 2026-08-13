import { useEffect, useMemo } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { currentStreak, lastDates } from "./habitsLogic";
import { createHabitsStore, type HabitsOptions, type HabitsStore } from "./habitsStore";

export type HabitsAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

const EMOJIS = ["✅", "📖", "🏃", "🧘", "💧", "🥗", "💪", "🎯", "😴", "✍️", "🎨", "🧹"];
const COLORS = ["#4f8cff", "#2bb673", "#e0a63f", "#c15f9f", "#8a63d2", "#ef6a6a"];

function HabitsNav() {
  return <nav className="habits-nav" aria-label={t("Habits")} />;
}

function HabitsMain({ store }: { store: HabitsStore }) {
  const habits = store((state) => state.habits);
  const entries = store((state) => state.entries);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const draftName = store((state) => state.draftName);
  const draftEmoji = store((state) => state.draftEmoji);
  const draftColor = store((state) => state.draftColor);
  const editingId = store((state) => state.editingId);

  useEffect(() => {
    void store.getState().load();
  }, [store]);

  const dates = useMemo(() => lastDates(7), []);
  const done = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const entry of entries) {
      const set = map.get(entry.habitId) ?? new Set<string>();
      set.add(entry.date);
      map.set(entry.habitId, set);
    }
    return map;
  }, [entries]);

  return (
    <div className="habits-main">
      <header className="habits-header">
        <h1>{t("Habit Tracker")}</h1>
        <p>{t("Track your daily habits and keep a streak.")}</p>
      </header>

      <section className="ui-card habits-composer">
        <div className="habits-composer-row">
          <input
            className="habits-name-input"
            value={draftName}
            placeholder={t("Habit name")}
            onChange={(event) => store.getState().setDraft({ draftName: event.target.value })}
          />
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            disabled={busy || !draftName.trim()}
            onClick={() => void store.getState().addHabit()}
          >
            {t("Add habit")}
          </button>
        </div>
        <div className="habits-pickers">
          <div className="habits-picker" role="radiogroup" aria-label={t("Habit emoji")}>
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={`habits-emoji${draftEmoji === emoji ? " is-active" : ""}`}
                aria-pressed={draftEmoji === emoji}
                onClick={() => store.getState().setDraft({ draftEmoji: emoji })}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="habits-picker" role="radiogroup" aria-label={t("Habit color")}>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`habits-color${draftColor === color ? " is-active" : ""}`}
                aria-pressed={draftColor === color}
                style={{ background: color }}
                onClick={() => store.getState().setDraft({ draftColor: color })}
              />
            ))}
          </div>
        </div>
        {error ? (
          <p className="idphoto-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="ui-card habits-list">
        {habits.length > 0 ? (
          <ul className="habits-items">
            {habits.map((habit) => {
              const streak = currentStreak(entries, habit.id);
              const habitDates = done.get(habit.id) ?? new Set<string>();
              const editing = editingId === habit.id;
              return (
                <li key={habit.id} className="habits-item">
                  {editing ? (
                    <div className="habits-edit">
                      <input
                        className="habits-name-input"
                        value={draftName}
                        aria-label={t("Habit name")}
                        onChange={(event) =>
                          store.getState().setDraft({ draftName: event.target.value })
                        }
                      />
                      <div className="habits-picker" role="radiogroup" aria-label={t("Habit emoji")}>
                        {EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className={`habits-emoji${draftEmoji === emoji ? " is-active" : ""}`}
                            aria-pressed={draftEmoji === emoji}
                            onClick={() => store.getState().setDraft({ draftEmoji: emoji })}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      <div className="habits-picker" role="radiogroup" aria-label={t("Habit color")}>
                        {COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`habits-color${draftColor === color ? " is-active" : ""}`}
                            aria-pressed={draftColor === color}
                            style={{ background: color }}
                            onClick={() => store.getState().setDraft({ draftColor: color })}
                          />
                        ))}
                      </div>
                      <div className="habits-edit-actions">
                        <button
                          type="button"
                          className="ui-button ui-button--primary ui-button--sm"
                          disabled={busy || !draftName.trim()}
                          onClick={() => void store.getState().saveEdit()}
                        >
                          {t("Save")}
                        </button>
                        <button
                          type="button"
                          className="ui-button ui-button--ghost ui-button--sm"
                          onClick={() => store.getState().cancelEdit()}
                        >
                          {t("Cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="habits-item-head">
                      <span className="habits-item-icon" style={{ background: habit.color }}>
                        {habit.emoji}
                      </span>
                      <span className="habits-item-name">{habit.name}</span>
                      <span className="habits-item-streak">
                        {streak} {t("day streak")}
                      </span>
                      <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm"
                        onClick={() => store.getState().startEdit(habit)}
                      >
                        {t("Edit")}
                      </button>
                      <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm habits-delete"
                        onClick={() => {
                          if (globalThis.confirm?.(t("Delete this habit and its history? This cannot be undone."))) {
                            void store.getState().remove(habit.id);
                          }
                        }}
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  )}
                  <div className="habits-grid">
                    {dates.map((date, index) => {
                      const checked = habitDates.has(date);
                      const isToday = index === 0;
                      return (
                        <button
                          key={date}
                          type="button"
                          className={`habits-day${checked ? " is-done" : ""}${isToday ? " is-today" : ""}`}
                          aria-label={date}
                          title={date}
                          style={checked ? { background: habit.color } : undefined}
                          onClick={() => void store.getState().toggle(habit.id, date)}
                        />
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="idphoto-result-empty">{t("No habits yet")}</p>
        )}
      </section>
    </div>
  );
}

export function createHabitsApp(options: HabitsOptions): HabitsAppApi {
  const store = createHabitsStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <HabitsNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <HabitsMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "habits.open";
    },
    executeCommand() {},
    refresh() {
      return store.getState().load();
    },
  };
}
