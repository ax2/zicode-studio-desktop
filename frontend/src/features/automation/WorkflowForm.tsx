import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { randomId } from "../../../../public/native/utils/random-id.js";
import { t } from "../../shared/i18n.js";
import { Select } from "../../shared/Select";
import { automationDraftScope, type DraftSelection } from "./draft-store";
import { type AutomationSchedule, type AutomationWorkflow, nextAutomationRun } from "./logic";
import type { createAutomationStore } from "./store";
import { AUTOMATION_TEMPLATES } from "./templates";

type AutomationStore = ReturnType<typeof createAutomationStore>;

export function WorkflowForm({
  store,
  initial,
  initialProject,
  draftSelection,
  onDone,
}: {
  store: AutomationStore;
  initial?: AutomationWorkflow;
  initialProject?: string;
  draftSelection?: DraftSelection;
  onDone?: () => void;
}) {
  const draftStore = store((state) => state.draftStore);
  const draftState = draftStore();
  const [selection, setSelection] = useState(draftSelection);
  const [draftSaved, setDraftSaved] = useState(false);
  const [origin] = useState(() => automationDraftScope(store.getState().getTarget()));
  const [epoch] = useState(() => draftStore.getState().epoch);
  const [newWorkflowId] = useState(() => `automation-${randomId()}`);
  const isCurrent = () =>
    epoch === draftStore.getState().epoch &&
    origin === automationDraftScope(store.getState().getTarget());
  const source = draftSelection?.draft ?? initial;
  const saveWorkflow = store((state) => state.saveWorkflow);
  const notify = store((state) => state.notify);
  const getTarget = store((state) => state.getTarget);
  const listProjects = store((state) => state.listProjects);
  const [title, setTitle] = useState(source?.title ?? "");
  const [targetProject, setTargetProject] = useState(
    source?.targetProject ?? initialProject ?? getTarget()?.cwd ?? "",
  );
  const [prompt, setPrompt] = useState(source?.prompt ?? "");
  const [schedule, setSchedule] = useState(source?.schedule ?? "manual");
  const [intervalMinutes, setIntervalMinutes] = useState(String(source?.intervalMinutes ?? 60));
  const [dailyTime, setDailyTime] = useState(source?.dailyTime ?? "09:00");
  // Scheduled tasks should run automatically out of the box; approval is an
  // opt-in guard for workflows that must wait for a human before dispatching.
  const [requireApproval, setRequireApproval] = useState(Boolean(source?.requireApproval));
  const [maxCost, setMaxCost] = useState(source?.maxCost != null ? String(source.maxCost) : "");
  const [maxRetries, setMaxRetries] = useState(String(source?.maxRetries ?? 2));
  const [submitting, setSubmitting] = useState(false);
  const [projectPaths, setProjectPaths] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listProjects().then((paths) => {
      if (!cancelled) setProjectPaths(paths);
    });
    return () => {
      cancelled = true;
    };
  }, [listProjects]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCurrent() || submitting || draftStore.getState().saving) return;
    if (!title.trim() || !prompt.trim()) {
      notify({
        title: t("Enter a name and task instructions before creating an automation."),
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    try {
      const workflow: AutomationWorkflow = {
        ...initial,
        id: initial?.id ?? newWorkflowId,
        title,
        targetProject,
        prompt,
        schedule: schedule as AutomationWorkflow["schedule"],
        intervalMinutes:
          schedule === "interval" ? Math.max(5, Number(intervalMinutes) || 60) : null,
        dailyTime: schedule === "daily" ? dailyTime || "09:00" : null,
        requireApproval,
        maxCost: maxCost ? Number(maxCost) : null,
        maxRetries: Number(maxRetries || 0),
        enabled: initial?.enabled ?? true,
      };
      workflow.nextRunAt = nextAutomationRun(workflow);
      await saveWorkflow(workflow);
      if (!isCurrent()) return;
      setTitle("");
      setTargetProject(getTarget()?.cwd ?? "");
      setPrompt("");
      setSchedule("manual");
      setIntervalMinutes("60");
      setDailyTime("09:00");
      setRequireApproval(true);
      setMaxCost("");
      setMaxRetries("2");
      notify({
        title: initial ? t("Automation updated") : t("Automation created"),
        type: "success",
      });
      onDone?.();
    } catch (reason) {
      if (!isCurrent()) return;
      notify({
        title: t("Could not save automation"),
        message: reason instanceof Error ? reason.message : String(reason),
        type: "error",
      });
    } finally {
      if (isCurrent()) setSubmitting(false);
    }
  }

  async function saveDraft() {
    if (!isCurrent()) return;
    setDraftSaved(false);
    const saved = await draftStore
      .getState()
      .save(
        {
          title,
          prompt,
          targetProject,
          schedule,
          intervalMinutes,
          dailyTime,
          requireApproval,
          maxCost,
          maxRetries,
        },
        selection,
      );
    if (saved && isCurrent()) {
      setSelection(saved);
      setDraftSaved(true);
    }
  }

  return (
    <form
      className="ui-panel automation-form"
      onSubmit={handleSubmit}
      onChange={() => setDraftSaved(false)}
    >
      <h2>{initial ? t("Edit automation") : t("New automation")}</h2>
      {!initial ? (
        <div className="automation-templates">
          <div className="automation-templates-heading">
            <span>{t("Start from a template")}</span>
            {templateId ? (
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => {
                  setTemplateId(null);
                  setTitle("");
                  setPrompt("");
                  setSchedule("manual");
                  setIntervalMinutes("60");
                  setDailyTime("09:00");
                }}
              >
                {t("Use custom")}
              </button>
            ) : null}
          </div>
          <div className="automation-template-grid">
            {AUTOMATION_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`automation-template-card${
                  templateId === template.id ? " is-active" : ""
                }`}
                aria-pressed={templateId === template.id}
                onClick={() => {
                  setTemplateId(template.id);
                  setTitle(t(template.titleKey));
                  setPrompt(template.prompt);
                  setSchedule(template.schedule);
                  setIntervalMinutes(String(template.intervalMinutes ?? 60));
                  setDailyTime(template.dailyTime ?? "09:00");
                }}
              >
                <strong>{t(template.titleKey)}</strong>
                <span>{t(template.descriptionKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <LabeledField label={t("Name")} htmlFor="automation-name">
        <input
          id="automation-name"
          className="ui-input"
          type="text"
          placeholder={t("Name")}
          required
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </LabeledField>
      <LabeledField label={t("Target project")} htmlFor="automation-target">
        <input
          id="automation-target"
          className="ui-input"
          type="text"
          list="automation-project-paths"
          placeholder={t("Target project")}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={targetProject}
          onChange={(e) => setTargetProject(e.target.value)}
        />
        <datalist id="automation-project-paths">
          {projectPaths.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      </LabeledField>
      <LabeledField label={t("Task instructions")} htmlFor="automation-prompt">
        <textarea
          id="automation-prompt"
          className="ui-textarea"
          rows={4}
          placeholder={t("Task instructions")}
          required
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </LabeledField>
      <LabeledField label={t("Schedule")} htmlFor="automation-schedule">
        <Select
          id="automation-schedule"
          value={schedule}
          label={t("Schedule")}
          options={[
            { value: "manual", label: t("Manual") },
            { value: "interval", label: t("By interval") },
            { value: "daily", label: t("Daily") },
          ]}
          onChange={(value) => setSchedule(value as AutomationSchedule)}
        />
      </LabeledField>
      {schedule === "interval" ? (
        <LabeledField label={t("Interval (minutes)")} htmlFor="automation-interval-minutes">
          <input
            id="automation-interval-minutes"
            className="ui-input"
            type="number"
            min={5}
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          />
        </LabeledField>
      ) : null}
      {schedule === "daily" ? (
        <LabeledField label={t("Run at")} htmlFor="automation-daily-time">
          <input
            id="automation-daily-time"
            className="ui-input"
            type="time"
            value={dailyTime}
            onChange={(event) => setDailyTime(event.target.value)}
          />
        </LabeledField>
      ) : null}
      <div className="automation-form-limits">
        <LabeledField label={t("Maximum cost per run")} htmlFor="automation-max-cost">
          <input
            id="automation-max-cost"
            className="ui-input"
            type="number"
            min="0"
            step="0.01"
            value={maxCost}
            onChange={(e) => setMaxCost(e.target.value)}
          />
        </LabeledField>
        <LabeledField label={t("Maximum retries")} htmlFor="automation-max-retries">
          <input
            id="automation-max-retries"
            className="ui-input"
            type="number"
            min="0"
            max="10"
            value={maxRetries}
            onChange={(e) => setMaxRetries(e.target.value)}
          />
        </LabeledField>
      </div>
      <fieldset className="automation-checkbox">
        <legend>{t("Execution mode")}</legend>
        <label className="automation-radio">
          <input
            type="radio"
            name="automation-execution-mode"
            checked={!requireApproval}
            onChange={() => setRequireApproval(false)}
          />
          {t("Run automatically (full access)")}
        </label>
        <label className="automation-radio">
          <input
            type="radio"
            name="automation-execution-mode"
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
              "Runs automatically when due; no manual approval needed. File writes, deletions, scripts, and network actions will not ask for confirmation one by one, so keep this for trusted, recoverable tasks.",
            )}
      </p>
      {draftSaved ? <p role="status">{t("Automation draft saved")}</p> : null}
      <p>
        {t(
          "Save unfinished settings as a draft. Existing automations keep their current configuration.",
        )}
      </p>
      <div className="automation-form-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={submitting || draftState.loading || draftState.saving || !draftState.revision}
          onClick={() => void saveDraft()}
        >
          {t("Save automation draft")}
        </button>
        {initial || initialProject || selection ? (
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={onDone}
            disabled={submitting || draftState.saving}
          >
            {t("Cancel")}
          </button>
        ) : null}
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={submitting || draftState.saving}
          aria-busy={submitting}
        >
          {initial ? t("Save changes") : t("Create automation")}
        </button>
      </div>
    </form>
  );
}

function LabeledField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label className="automation-form-field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}
