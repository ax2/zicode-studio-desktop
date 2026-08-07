import { useLayoutEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  selectDisplayTasks,
  shouldShowIds,
  STATUS_GLYPHS,
  STATUS_LABELS,
  type RpivTodoTask,
} from "./rpivTodoLogic";

export interface RpivTodoStore {
  tasks: RpivTodoTask[];
  expanded: boolean;
  toggleExpanded(): void;
}

export type RpivTodoStoreHook = UseBoundStore<StoreApi<RpivTodoStore>>;

export function RpivTodoMirrorPanelBridge({
  store,
  listId,
}: {
  store: RpivTodoStoreHook;
  listId: string;
}) {
  const tasks = store((state) => state.tasks);
  const expanded = store((state) => state.expanded);
  return (
    <RpivTodoMirrorApp
      tasks={tasks}
      expanded={expanded}
      listId={listId}
      onToggle={() => store.getState().toggleExpanded()}
    />
  );
}

function useLocaleVersion(): number {
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    const handler = () => {
      setVersion((value) => value + 1);
    };
    window.addEventListener("zicode:locale-changed", handler);
    return () => window.removeEventListener("zicode:locale-changed", handler);
  }, []);
  return version;
}

function TodoTask({
  task,
  showId,
}: {
  task: RpivTodoTask;
  showId: boolean;
}) {
  const status = t(STATUS_LABELS[task.status] ?? task.status);
  return (
    <li
      className={`rpiv-todo-panel__task is-${task.status.replace("_", "-")}`}
      title={status}
      aria-label={`${task.subject}, ${status}`}
    >
      <span className="rpiv-todo-panel__glyph" aria-hidden="true">
        {STATUS_GLYPHS[task.status] ?? "•"}
      </span>
      <span className="rpiv-todo-panel__text">
        {showId ? `#${task.id} ` : ""}
        {task.subject}
      </span>
      {task.status === "in_progress" && task.activeForm ? (
        <span className="rpiv-todo-panel__meta">({task.activeForm})</span>
      ) : null}
      {Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? (
        <span className="rpiv-todo-panel__meta">
          ⛓ {task.blockedBy.map((id) => `#${id}`).join(",")}
        </span>
      ) : null}
    </li>
  );
}

export function RpivTodoMirrorApp({
  tasks,
  expanded,
  listId,
  onToggle,
}: {
  tasks: RpivTodoTask[];
  expanded: boolean;
  listId: string;
  onToggle(): void;
}) {
  useLocaleVersion();
  const visibleTasks = tasks.filter((task) => task.status !== "deleted");
  const completed = visibleTasks.filter((task) => task.status === "completed").length;
  const total = visibleTasks.length;
  const hasActive = visibleTasks.some(
    (task) => task.status === "pending" || task.status === "in_progress",
  );
  const action = t(expanded ? "Hide task details" : "Show task details");
  const displayTasks = selectDisplayTasks(visibleTasks);
  const showId = shouldShowIds(visibleTasks);

  const sectionClass = [
    "rpiv-todo-panel",
    total === 0 ? "hidden" : "",
    expanded ? "is-expanded" : "is-collapsed",
    !hasActive ? "is-complete" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={sectionClass}
      aria-label={t("Pi task progress")}
    >
      <button
        type="button"
        className="rpiv-todo-panel__header"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={t("{action}. {completed}/{total} complete")
          .replace("{action}", action)
          .replace("{completed}", String(completed))
          .replace("{total}", String(total))}
        title={action}
        onClick={onToggle}
      >
        <div className="rpiv-todo-panel__titleGroup">
          <span className={`rpiv-todo-panel__dot ${hasActive ? "is-active" : ""}`}>
            {hasActive ? "●" : "○"}
          </span>
          <span className="rpiv-todo-panel__title">{t("Tasks")}</span>
        </div>
        <span className="rpiv-todo-panel__summary">
          {completed}/{total}
        </span>
        <span className="rpiv-todo-panel__indicator" aria-hidden="true">
          {expanded ? "⌃" : "⌄"}
        </span>
      </button>
      <ol
        className="rpiv-todo-panel__list"
        id={listId}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        {displayTasks.map((task) => (
          <TodoTask task={task} showId={showId} key={task.id} />
        ))}
      </ol>
      {visibleTasks.length > displayTasks.length ? (
        <div className="rpiv-todo-panel__more" aria-hidden={!expanded} inert={!expanded}>
          {t("More tasks: {count}").replace(
            "{count}",
            String(visibleTasks.length - displayTasks.length),
          )}
        </div>
      ) : null}
    </section>
  );
}
