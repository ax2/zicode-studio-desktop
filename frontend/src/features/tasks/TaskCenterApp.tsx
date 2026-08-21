import type { Root } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n.js";
import { friendlyTaskDispatchError } from "../../shared/hostErrors";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
// @ts-expect-error plain JS module without type declarations
import { copyText } from "../../../../public/ui/copy.js";
// @ts-expect-error plain JS module without type declarations
import { markTaskResumed } from "../../../../public/super-agent/task-state.js";
import {
  filterLabel,
  filteredTasks,
  formatDate,
  isScheduledTemplate,
  nextTaskRunAt,
  retryLimitReached,
  scheduleDescription,
  scheduledTaskStats,
  statusLabel,
  TASK_FILTERS,
  taskProject,
  taskSummaryText,
  type SuperAgentTask,
  type TaskFilter,
} from "./logic";
import {
  createTaskCenterStore,
  type TaskCenterOptions,
  type TaskDraft,
} from "./store";

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
  const setFilter = store((state) => state.setFilter);
  const loading = store((state) => state.loading);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const clearDoneTasks = store((state) => state.clearDoneTasks);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SuperAgentTask | null>(null);
  const visible = filteredTasks(tasks, filter);
  const doneCount = filteredTasks(tasks, "done").length;
  const formTask = editing ?? (creating ? ({} as SuperAgentTask) : null);
  return (
    <div className="task-center-main">
      <header className="task-center-header">
        <div>
          <h1>{t("Task center")}</h1>
          <p>
            {t(
              "Create and schedule tasks here; work from automations and the Agent Inbox lands in the same list. Approve, pause, retry, and reopen results.",
            )}
          </p>
        </div>
        <div className="task-center-header-actions">
          <button
            type="button"
            className="ui-button ui-button--primary"
            disabled={loading || Boolean(formTask)}
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            {t("New task")}
          </button>
          {doneCount > 0 ? (
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              disabled={loading}
              onClick={() => {
                if (
                  globalThis.confirm?.(
                    t("Clear {count} completed tasks?").replace("{count}", String(doneCount)),
                  ) === false
                ) {
                  return;
                }
                void clearDoneTasks();
              }}
            >
              {t("Clear completed")}
            </button>
          ) : null}
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            {t("Refresh")}
          </button>
        </div>
      </header>
      {formTask ? (
        <TaskForm
          store={store}
          task={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
      <FirstRunGuide
        storageKey="tasks"
        title={t("One place for background work")}
        steps={[
          t("Create a one-off or scheduled task, or approve pending work."),
          t("Edit a task's title, instructions, trigger, and schedule."),
          t("Pause, retry, and reopen finished results."),
        ]}
        ctaLabel={t("View tasks")}
        onCta={() => setFilter("all")}
      />
      <TaskSummary store={store} />
      {error ? (
        <StatePanel
          title={t("Could not load tasks")}
          detail={error.message}
          retry={() => void load()}
        />
      ) : visible.length === 0 ? (
        <StatePanel
          title={
            filter === "scheduled"
              ? t("No scheduled tasks")
              : t("No tasks in this view")
          }
          detail={
            filter === "scheduled"
              ? t("Create a scheduled task to run work on a timer.")
              : t("Create a task, or wait for work from automations and the Agent Inbox.")
          }
          actionLabel={t("New task")}
          onAction={() => {
            setCreating(true);
            setEditing(null);
          }}
        />
      ) : (
        <div className="task-center-list">
          {visible.map((task) => (
            <TaskCard
              key={task.id}
              store={store}
              task={task}
              onEdit={() => {
                setEditing(task);
                setCreating(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskSummary({ store }: { store: TaskStore }) {
  const tasks = store((state) => state.tasks);
  const setFilter = store((state) => state.setFilter);
  const cards: Array<[string, number, string, TaskFilter]> = [
    ["Running", filteredTasks(tasks, "running").length, "running", "running"],
    ["Needs input", filteredTasks(tasks, "needs_input").length, "warning", "needs_input"],
    ["Failed", filteredTasks(tasks, "failed").length, "danger", "failed"],
    ["Completed", filteredTasks(tasks, "done").length, "success", "done"],
  ];
  return (
    <div className="task-center-summary">
      {cards.map(([label, count, tone, filter]) => (
        <button
          key={label}
          type="button"
          className={`ui-card task-center-summary-card task-center-summary-card--${tone}`}
          aria-label={`${t(label)}: ${count}`}
          onClick={() => setFilter(filter)}
        >
          <strong>{count}</strong>
          <span>{t(label)}</span>
        </button>
      ))}
    </div>
  );
}

function StatePanel({
  title,
  detail,
  retry,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  retry?: () => void;
  actionLabel?: string;
  onAction?: () => void;
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
      {actionLabel && onAction ? (
        <button type="button" className="ui-button ui-button--primary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

function TaskForm({
  store,
  task,
  onClose,
}: {
  store: TaskStore;
  task?: SuperAgentTask;
  onClose: () => void;
}) {
  const createTask = store((state) => state.createTask);
  const updateTaskMeta = store((state) => state.updateTaskMeta);
  const template = task && isScheduledTemplate(task);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [target, setTarget] = useState(task?.targetProject ?? "");
  const [schedule, setSchedule] = useState<"manual" | "interval" | "daily">(
    template ? (task.schedule as "interval" | "daily") : "manual",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(task?.intervalMinutes ?? 60),
  );
  const [dailyTime, setDailyTime] = useState(task?.dailyTime ?? "09:00");
  const [requireApproval, setRequireApproval] = useState(
    Boolean(task?.requireApproval),
  );
  const [maxRetries, setMaxRetries] = useState(String(task?.maxRetries ?? 2));
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    const draft: TaskDraft = {
      title,
      description,
      targetProject: target,
      schedule,
      intervalMinutes:
        schedule === "interval" ? Math.max(5, Number(intervalMinutes) || 60) : null,
      dailyTime: schedule === "daily" ? dailyTime || "09:00" : null,
      requireApproval,
      maxRetries: Number(maxRetries) || 0,
    };
    setSaving(true);
    try {
      if (task) {
        await updateTaskMeta(task.id, draft);
      } else {
        await createTask(draft);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ui-panel task-center-form" onSubmit={submit}>
      <h2>{task ? t("Edit task") : t("New task")}</h2>
      <label className="task-form-field">
        <span>{t("Title")}</span>
        <input
          className="ui-input"
          required
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="task-form-field">
        <span>{t("Instructions")}</span>
        <textarea
          className="ui-textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="task-form-field">
        <span>{t("Target project")}</span>
        <input
          className="ui-input"
          autoComplete="off"
          placeholder="C:/work/project"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <label className="task-form-field">
        <span>{t("Trigger")}</span>
        <select
          className="ui-input"
          value={schedule}
          onChange={(event) =>
            setSchedule(event.target.value as "manual" | "interval" | "daily")
          }
        >
          <option value="manual">{t("Manual")}</option>
          <option value="interval">{t("Every N minutes")}</option>
          <option value="daily">{t("Daily at")}</option>
        </select>
      </label>
      {schedule === "interval" ? (
        <label className="task-form-field">
          <span>{t("Interval (minutes)")}</span>
          <input
            className="ui-input"
            type="number"
            min={5}
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          />
        </label>
      ) : null}
      {schedule === "daily" ? (
        <label className="task-form-field">
          <span>{t("Run at")}</span>
          <input
            className="ui-input"
            type="time"
            value={dailyTime}
            onChange={(event) => setDailyTime(event.target.value)}
          />
        </label>
      ) : null}
      <label className="task-form-checkbox">
        <input
          type="checkbox"
          checked={requireApproval}
          onChange={(event) => setRequireApproval(event.target.checked)}
        />
        {t("Require approval before every run")}
      </label>
      <label className="task-form-field">
        <span>{t("Maximum retries")}</span>
        <input
          className="ui-input"
          type="number"
          min={0}
          max={10}
          value={maxRetries}
          onChange={(event) => setMaxRetries(event.target.value)}
        />
      </label>
      <div className="task-form-actions">
        <button
          type="button"
          className="ui-button ui-button--ghost"
          onClick={onClose}
        >
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={saving || !title.trim()}
          aria-busy={saving}
        >
          {saving ? t("Saving…") : task ? t("Save changes") : t("Create task")}
        </button>
      </div>
    </form>
  );
}

function TaskCard({
  store,
  task,
  onEdit,
}: {
  store: TaskStore;
  task: SuperAgentTask;
  onEdit: () => void;
}) {
  const updateTask = store((state) => state.updateTask);
  const approveTask = store((state) => state.approveTask);
  const retryAndRunTask = store((state) => state.retryAndRunTask);
  const pauseTask = store((state) => state.pauseTask);
  const cancelTask = store((state) => state.cancelTask);
  const removeTask = store((state) => state.removeTask);
  const answerTask = store((state) => state.answerTask);
  const openApp = store((state) => state.openApp);
  const setFilter = store((state) => state.setFilter);
  const allTasks = store((state) => state.tasks);
  const limitReached = retryLimitReached(task);
  const canRetryAndRun =
    ["failed", "blocked"].includes(task.status) && Boolean(task.targetProject);
  const rerunWorkflowId =
    ["done", "cancelled", "failed"].includes(task.status)
      ? task.automation?.workflowId
      : undefined;
  const retryConfirmText = t(
    "The automatic retry limit has been reached. Retry this task manually?",
  );
  const rawSummary = taskSummaryText(task);
  const summary = friendlyTaskDispatchError(rawSummary);
  const scheduledTemplate = isScheduledTemplate(task);
  const scheduledStats = scheduledTemplate ? scheduledTaskStats(task, allTasks) : null;
  const scheduledInstanceOf = task.scheduledFrom || null;
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const openSession = () => {
    document.dispatchEvent(new CustomEvent("sa-view-session", { detail: task }));
    openApp?.("core.chat");
  };
  return (
    <article className={`ui-panel task-center-card status-${task.status}`}>
      <header>
        <div>
          <span className="task-center-status">
            {scheduledTemplate ? t("Scheduled") : t(statusLabel(task.status))}
          </span>
          <h2>{task.title || t("Untitled task")}</h2>
        </div>
        <div className="task-center-actions">
          {!scheduledTemplate && task.status === "pending" && task.targetProject ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() => void approveTask(task)}
            >
              {t("Approve and run")}
            </button>
          ) : null}
          {task.dispatch?.childSessionId ? (
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={openSession}
            >
              {t("Open session")}
            </button>
          ) : null}
          {canRetryAndRun ? (
            <button
              type="button"
              className={`ui-button ui-button--sm${
                limitReached ? " ui-button--secondary" : " ui-button--primary"
              }`}
              title={limitReached ? retryConfirmText : undefined}
              onClick={() => {
                if (limitReached && globalThis.confirm?.(retryConfirmText) === false) {
                  return;
                }
                void retryAndRunTask(task);
              }}
            >
              {t("Retry and run")}
            </button>
          ) : ["failed", "blocked", "needs_input"].includes(task.status) ? (
            <button
              type="button"
              className={`ui-button ui-button--sm${
                task.status === "needs_input" || limitReached
                  ? " ui-button--secondary"
                  : " ui-button--primary"
              }`}
              title={limitReached ? retryConfirmText : undefined}
              onClick={() => {
                if (
                  limitReached &&
                  globalThis.confirm?.(retryConfirmText) === false
                ) {
                  return;
                }
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
                );
              }}
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
          {!scheduledTemplate &&
          ["pending", "running", "needs_input", "blocked"].includes(task.status) ? (
            <button
              type="button"
              className="ui-button ui-button--danger ui-button--sm"
              onClick={() => void cancelTask(task)}
            >
              {t("Cancel")}
            </button>
          ) : null}
          {!scheduledTemplate &&
          !["running", "needs_input", "blocked"].includes(task.status) ? (
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={onEdit}
            >
              {t("Edit")}
            </button>
          ) : null}
          {scheduledTemplate ? (
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={onEdit}
            >
              {t("Edit")}
            </button>
          ) : null}
          {scheduledInstanceOf ? (
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              title={t("Open the scheduled task this instance came from")}
              onClick={() => setFilter("scheduled")}
            >
              {t("View scheduled task")}
            </button>
          ) : null}
          {scheduledTemplate ? (
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() =>
                void updateTask(
                  task.id,
                  (current) => ({ ...current, enabled: !current.enabled }),
                  task.enabled === false ? t("Scheduled task enabled") : t("Scheduled task paused"),
                )
              }
            >
              {task.enabled === false ? t("Enable") : t("Pause schedule")}
            </button>
          ) : null}
          {scheduledTemplate ? (
            <button
              type="button"
              className="ui-button ui-button--danger ui-button--sm"
              title={t("Delete this scheduled task")}
              onClick={() => {
                if (
                  globalThis.confirm?.(
                    t("Delete the scheduled task “{title}”?").replace(
                      "{title}",
                      task.title || t("Untitled task"),
                    ),
                  ) === false
                ) {
                  return;
                }
                void removeTask(task.id);
              }}
            >
              {t("Delete")}
            </button>
          ) : null}
          {["done", "failed", "cancelled"].includes(task.status) ? (
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              title={t("Remove this task from the list")}
              onClick={() => void removeTask(task.id)}
            >
              {t("Dismiss")}
            </button>
          ) : null}
          {rerunWorkflowId ? (
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              title={t("Queue a fresh run of the owning automation workflow")}
              onClick={() => {
                document.dispatchEvent(
                  new CustomEvent("sa-rerun-workflow", {
                    detail: { workflowId: rerunWorkflowId },
                    bubbles: true,
                  }),
                );
              }}
            >
              {t("Run again")}
            </button>
          ) : null}
        </div>
      </header>
      {task.description ? (
        <>
          <p
            className={`task-center-description${descriptionExpanded ? " expanded" : ""}`}
            title={task.description}
          >
            {task.description}
          </p>
          {task.description.length > 180 ? (
            <button
              type="button"
              className="task-center-description-toggle"
              onClick={() => setDescriptionExpanded((value) => !value)}
            >
              {descriptionExpanded ? t("Show less") : t("Show more")}
            </button>
          ) : null}
        </>
      ) : null}
      {["needs_input", "blocked"].includes(task.status) &&
      task.dispatch?.childSessionId ? (
        <div className="task-center-reply">
          <textarea
            className="task-center-reply-input"
            rows={2}
            value={reply}
            aria-label={t("Answer the agent's question")}
            placeholder={t("Answer the agent's question")}
            onChange={(event) => setReply(event.target.value)}
          />
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            disabled={!reply.trim()}
            onClick={() => {
              void answerTask(task, reply);
              setReply("");
            }}
          >
            {t("Send answer")}
          </button>
        </div>
      ) : null}
      <dl>
        <Detail term={t("Project")} value={taskProject(task)} />
        {scheduledTemplate ? (
          <>
            <Detail term={t("Schedule")} value={scheduleDescription(task)} />
            <Detail
              term={t("Next run")}
              value={formatDate(task.nextRunAt || nextTaskRunAt(task))}
            />
            <Detail term={t("Runs")} value={String(scheduledStats?.runCount ?? 0)} />
            <Detail
              term={t("Last run")}
              value={formatDate(scheduledStats?.lastRunAt ?? null)}
            />
          </>
        ) : null}
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
      {summary ? (
        <div className="task-center-result-row">
          <p
            className="task-center-result"
            title={rawSummary !== summary ? rawSummary : undefined}
          >
            {summary}
          </p>
          <button
            type="button"
            className="task-center-result-copy"
            aria-label={t("Copy")}
            title={t("Copy")}
            onClick={() => {
              void copyText(rawSummary);
              setCopied(true);
              if (copyTimer.current) clearTimeout(copyTimer.current);
              copyTimer.current = setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? t("Copied") : "⧉"}
          </button>
        </div>
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
                <span
                  title={
                    event.message &&
                    friendlyTaskDispatchError(event.message) !== event.message
                      ? event.message
                      : undefined
                  }
                >
                  {friendlyTaskDispatchError(
                    t(event.message || (event.status ? statusLabel(event.status) : "event")),
                  )}
                </span>
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
      <dd title={value || undefined}>{value || "—"}</dd>
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
      navRoot = mountPluginSurface(container, <TaskNav store={store} />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(
        container,
        <TaskMain store={store} />,
        contentRoot,
      );
      store.getState().startPolling();
      store.getState().startScheduler();
    },
    deactivate() {
      store.getState().stopPolling();
      store.getState().stopScheduler();
    },
    destroy() {
      store.getState().destroy();
      store.getState().stopScheduler();
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
