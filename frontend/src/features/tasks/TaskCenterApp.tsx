import { createRoot, type Root } from "react-dom/client";
import { t } from "../../shared/i18n.js";
// @ts-expect-error plain JS module without type declarations
import { markTaskResumed } from "../../../../public/super-agent/task-state.js";
import {
  filterLabel,
  filteredTasks,
  formatDate,
  retryLimitReached,
  statusLabel,
  TASK_FILTERS,
  taskProject,
  taskSummaryText,
  type SuperAgentTask,
} from "./logic";
import { createTaskCenterStore, type TaskCenterOptions } from "./store";

type TaskStore = ReturnType<typeof createTaskCenterStore>;

export function TaskNav({ store }: { store: TaskStore }) {
  const tasks = store((state) => state.tasks);
  const filter = store((state) => state.filter);
  const setFilter = store((state) => state.setFilter);
  return (
    <nav className="task-center-navigation" aria-label={t("Task filters")}>
      {TASK_FILTERS.map((id) => {
        const count = filteredTasks(tasks, id).length;
        return (
          <button
            key={id}
            type="button"
            className={`task-center-filter${filter === id ? " active" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(filterLabel(id))}
            <span className="task-center-filter-count">{count}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function TaskMain({ store }: { store: TaskStore }) {
  const tasks = store((state) => state.tasks);
  const filter = store((state) => state.filter);
  const loading = store((state) => state.loading);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const visible = filteredTasks(tasks, filter);
  return (
    <div className="task-center-main">
      <header className="task-center-header">
        <div>
          <h1>{t("Task center")}</h1>
          <p>{t("Monitor background work, recover failures, and return to results.")}</p>
        </div>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("Refresh")}
        </button>
      </header>
      <TaskSummary store={store} />
      {error ? (
        <StatePanel
          title={t("Could not load tasks")}
          detail={error.message}
          retry={() => void load()}
        />
      ) : visible.length === 0 ? (
        <StatePanel
          title={t("No tasks in this view")}
          detail={t("Background and delegated work will appear here automatically.")}
        />
      ) : (
        <div className="task-center-list">
          {visible.map((task) => (
            <TaskCard key={task.id} store={store} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskSummary({ store }: { store: TaskStore }) {
  const tasks = store((state) => state.tasks);
  const cards: Array<[string, number, string]> = [
    ["Running", filteredTasks(tasks, "running").length, "running"],
    ["Needs input", filteredTasks(tasks, "needs_input").length, "warning"],
    ["Failed", filteredTasks(tasks, "failed").length, "danger"],
    ["Completed", filteredTasks(tasks, "done").length, "success"],
  ];
  return (
    <div className="task-center-summary">
      {cards.map(([label, count, tone]) => (
        <article
          key={label}
          className={`ui-card task-center-summary-card task-center-summary-card--${tone}`}
        >
          <strong>{count}</strong>
          <span>{t(label)}</span>
        </article>
      ))}
    </div>
  );
}

function StatePanel({
  title,
  detail,
  retry,
}: {
  title: string;
  detail: string;
  retry?: () => void;
}) {
  return (
    <section className="ui-panel task-center-state">
      <h2>{title}</h2>
      <p>{detail}</p>
      {retry ? (
        <button type="button" className="ui-button ui-button--primary" onClick={retry}>
          {t("Retry")}
        </button>
      ) : null}
    </section>
  );
}

function TaskCard({ store, task }: { store: TaskStore; task: SuperAgentTask }) {
  const updateTask = store((state) => state.updateTask);
  const pauseTask = store((state) => state.pauseTask);
  const cancelTask = store((state) => state.cancelTask);
  const openApp = store((state) => state.openApp);
  const limitReached = retryLimitReached(task);
  const openSession = () => {
    document.dispatchEvent(new CustomEvent("sa-view-session", { detail: task }));
    openApp?.("core.chat");
  };
  return (
    <article className={`ui-panel task-center-card status-${task.status}`}>
      <header>
        <div>
          <span className="task-center-status">{t(statusLabel(task.status))}</span>
          <h2>{task.title || t("Untitled task")}</h2>
        </div>
        <div className="task-center-actions">
          {task.dispatch?.childSessionId ? (
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={openSession}
            >
              {t("Open session")}
            </button>
          ) : null}
          {["failed", "blocked", "needs_input"].includes(task.status) && !limitReached ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() =>
                void updateTask(
                  task.id,
                  (current) => ({
                    ...current,
                    status: "pending",
                    retryCount: Number(current.retryCount || 0) + 1,
                    result: { status: null, summary: null, completedAt: null, failReason: null },
                    failReason: null,
                  }),
                  t("Task returned to pending"),
                )
              }
            >
              {t("Retry")}
            </button>
          ) : null}
          {task.status === "paused" ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() =>
                void updateTask(task.id, (current) => markTaskResumed(current), t("Task resumed"))
              }
            >
              {t("Resume")}
            </button>
          ) : null}
          {task.status === "running" ? (
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => void pauseTask(task)}
            >
              {t("Pause")}
            </button>
          ) : null}
          {["pending", "running", "needs_input", "blocked"].includes(task.status) ? (
            <button
              type="button"
              className="ui-button ui-button--danger ui-button--sm"
              onClick={() => void cancelTask(task)}
            >
              {t("Cancel")}
            </button>
          ) : null}
        </div>
      </header>
      {task.description ? <p className="task-center-description">{task.description}</p> : null}
      <dl>
        <Detail term={t("Project")} value={taskProject(task)} />
        <Detail term={t("Started")} value={formatDate(task.dispatch?.startedAt)} />
        <Detail
          term={t("Updated")}
          value={formatDate(task.events?.at(-1)?.at || task.result?.completedAt)}
        />
        {task.budget ? <Detail term={t("Budget")} value={`$${Number(task.budget).toFixed(2)}`} /> : null}
        {task.maxRetries != null ? (
          <Detail
            term={t("Retries")}
            value={`${Number(task.retryCount || 0)} / ${Number(task.maxRetries)}`}
          />
        ) : null}
      </dl>
      {limitReached ? <p className="task-center-result">{t("Retry limit reached")}</p> : null}
      {taskSummaryText(task) ? (
        <p className="task-center-result">{taskSummaryText(task)}</p>
      ) : null}
      {task.events?.length ? (
        <details className="task-center-history">
          <summary>
            {t("History")} ({task.events.length})
          </summary>
          <ol>
            {[...task.events].reverse().slice(0, 12).map((event) => (
              <li key={event.at ?? `${event.status}-${event.message}`}>
                <time>{formatDate(event.at)}</time>
                <span>{event.message || event.status}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value || "—"}</dd>
    </>
  );
}

export interface TaskCenterAppApi {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  setTarget(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
}

export function createTaskCenterApp(options: TaskCenterOptions): TaskCenterAppApi {
  const store = createTaskCenterStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot ??= createRoot(container);
      navRoot.render(<TaskNav store={store} />);
    },
    renderContent(container) {
      contentRoot ??= createRoot(container);
      contentRoot.render(<TaskMain store={store} />);
      store.getState().startPolling();
    },
    deactivate() {
      store.getState().stopPolling();
    },
    destroy() {
      store.getState().destroy();
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    setTarget() {},
    handlesCommand(commandId) {
      return commandId === "tasks.open";
    },
    executeCommand() {
      options.openApp?.("com.zicode.tasks");
    },
    refresh() {
      return store.getState().load();
    },
  };
}
