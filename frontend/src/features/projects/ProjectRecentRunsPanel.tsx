import { useEffect, useState } from "react";
import { t } from "../../shared/i18n.js";
import { parseProjectHistory } from "./project-run-records";
import { type ProjectRunHistory, type ProjectRunnerApi, taskStatus } from "./project-runner";

interface ReadResult {
  workspace: string;
  revision: number;
  retry: number;
  api: ProjectRunnerApi;
  history?: ProjectRunHistory;
  receivedAt?: string;
  error?: boolean;
}

export function ProjectRecentRunsPanel({
  workspaceId,
  revision,
  api,
  openCommands,
}: {
  workspaceId?: string | null;
  revision: number;
  api: ProjectRunnerApi;
  openCommands(): void;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<ReadResult | null>(null);
  const current =
    result?.workspace === workspaceId &&
    result?.revision === revision &&
    result?.retry === retry &&
    result?.api === api
      ? result
      : null;
  const loading = Boolean(workspaceId && !current);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const scope = { workspace: workspaceId, revision, retry, api };
    void api.runs(workspaceId).then(
      (response) => {
        if (!active) return;
        try {
          setResult({
            ...scope,
            history: parseProjectHistory(response, workspaceId),
            receivedAt: new Date().toISOString(),
          });
        } catch {
          setResult({ ...scope, error: true });
        }
      },
      () => {
        if (active) setResult({ ...scope, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceId, revision, retry, api]);

  const runs = current?.history?.runs.slice(0, 3) ?? [];
  return (
    <section className="ui-panel project-recent-runs" aria-label={t("Recent command runs")}>
      <header className="project-recent-runs-header">
        <h2>{t("Recent command runs")}</h2>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={!workspaceId || loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          {t("Refresh command runs")}
        </button>
      </header>
      <div aria-busy={loading}>
        {!workspaceId ? (
          <p>{t("Open a project folder to view command runs.")}</p>
        ) : loading ? (
          <p role="status">{t("Reading command runs…")}</p>
        ) : current?.error ? (
          <p role="alert">{t("Could not read command runs. Refresh to try again.")}</p>
        ) : (
          <>
            {current?.history?.historyStatus === "unavailable" ? (
              <p role="status">
                {t(
                  "Saved command history is unavailable or incomplete. Recent runs may be missing.",
                )}
              </p>
            ) : current?.history?.historyStatus === "memory" ? (
              <p>{t("This host keeps command history in memory only.")}</p>
            ) : null}
            {runs.length ? (
              <ul>
                {runs.map((run) => (
                  <li key={run.id}>
                    <strong>{run.name}</strong>
                    <span>{taskStatus(run.status)}</span>
                    <time dateTime={new Date(run.startedAt).toISOString()}>
                      {new Date(run.startedAt).toLocaleString()}
                    </time>
                    <span>
                      {run.directory === undefined
                        ? t("Not reported by this host")
                        : run.directory || t("Workspace root")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {current?.history?.historyStatus === "unavailable"
                  ? t("No recent runs are available from this host.")
                  : t("No command runs recorded for this project.")}
              </p>
            )}
            {current?.receivedAt ? (
              <p className="project-recent-runs-received">
                {t("Run snapshot received")}: {new Date(current.receivedAt).toLocaleString()}.{" "}
                {t("Running and stopping states are a snapshot. Refresh for current status.")}
              </p>
            ) : null}
          </>
        )}
      </div>
      <button type="button" className="ui-button ui-button--ghost" onClick={openCommands}>
        {t("Open project commands")}
      </button>
    </section>
  );
}
