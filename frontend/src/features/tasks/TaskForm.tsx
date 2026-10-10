import { useEffect, useState } from "react";
import { t } from "../../shared/i18n.js";
import type { SuperAgentTask } from "./logic";
import type { createTaskCenterStore, TaskDraft } from "./store";

type TaskStore = ReturnType<typeof createTaskCenterStore>;

export function TaskForm({
  store,
  task,
  initialProject,
  onClose,
}: {
  store: TaskStore;
  task?: SuperAgentTask;
  initialProject?: string;
  onClose: () => void;
}) {
  const createTask = store((state) => state.createTask);
  const updateTaskMeta = store((state) => state.updateTaskMeta);
  const listProjects = store((state) => state.listProjects);
  const template = task?.schedule && task.schedule !== "manual";
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [target, setTarget] = useState(
    task?.targetProject ?? initialProject ?? store.getState().getCurrentProjectPath() ?? "",
  );
  const [schedule, setSchedule] = useState<"manual" | "interval" | "daily">(
    template ? (task.schedule as "interval" | "daily") : "manual",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(String(task?.intervalMinutes ?? 60));
  const [dailyTime, setDailyTime] = useState(task?.dailyTime ?? "09:00");
  const [requireApproval, setRequireApproval] = useState(Boolean(task?.requireApproval));
  const [maxRetries, setMaxRetries] = useState(String(task?.maxRetries ?? 2));
  const [saving, setSaving] = useState(false);
  const [projectPaths, setProjectPaths] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listProjects().then((paths) => {
      if (!cancelled) setProjectPaths(paths);
    });
    return () => {
      cancelled = true;
    };
  }, [listProjects]);

  const save = async (saveAsDraft: boolean) => {
    if (!title.trim() || saving) return;
    const draft: TaskDraft = {
      saveAsDraft,
      title,
      description,
      targetProject: target,
      schedule,
      intervalMinutes: schedule === "interval" ? Math.max(5, Number(intervalMinutes) || 60) : null,
      dailyTime: schedule === "daily" ? dailyTime || "09:00" : null,
      requireApproval,
      maxRetries: Number(maxRetries) || 0,
    };
    setSaving(true);
    try {
      if (task) {
        if (!(await updateTaskMeta(task.id, draft))) return;
      } else {
        if (!(await createTask(draft))) return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="ui-panel task-center-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <h2>{task ? t("Edit task") : t("New task")}</h2>
      {(!task || task.status === "draft") && (
        <p role="note">
          {t("Save a draft to continue later. Drafts do not run until you activate them.")}
        </p>
      )}
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
          list="task-project-paths"
          placeholder="C:/work/project"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
        <datalist id="task-project-paths">
          {projectPaths.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      </label>
      {schedule === "manual" && !target.trim() ? (
        <p className="task-form-hint" role="note">
          {t("Manual tasks need a target project before they can be run.")}
        </p>
      ) : null}
      <label className="task-form-field">
        <span>{t("Trigger")}</span>
        <select
          className="ui-input"
          value={schedule}
          onChange={(event) => setSchedule(event.target.value as "manual" | "interval" | "daily")}
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
      <fieldset className="task-form-mode">
        <legend>{t("Execution mode")}</legend>
        <label className="task-form-radio">
          <input
            type="radio"
            name="task-execution-mode"
            checked={!requireApproval}
            onChange={() => setRequireApproval(false)}
          />
          {t("Run automatically (full access)")}
        </label>
        <label className="task-form-radio">
          <input
            type="radio"
            name="task-execution-mode"
            checked={requireApproval}
            onChange={() => setRequireApproval(true)}
          />
          {t("Confirm before every run (default permission)")}
        </label>
      </fieldset>
      <p className="automation-checkbox-hint" role="note">
        {requireApproval
          ? t(
              "Each run waits for your approval in the task center. Sensitive actions — writes outside the workspace, deletions, scripts, and network access — still ask for confirmation before executing.",
            )
          : t(
              "Runs automatically; no manual approval needed. File writes, deletions, scripts, and network actions will not ask for confirmation one by one, so keep this for trusted, recoverable tasks.",
            )}
      </p>
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
        {(!task || task.status === "draft") && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={saving || !title.trim()}
            onClick={() => void save(true)}
          >
            {t("Save draft")}
          </button>
        )}
        <button
          type="button"
          className="ui-button ui-button--ghost"
          onClick={onClose}
          disabled={saving}
        >
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={saving || !title.trim()}
          aria-busy={saving}
        >
          {saving
            ? t("Saving…")
            : task?.status === "draft"
              ? t("Activate task")
              : task
                ? t("Save changes")
                : t("Create task")}
        </button>
      </div>
    </form>
  );
}
