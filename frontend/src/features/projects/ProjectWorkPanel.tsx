import { useState } from "react";
import { t } from "../../shared/i18n.js";
import { requestProjectWork } from "../../shared/workCreation";
import { statusLabel } from "../tasks/logic";
import type { ProjectWork } from "./project-work";
import { projectPathKey } from "./project-work";

export function ProjectWorkPanel({
  work,
  projectPath,
  loading,
  openApp,
}: {
  work: ProjectWork;
  projectPath?: string | null;
  loading: boolean;
  openApp(id: string): void;
}) {
  const [taskLimit, setTaskLimit] = useState(20);
  const [automationLimit, setAutomationLimit] = useState(20);
  return (
    <section aria-label={t("Project work")}>
      <h2>{t("Project work")}</h2>
      {loading && <p role="status">{t("Refreshing project work…")}</p>}
      <p>
        {t(
          "Tasks and automations explicitly linked to this project. Unassigned work remains in the global centers.",
        )}
      </p>
      <section className="ui-panel project-workspace-results" aria-label={t("Project tasks")}>
        <h3>{t("Project tasks")}</h3>
        <button
          type="button"
          className="ui-button ui-button--primary"
          disabled={!projectPathKey(projectPath)}
          onClick={() => requestProjectWork("task", projectPath as string)}
        >
          {t("New task for this project")}
        </button>
        {!loading && work.tasksUnavailable && (
          <p role="status">
            {t(
              "Project tasks could not be refreshed. Any displayed items are from the last successful read.",
            )}
          </p>
        )}
        {!loading && !work.tasksUnavailable && work.tasks.length === 0 && (
          <p>{t("No tasks are linked to this project.")}</p>
        )}
        <ul>
          {work.tasks.slice(0, taskLimit).map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="project-workspace-result-row"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("zicode:open-task", { detail: { taskId: task.id } }),
                  )
                }
              >
                <strong>{task.title || t("Untitled task")}</strong>
                <span>{t(statusLabel(task.status))}</span>
                <span className="project-workspace-result-summary">{task.summary}</span>
              </button>
            </li>
          ))}
        </ul>
        {work.tasks.length > taskLimit && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => setTaskLimit((limit) => limit + 20)}
          >
            {t("Show more project tasks")}
          </button>
        )}
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => openApp("com.zicode.tasks")}
        >
          {t("Open task center")}
        </button>
      </section>
      <section className="ui-panel project-workspace-results" aria-label={t("Project automations")}>
        <h3>{t("Project automations")}</h3>
        <button
          type="button"
          className="ui-button ui-button--primary"
          disabled={!projectPathKey(projectPath)}
          onClick={() => requestProjectWork("automation", projectPath as string)}
        >
          {t("New automation for this project")}
        </button>
        {!loading && work.automationsUnavailable && (
          <p role="status">
            {t(
              "Project automations could not be refreshed. Any displayed items are from the last successful read.",
            )}
          </p>
        )}
        {!loading && !work.automationsUnavailable && work.automations.length === 0 && (
          <p>{t("No automations are linked to this project.")}</p>
        )}
        <ul>
          {work.automations.slice(0, automationLimit).map((workflow) => (
            <li key={workflow.id}>
              <button
                type="button"
                className="project-workspace-result-row"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("zicode:open-automation", {
                      detail: { workflowId: workflow.id },
                    }),
                  )
                }
              >
                <strong>{workflow.title || t("Untitled automation")}</strong>
                <span>
                  {workflow.approvalPending
                    ? t("Needs approval")
                    : workflow.enabled
                      ? t("Enabled")
                      : t("Disabled")}
                </span>
                <span className="project-workspace-result-summary">
                  {workflow.nextRunAt && Number.isFinite(Date.parse(workflow.nextRunAt))
                    ? new Date(workflow.nextRunAt).toLocaleString()
                    : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {work.automations.length > automationLimit && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => setAutomationLimit((limit) => limit + 20)}
          >
            {t("Show more project automations")}
          </button>
        )}
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => window.dispatchEvent(new CustomEvent("zicode:open-automation"))}
        >
          {t("Open automation center")}
        </button>
      </section>
    </section>
  );
}
