import { t } from "../../shared/i18n";
import { isActiveRun, type ProjectRun, taskStatus } from "./project-runner";

export function ProjectRunDetails({
  run,
  canRun,
  pending,
  onStop,
  following,
}: {
  run: ProjectRun;
  canRun: boolean;
  pending: boolean;
  onStop(id: string): void;
  following: boolean;
}) {
  return (
    <section
      className="project-runner-output"
      aria-label={t(following ? "Latest task output" : "Selected command run")}
    >
      <div className="project-runner-header">
        <h3>{run.name}</h3>
        <span role="status">{taskStatus(run.status)}</span>
        {isActiveRun(run) ? (
          <button
            type="button"
            className="ui-button ui-button--danger"
            disabled={!canRun || pending || run.status === "stopping"}
            onClick={() => onStop(run.id)}
          >
            {t("Stop project command")}
          </button>
        ) : null}
      </div>
      <p>
        {t("Run ID")}: <code>{run.id}</code>
      </p>
      {!run.historical ? <code>{run.invocation ?? `${run.manager} run ${run.name}`}</code> : null}
      <p>
        {t("Command directory")}:{" "}
        {run.directory === undefined
          ? t("Not reported by this host")
          : run.directory || t("Workspace root")}
      </p>
      {!run.historical && run.executable ? (
        <span>
          {t("Executed tool")}: {run.executable}
        </span>
      ) : null}
      {!run.historical && run.command !== run.invocation ? <code>{run.command}</code> : null}
      <p>
        {new Date(run.startedAt).toLocaleString()}
        {run.exitCode !== null ? ` · ${t("Exit code")}: ${run.exitCode}` : ""}
      </p>
      {run.finishedAt !== null ? (
        <p>
          {t("Run finished")}: {new Date(run.finishedAt).toLocaleString()}
        </p>
      ) : null}
      {run.fingerprint ? (
        <p>
          {t("Manifest fingerprint")}: <code>{run.fingerprint}</code>
        </p>
      ) : null}
      {run.historical ? (
        <p>
          {t("Saved summary only. Command text and output are not stored across host sessions.")}
        </p>
      ) : null}
      {run.status === "unknown" ? (
        <p>
          {t(
            "This host has no final result for this saved run. It may belong to another host session.",
          )}
        </p>
      ) : null}
      {!run.historical ? (
        <>
          {run.truncated ? (
            <p>{t("Output may be incomplete. Each stream retains at most its latest 64 KiB.")}</p>
          ) : null}
          <label>
            {t("Standard output")}
            <textarea
              className="ui-textarea"
              rows={12}
              readOnly
              value={run.stdout}
              spellCheck={false}
            />
          </label>
          <label>
            {t("Standard error")}
            <textarea
              className="ui-textarea"
              rows={5}
              readOnly
              value={run.stderr}
              spellCheck={false}
            />
          </label>
        </>
      ) : null}
    </section>
  );
}
