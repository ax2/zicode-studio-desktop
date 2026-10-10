import { useState } from "react";
import { t } from "../../shared/i18n.js";
import { ProjectRunDetails } from "./ProjectRunDetails";
import { type ProjectRun, taskStatus } from "./project-runner";
import { RunAnalysisButton } from "./RunAnalysisButton";
import type { PrepareRunAnalysis } from "./run-analysis";

export function ProjectRunHistory({
  runs,
  canRun,
  pending,
  onStop,
  workspace,
  receivedAt,
  stale = false,
  prepareAnalysis,
}: {
  runs: ProjectRun[];
  canRun: boolean;
  pending: boolean;
  onStop(id: string): void;
  workspace?: string | null;
  receivedAt?: string | null;
  stale?: boolean;
  prepareAnalysis?: PrepareRunAnalysis;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId === null ? runs[0] : runs.find((run) => run.id === selectedId);
  return (
    <>
      {selectedId !== null ? (
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => setSelectedId(null)}
        >
          {t("Follow latest run")}
        </button>
      ) : null}
      {selectedId !== null && !selected ? (
        <p role="status">
          {t(
            "The selected run is no longer available. Follow the latest run or select another record.",
          )}
        </p>
      ) : null}
      {selected ? (
        <>
          <ProjectRunDetails
            run={selected}
            canRun={canRun}
            pending={pending}
            onStop={onStop}
            following={selectedId === null}
          />
          {receivedAt ? (
            <p>
              {t("Run snapshot received")}:{" "}
              <time dateTime={receivedAt}>{new Date(receivedAt).toLocaleString()}</time>
            </p>
          ) : null}
          {stale ? (
            <p role="status">
              {t(
                "This run snapshot may be out of date. That limitation will be included in the analysis draft.",
              )}
            </p>
          ) : null}
          {workspace && receivedAt && prepareAnalysis ? (
            <RunAnalysisButton
              key={selected.id}
              request={{ workspace, run: selected, receivedAt, stale }}
              prepare={prepareAnalysis}
            />
          ) : null}
        </>
      ) : null}
      {runs.length > 1 ? (
        <details>
          <summary>{t("Command run history")}</summary>
          <ul className="project-runner-list">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  aria-pressed={selected?.id === run.id}
                  onClick={() => setSelectedId(run.id)}
                >
                  {run.name} · {taskStatus(run.status)} · {new Date(run.startedAt).toLocaleString()}
                  {` · ${run.directory === undefined ? t("Not reported by this host") : run.directory || t("Workspace root")}`}
                </button>
                {run.fingerprint ? (
                  <code>
                    {t("Manifest fingerprint")}: {run.fingerprint}
                  </code>
                ) : null}
                {run.exitCode !== null ? ` · ${t("Exit code")}: ${run.exitCode}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
