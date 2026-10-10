import { t } from "../../shared/i18n.js";
import { statusLabel } from "../tasks/logic";
import type { ProjectWork } from "./project-work";

export function ProjectWorkSummaryPanel({
  work,
  loading,
  openWork,
}: {
  work: ProjectWork;
  loading: boolean;
  openWork(): void;
}) {
  const tasks = work.tasks.slice(0, 3);
  const automations = work.automations
    .filter((item) => item.approvalPending || item.enabled)
    .slice(0, 3);
  const hasWork = tasks.length > 0 || automations.length > 0;

  return (
    <section className="ui-panel project-work-summary" aria-label={t("Project work summary")}>
      <header className="project-work-summary-header">
        <h2>{t("Project work summary")}</h2>
        <button type="button" className="ui-button ui-button--ghost" onClick={openWork}>
          {t("View project work")}
        </button>
      </header>
      {loading ? <p role="status">{t("Refreshing project work…")}</p> : null}
      {!loading && (work.tasksUnavailable || work.automationsUnavailable) ? (
        <p role="status">
          {t("Some project work could not be refreshed. Displayed items may be out of date.")}
        </p>
      ) : null}
      {hasWork ? (
        <div className="project-work-summary-columns">
          {tasks.length ? (
            <div>
              <h3>{t("Project tasks")}</h3>
              <ul>
                {tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("zicode:open-task", { detail: { taskId: task.id } }),
                        )
                      }
                    >
                      <strong>{task.title || t("Untitled task")}</strong>
                      <span>{t(statusLabel(task.status))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {automations.length ? (
            <div>
              <h3>{t("Project automations")}</h3>
              <ul>
                {automations.map((workflow) => (
                  <li key={workflow.id}>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("zicode:open-automation", {
                            detail: { workflowId: workflow.id },
                          }),
                        )
                      }
                    >
                      <strong>{workflow.title || t("Untitled")}</strong>
                      <span>{workflow.approvalPending ? t("Needs approval") : t("Enabled")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : !loading && !work.tasksUnavailable && !work.automationsUnavailable ? (
        <p>{t("No tasks or active automations are linked to this project.")}</p>
      ) : null}
      {(work.tasks.length > tasks.length || work.automations.length > automations.length) && (
        <p className="project-work-summary-hint">
          {t("Showing a few project items. Open project work for the full list.")}
        </p>
      )}
    </section>
  );
}
