import { useState, type FormEvent, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n.js";
import { Select } from "../../shared/Select";
import {
  AUTOMATION_FILTERS,
  filterLabel,
  filterWorkflows,
  formatDate,
  nextAutomationRun,
  scheduleLabel,
  type AutomationWorkflow,
} from "./logic";
import { createAutomationStore, type AutomationAppOptions } from "./store";

type AutomationStore = ReturnType<typeof createAutomationStore>;

export function AutomationNav({ store }: { store: AutomationStore }) {
  const workflows = store((state) => state.workflows);
  const filter = store((state) => state.filter);
  const setFilter = store((state) => state.setFilter);
  return (
    <nav className="automation-navigation">
      {AUTOMATION_FILTERS.map((id) => {
        const count = filterWorkflows(workflows, id).length;
        return (
          <button
            key={id}
            type="button"
            className={`automation-nav-item${filter === id ? " active" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(filterLabel(id))}
            <span className="automation-nav-count">{count}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function AutomationMain({ store }: { store: AutomationStore }) {
  const workflows = store((state) => state.workflows);
  const filter = store((state) => state.filter);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const visible = filterWorkflows(workflows, filter);
  return (
    <div className="automation-main">
      <header className="automation-header">
        <div>
          <h1>{t("Automation center")}</h1>
          <p>{t("Schedule repeatable work with explicit approvals and task history.")}</p>
        </div>
        <button type="button" className="ui-button ui-button--secondary" onClick={() => void load()}>
          {t("Refresh")}
        </button>
      </header>
      <WorkflowForm store={store} />
      {error ? (
        <StatePanel title={t("Could not load automations")} description={error.message} />
      ) : visible.length === 0 ? (
        <StatePanel
          title={t("No automations in this view")}
          description={t("Create a workflow to turn repeated prompts into auditable tasks.")}
        />
      ) : (
        <div className="automation-list">
          {visible.map((workflow) => (
            <WorkflowCard key={workflow.id} store={store} workflow={workflow} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatePanel({ title, description }: { title: string; description: string }) {
  return (
    <section className="ui-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function WorkflowForm({ store }: { store: AutomationStore }) {
  const saveWorkflow = store((state) => state.saveWorkflow);
  const notify = store((state) => state.notify);
  const getTarget = store((state) => state.getTarget);
  const [title, setTitle] = useState("");
  const [targetProject, setTargetProject] = useState(getTarget()?.cwd ?? "");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("manual");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [dailyTime, setDailyTime] = useState("09:00");
  // Scheduled tasks should run automatically out of the box; approval is an
  // opt-in guard for workflows that must wait for a human before dispatching.
  const [requireApproval, setRequireApproval] = useState(false);
  const [maxCost, setMaxCost] = useState("");
  const [maxRetries, setMaxRetries] = useState("2");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const saved = await saveWorkflow({
        id: "",
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
        enabled: true,
      });
      if (saved && saved.schedule !== "manual" && !saved.nextRunAt) {
        await saveWorkflow({ ...saved, nextRunAt: nextAutomationRun(saved) });
      }
      setTitle("");
      setTargetProject(getTarget()?.cwd ?? "");
      setPrompt("");
      setSchedule("manual");
      setIntervalMinutes("60");
      setDailyTime("09:00");
      setRequireApproval(true);
      setMaxCost("");
      setMaxRetries("2");
      notify({ title: t("Automation created"), type: "success" });
    } catch (reason) {
      notify({
        title: t("Could not save automation"),
        message: reason instanceof Error ? reason.message : String(reason),
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="ui-panel automation-form" onSubmit={handleSubmit}>
      <h2>{t("New automation")}</h2>
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
          placeholder={t("Target project")}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={targetProject}
          onChange={(e) => setTargetProject(e.target.value)}
        />
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
          onChange={setSchedule}
        />
      </LabeledField>
      {schedule === "interval" ? (
        <LabeledField
          label={t("Interval (minutes)")}
          htmlFor="automation-interval-minutes"
        >
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
      <label className="automation-checkbox">
        <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
        {t("Require approval before every run")}
      </label>
      <p className="automation-checkbox-hint" role="note">
        {requireApproval
          ? t("Each run waits for your approval in the task center.")
          : t("Runs automatically when due; no manual approval needed.")}
      </p>
      <button
        type="submit"
        className="ui-button ui-button--primary"
        disabled={submitting}
        aria-busy={submitting}
      >
        {t("Create automation")}
      </button>
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

function WorkflowCard({
  store,
  workflow,
}: {
  store: AutomationStore;
  workflow: AutomationWorkflow;
}) {
  const saveWorkflow = store((state) => state.saveWorkflow);
  const removeWorkflow = store((state) => state.removeWorkflow);
  const runWorkflow = store((state) => state.runWorkflow);
  const badge = workflow.approvalPending
    ? t("Approval required")
    : workflow.enabled
      ? t("Enabled")
      : t("Disabled");
  return (
    <article className="ui-panel automation-card">
      <header>
        <div>
          <span className="ui-badge">{badge}</span>
          <h2>{workflow.title}</h2>
        </div>
        <div className="automation-actions">
          {workflow.approvalPending ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() => void runWorkflow(workflow, "approval")}
            >
              {t("Approve and run")}
            </button>
          ) : (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() => void runWorkflow(workflow)}
            >
              {t("Run now")}
            </button>
          )}
          <button
            type="button"
            className="ui-button ui-button--secondary ui-button--sm"
            onClick={() =>
              void saveWorkflow({
                ...workflow,
                enabled: !workflow.enabled,
                nextRunAt: !workflow.enabled
                  ? nextAutomationRun({ ...workflow, enabled: true })
                  : null,
              })
            }
          >
            {t(workflow.enabled ? "Disable" : "Enable")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            onClick={() => void removeWorkflow(workflow.id)}
          >
            {t("Remove")}
          </button>
        </div>
      </header>
      <p className="automation-prompt">{workflow.prompt}</p>
      <dl>
        <Detail label={t("Schedule")} value={scheduleLabel(workflow)} />
        <Detail label={t("Next run")} value={formatDate(workflow.nextRunAt)} />
        <Detail
          label={t("Target project")}
          value={workflow.targetProject || t("Current project")}
        />
      </dl>
      {workflow.history?.length ? (
        <details className="automation-history">
          <summary>
            {t("Run history")} ({workflow.history.length})
          </summary>
          <ol>
            {workflow.history.slice(0, 12).map((run) => (
              <li key={run.taskId ?? `${run.startedAt ?? "run"}-${run.status}`}>
                <time>{formatDate(run.startedAt)}</time>
                <span className="ui-badge">{t(run.status)}</span>
                <span>{run.message || run.taskId || ""}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export interface AutomationAppApi {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  setTarget(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<AutomationWorkflow[]>;
  tick(): Promise<void>;
  startScheduler(): void;
  stopScheduler(): void;
  destroy(): void;
}

export function createAutomationApp(options: AutomationAppOptions): AutomationAppApi {
  const store = createAutomationStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(
        container,
        <AutomationNav store={store} />,
        navRoot,
      );
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(
        container,
        <AutomationMain store={store} />,
        contentRoot,
      );
      store.getState().startScheduler();
    },
    setTarget() {
      // React re-renders from the store; nothing else to force.
    },
    handlesCommand(commandId) {
      return commandId === "automation.open";
    },
    executeCommand() {
      options.openApp?.("com.zicode.automation");
    },
    refresh() {
      return store.getState().load();
    },
    tick() {
      return store.getState().tick();
    },
    startScheduler() {
      store.getState().startScheduler();
    },
    stopScheduler() {
      store.getState().destroy();
    },
    destroy() {
      store.getState().destroy();
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
  };
}
