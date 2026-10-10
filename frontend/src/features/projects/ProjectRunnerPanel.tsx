import { useState } from "react";
import { t } from "../../shared/i18n.js";
import { PackageManagerDetails } from "./PackageManagerDetails";
import { ProjectRunHistory } from "./ProjectRunHistory";
import { ProjectTaskDirectoryPicker } from "./ProjectTaskDirectoryPicker";
import { ProjectTaskList } from "./ProjectTaskList";
import { downloadProjectRunHistory } from "./project-run-history-export";
import { isActiveRun, type ProjectRunnerApi } from "./project-runner";
import type { PrepareRunAnalysis } from "./run-analysis";
import { useProjectRuns } from "./use-project-runs";
import { useProjectTaskCatalog } from "./use-project-task-catalog";

export function ProjectRunnerPanel({
  workspaceId,
  projectName,
  api,
  directory: selectedDirectory,
  onDirectoryChange,
  prepareAnalysis,
}: {
  workspaceId?: string | null;
  projectName?: string;
  api: ProjectRunnerApi;
  directory?: string;
  onDirectoryChange?(directory: string): void;
  prepareAnalysis?: PrepareRunAnalysis;
}) {
  const [localDirectory, setLocalDirectory] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const directory = selectedDirectory ?? localDirectory;
  const {
    runs,
    receivedAt,
    historyStatus,
    pending,
    loaded,
    readError,
    actionError: error,
    creationUncertain,
    controller,
  } = useProjectRuns(api, workspaceId);
  const pollError = Boolean(readError);
  const [revision, setRevision] = useState(0);
  const { catalog, error: catalogError } = useProjectTaskCatalog(
    api,
    workspaceId,
    directory,
    revision,
  );

  const busy = runs.some(isActiveRun);
  const clearHistory = api.clearHistory;
  return (
    <section className="ui-panel project-runner" aria-label={t("Project commands")}>
      <header className="project-runner-header">
        <h2>{t("Project commands")}</h2>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={pending || !workspaceId}
          onClick={() => {
            setRevision((value) => value + 1);
            void controller.refresh();
          }}
        >
          {t("Refresh task list")}
        </button>
      </header>
      <p>
        {t(
          "Discover scripts and fixed commands for JavaScript, Rust, Go, Python, Ruby, PHP, CMake, Java and .NET projects. Running a command may execute project code, change files and download dependencies. Review it before starting.",
        )}
      </p>
      <p>
        {t(
          "Tasks keep running when you leave this view and stop when the desktop host exits. Command text and output remain in memory for this host session.",
        )}
      </p>
      {historyStatus === "persistent" && (
        <p>{t("Run summaries are saved locally: up to 40 per project and 500 in total.")}</p>
      )}
      {historyStatus === "memory" && <p>{t("This host keeps command history in memory only.")}</p>}
      {historyStatus === "unavailable" && (
        <p role="alert">
          {t(
            "Saved command history is unavailable or incomplete. Commands can still run, but saved results may be missing or out of date.",
          )}
        </p>
      )}
      {api.canRun && clearHistory && (
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={pending || !workspaceId || runs.length === 0}
          onClick={() => {
            if (
              window.confirm(
                t(
                  "Clear saved and completed command history for this project? Active tasks in this host will be kept.",
                ),
              )
            ) {
              void controller.clearHistory();
            }
          }}
        >
          {t("Clear command history")}
        </button>
      )}
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={
          !workspaceId ||
          !projectName ||
          !loaded ||
          pollError ||
          pending ||
          !receivedAt ||
          !historyStatus ||
          runs.length === 0
        }
        onClick={() => {
          if (!workspaceId || !projectName || !receivedAt || !historyStatus) return;
          try {
            downloadProjectRunHistory({
              workspaceId,
              projectName,
              receivedAt,
              historyStatus,
              runs,
            });
            setExportError(null);
          } catch (reason) {
            setExportError(
              t(
                reason instanceof Error
                  ? reason.message
                  : "Could not download command run summary.",
              ),
            );
          }
        }}
      >
        {t("Download command run summary")}
      </button>
      <p className="ui-muted">
        {t(
          "The downloaded run summary is plaintext metadata. It excludes command text, arguments and output; review project names and directories before sharing.",
        )}
      </p>
      {exportError ? <p role="alert">{exportError}</p> : null}
      {!api.canRun && <p>{t("Run and stop project commands from the desktop app.")}</p>}
      {!workspaceId && <p>{t("Open a project folder to discover its commands.")}</p>}
      {workspaceId && (
        <ProjectTaskDirectoryPicker
          workspaceId={workspaceId}
          api={api}
          revision={revision}
          value={directory}
          disabled={pending}
          onChange={(value) => {
            controller.dismissActionError();
            if (onDirectoryChange) onDirectoryChange(value);
            else setLocalDirectory(value);
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {catalogError && <p role="alert">{catalogError}</p>}
      {creationUncertain ? (
        <p role="alert">
          {t(
            "The previous command start is unconfirmed and may still complete. Refresh the task list and review the runs before starting another command.",
          )}
        </p>
      ) : null}
      {pollError && (
        <p role="status">
          {t("Run status could not be refreshed. Displayed results may be out of date.")}
        </p>
      )}
      {workspaceId && !historyStatus && !pollError ? (
        <p role="status">{t("Loading run status before commands can start…")}</p>
      ) : null}
      {workspaceId && !catalog && !error && !catalogError && (
        <p role="status">{t("Loading project commands…")}</p>
      )}
      {catalog && workspaceId && (
        <>
          <p>
            {t("Project tools")}: <strong>{catalog.manager}</strong>
          </p>
          <PackageManagerDetails selection={catalog.packageManager} />
          <ProjectTaskList
            key={`${workspaceId}:${directory}`}
            catalog={catalog}
            workspaceId={workspaceId}
            projectName={projectName}
            directory={directory}
            canRun={api.canRun}
            blocked={pending || busy || pollError || !loaded || creationUncertain}
            onStart={(taskId) => void controller.start(taskId, catalog.fingerprint, directory)}
          />
        </>
      )}
      <ProjectRunHistory
        key={workspaceId}
        runs={runs}
        workspace={workspaceId}
        receivedAt={receivedAt}
        stale={pollError || pending}
        prepareAnalysis={prepareAnalysis}
        canRun={api.canRun}
        pending={pending}
        onStop={(id) => void controller.stop(id)}
      />
    </section>
  );
}
