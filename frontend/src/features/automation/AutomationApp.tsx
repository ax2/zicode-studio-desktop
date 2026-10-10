import { useEffect, useState } from "react";
import type { Root } from "react-dom/client";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
import { friendlyTaskDispatchError } from "../../shared/hostErrors";
import { t } from "../../shared/i18n.js";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { BackgroundWorkerPanel } from "./BackgroundWorkerPanel";
import { DraftList } from "./DraftList";
import type { DraftSelection } from "./draft-store";
import {
  AUTOMATION_FILTERS,
  type AutomationWorkflow,
  filterLabel,
  filterWorkflows,
  formatDate,
  nextAutomationRun,
  scheduleLabel,
} from "./logic";
import { type AutomationAppOptions, createAutomationStore } from "./store";
import { useWorkspaceStatusInventory } from "./useWorkspaceStatusInventory";
import { WorkflowForm } from "./WorkflowForm";

type AutomationStore = ReturnType<typeof createAutomationStore>;
type AutomationMainProps = {
  store: AutomationStore;
  listWorkspaceStatus?: AutomationAppOptions["listWorkspaceStatus"];
  openWorkspaceTasks?: AutomationAppOptions["openWorkspaceTasks"];
  backgroundWorkerStatus?: AutomationAppOptions["backgroundWorkerStatus"];
  startBackgroundWorker?: AutomationAppOptions["startBackgroundWorker"];
  stopBackgroundWorker?: AutomationAppOptions["stopBackgroundWorker"];
  backgroundWorkerLoginEnabled?: AutomationAppOptions["backgroundWorkerLoginEnabled"];
  setBackgroundWorkerLoginEnabled?: AutomationAppOptions["setBackgroundWorkerLoginEnabled"];
};

export function AutomationNav({ store }: { store: AutomationStore }) {
  const workflows = store((state) => state.workflows);
  const pendingApprovalTasks = store((state) => state.pendingApprovalTasks);
  const filter = store((state) => state.filter);
  const setFilter = store((state) => state.setFilter);
  return (
    <nav className="automation-navigation">
      {AUTOMATION_FILTERS.map((id) => {
        const count = filterWorkflows(workflows, id, pendingApprovalTasks).length;
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

export function AutomationMain(props: AutomationMainProps) {
  const { store } = props;
  const draftStore = store((state) => state.draftStore);
  const epoch = draftStore((state) => state.epoch);
  return <AutomationContent key={epoch} {...props} />;
}

function AutomationContent({ store, listWorkspaceStatus, openWorkspaceTasks, backgroundWorkerStatus, startBackgroundWorker, stopBackgroundWorker, backgroundWorkerLoginEnabled, setBackgroundWorkerLoginEnabled }: AutomationMainProps) {
  const draftStore = store((state) => state.draftStore);
  const [draft, setDraft] = useState<DraftSelection | undefined>();
  const [formSequence, setFormSequence] = useState(0);
  const workflows = store((state) => state.workflows);
  const pendingApprovalTasks = store((state) => state.pendingApprovalTasks);
  const approvalTasksError = store((state) => state.approvalTasksError);
  const filter = store((state) => state.filter);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const loading = store((state) => state.loading);
  const notify = store((state) => state.notify);
  const [editing, setEditing] = useState<AutomationWorkflow | null>(null);
  const [query, setQuery] = useState("");
  const {
    statuses: workspaceStatuses,
    error: workspaceStatusError,
    refresh: refreshWorkspaceStatuses,
  } = useWorkspaceStatusInventory(listWorkspaceStatus);
  const focusWorkflowId = store((state) => state.focusWorkflowId);
  const focusWorkflow = store((state) => state.focusWorkflow);
  const creationRequest = store((state) => state.creationRequest);
  useEffect(() => {
    if (creationRequest) {
      setEditing(null);
      setDraft(undefined);
    }
  }, [creationRequest]);
  const visible = filterWorkflows(workflows, filter, pendingApprovalTasks).filter((workflow) => {
    if (focusWorkflowId) return workflow.id === focusWorkflowId;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(workflow.title || "")
        .toLowerCase()
        .includes(q) ||
      String(workflow.prompt || "")
        .toLowerCase()
        .includes(q)
    );
  });
  return (
    <div className="automation-main">
      <header className="automation-header">
        <div>
          <h1>{t("Automation center")}</h1>
          <p>{t("Schedule repeatable work with explicit approvals and task history.")}</p>
          <p>
            {t(
              "While the desktop app is open, schedules are checked across registered workspaces.",
            )}
          </p>
        </div>
        <div className="automation-header-actions">
          <input
            type="search"
            className="ui-input automation-search"
            value={query}
            placeholder={t("Search automations")}
            aria-label={t("Search automations")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => {
              void load();
              refreshWorkspaceStatuses();
            }}
          >
            {t("Refresh")}
          </button>
        </div>
      </header>
      <BackgroundWorkerPanel
        backgroundWorkerStatus={backgroundWorkerStatus}
        startBackgroundWorker={startBackgroundWorker}
        stopBackgroundWorker={stopBackgroundWorker}
        backgroundWorkerLoginEnabled={backgroundWorkerLoginEnabled}
        setBackgroundWorkerLoginEnabled={setBackgroundWorkerLoginEnabled}
      />
      {approvalTasksError ? <p role="status">{t("Could not load tasks")}</p> : null}
      {listWorkspaceStatus ? (
        <section className="ui-card automation-workspace-overview" aria-label={t("Registered workspace automation status")}>
          <h2>{t("Registered workspace automation status")}</h2>
          <p>{t("This inventory shows queued work and tasks that need attention across registered workspaces.")}</p>
          {workspaceStatusError ? <p role="status">{t("Could not scan registered workspaces.")}</p> : null}
          {workspaceStatuses?.length === 0 ? (
            <p role="status">{t("No registered workspaces to scan.")}</p>
          ) : workspaceStatuses ? (
            <ul>
              {workspaceStatuses.map((item) => (
                <li key={item.workspaceId}>
                  <strong>{item.path}</strong>
                  <span className="automation-workspace-overview-status">
                    {item.status === "ready"
                      ? `${t("Rules")}: ${item.workflowCount} · ${t("Due")}: ${item.dueCount}`
                      : item.status === "uninitialized"
                        ? t("No formal automation file")
                        : workspaceStatusMessage(item.errorCode)}
                    {" · "}
                    {item.taskStatus === "ready"
                      ? `${t("Queued")}: ${item.pendingCount} · ${t("Needs approval")}: ${item.approvalCount} · ${t("Running")}: ${item.runningCount} · ${t("Blocked")}: ${item.blockedCount} · ${t("Failed")}: ${item.failedCount}`
                      : item.taskStatus === "uninitialized"
                        ? t("No formal task file")
                        : workspaceStatusMessage(item.taskErrorCode)}
                    {` · ${t("Scanned")}: ${formatDate(item.scannedAt)}`}
                  </span>
                  {openWorkspaceTasks && item.errorCode !== "workspace_unavailable" ? (
                    <button
                      type="button"
                      className="ui-button ui-button--secondary ui-button--sm"
                      onClick={() => void openWorkspaceTasks(item.path).catch((reason) =>
                        notify({
                          title: t("Could not open workspace tasks"),
                          message: reason instanceof Error ? reason.message : String(reason),
                          type: "error",
                        }),
                      )}
                    >
                      {t("Open tasks")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {focusWorkflowId && (
        <div role="status">
          <p>{t("Showing the selected automation.")}</p>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => {
              setQuery("");
              focusWorkflow(null);
            }}
          >
            {t("Show all automations")}
          </button>
        </div>
      )}
      <FirstRunGuide
        storageKey="automation"
        title={t("One place for repeatable work")}
        steps={[
          t("Create a workflow from a template or from scratch."),
          t("Run it now, or let a schedule trigger it automatically."),
          t("Track runs and history in the task center."),
        ]}
        ctaLabel={t("Create a workflow")}
        onCta={() => {
          const nameInput = document.getElementById("automation-name");
          nameInput?.scrollIntoView?.({ behavior: "smooth", block: "center" });
          nameInput?.focus();
        }}
      />
      <DraftList
        store={draftStore}
        onRestore={(selection) => {
          setEditing(null);
          setDraft(selection);
          setFormSequence((value) => value + 1);
        }}
      />
      <WorkflowForm
        store={store}
        key={`${editing?.id ?? creationRequest?.sequence ?? "new"}-${draft?.draft.id ?? "blank"}-${formSequence}`}
        draftSelection={draft}
        initial={editing ?? undefined}
        initialProject={creationRequest?.projectPath}
        onDone={() => {
          if (store.getState().creationRequest?.sequence !== creationRequest?.sequence) return;
          setEditing(null);
          setDraft(undefined);
          setFormSequence((value) => value + 1);
          store.getState().clearCreation();
        }}
      />
      {error ? (
        <StatePanel title={t("Could not load automations")} description={error.message} />
      ) : visible.length === 0 ? (
        <StatePanel
          title={
            focusWorkflowId && loading
              ? t("Refreshing project work…")
              : focusWorkflowId
                ? t("The selected automation is no longer available.")
                : query.trim()
                  ? t("No matching automations")
                  : t("No automations in this view")
          }
          description={
            focusWorkflowId
              ? t("Refresh or show all automations to continue.")
              : query.trim()
                ? t("Try a different keyword.")
                : t("Create a workflow to turn repeated prompts into auditable tasks.")
          }
        />
      ) : (
        <div className="automation-list">
          {visible.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              store={store}
              workflow={workflow}
              onEdit={(workflow) => {
                setDraft(undefined);
                setEditing(workflow);
                setFormSequence((value) => value + 1);
              }}
            />
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

function workspaceStatusMessage(code?: string | null): string {
  const messages: Record<string, string> = {
    workspace_unavailable: "Workspace folder is unavailable",
    automation_workspace_unreadable: "Automation file could not be read",
    automation_workspace_too_large: "Automation file exceeds the size limit",
    automation_workspace_invalid: "Automation file is invalid",
    task_store_unreadable: "Task file could not be read",
    task_store_too_large: "Task file exceeds the size limit",
    task_store_invalid: "Task file is invalid",
  };
  return t(messages[code ?? ""] ?? "Automation file could not be read");
}

function WorkflowCard({
  store,
  workflow,
  onEdit,
}: {
  store: AutomationStore;
  workflow: AutomationWorkflow;
  onEdit: (workflow: AutomationWorkflow) => void;
}) {
  const saveWorkflow = store((state) => state.saveWorkflow);
  const duplicateWorkflow = store((state) => state.duplicateWorkflow);
  const removeWorkflow = store((state) => state.removeWorkflow);
  const runWorkflow = store((state) => state.runWorkflow);
  const approveQueuedTask = store((state) => state.approveQueuedTask);
  const pendingApprovalTaskId = store((state) => state.pendingApprovalTasks[workflow.id]);
  const approvalTasksError = store((state) => state.approvalTasksError);
  const badge = pendingApprovalTaskId
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
          {pendingApprovalTaskId ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() => void approveQueuedTask(workflow.id)}
            >
              {t("Approve and run")}
            </button>
          ) : (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--sm"
              onClick={() => void runWorkflow(workflow)}
              disabled={approvalTasksError}
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
            onClick={() => onEdit(workflow)}
          >
            {t("Edit")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            onClick={() => void removeWorkflow(workflow.id)}
          >
            {t("Remove")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            title={t("Duplicate this workflow as a new one")}
            onClick={() => void duplicateWorkflow(workflow)}
          >
            {t("Duplicate")}
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
              <li
                key={run.taskId ?? `${run.startedAt ?? "run"}-${run.status}`}
                className="automation-history-run"
              >
                <time>{formatDate(run.startedAt)}</time>
                <span className="ui-badge">{t(run.status)}</span>
                <span
                  title={
                    run.message && friendlyTaskDispatchError(run.message) !== run.message
                      ? run.message
                      : undefined
                  }
                >
                  {friendlyTaskDispatchError(t(run.message || run.taskId || ""))}
                </span>
                {run.taskId ? (
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm automation-history-open"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("zicode:open-task", {
                          detail: { taskId: run.taskId },
                        }),
                      )
                    }
                  >
                    {t("View task")}
                  </button>
                ) : null}
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
  newWorkflow(projectPath: string): void;
  focusWorkflow(id: string | null): void;
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  setTarget(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<AutomationWorkflow[]>;
  runWorkflow(workflow: AutomationWorkflow, trigger?: string): Promise<void>;
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
    newWorkflow(projectPath) {
      store.getState().requestCreation(projectPath);
    },
    focusWorkflow(id) {
      store.getState().focusWorkflow(id);
      void store.getState().load();
    },
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <AutomationNav store={store} />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <AutomationMain store={store} listWorkspaceStatus={options.listWorkspaceStatus} openWorkspaceTasks={options.openWorkspaceTasks} backgroundWorkerStatus={options.backgroundWorkerStatus} startBackgroundWorker={options.startBackgroundWorker} stopBackgroundWorker={options.stopBackgroundWorker} backgroundWorkerLoginEnabled={options.backgroundWorkerLoginEnabled} setBackgroundWorkerLoginEnabled={options.setBackgroundWorkerLoginEnabled} />, contentRoot);
      store.getState().startScheduler();
    },
    setTarget() {
      store.getState().syncTarget();
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
    runWorkflow(workflow, trigger) {
      return store.getState().runWorkflow(workflow, trigger);
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
