import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import { GitDiffPanel, type GitDiffPanelProps } from "./GitDiffPanel";
import {
  type GitFile,
  type GitStatus,
  gitChangeLabel,
  gitStageError,
  gitStatusError,
  gitUnstageError,
} from "./git-status";

interface Props {
  workspaceId?: string | null;
  revision: number;
  readStatus: (workspaceId: string) => Promise<GitStatus>;
  readDiff?: GitDiffPanelProps["readDiff"];
  prepareGitReview?: GitDiffPanelProps["prepareGitReview"];
  stageFile?: (workspaceId: string, file: GitFile) => Promise<GitStatus>;
  unstageFile?: (workspaceId: string, file: GitFile) => Promise<GitStatus>;
}

export function GitStatusPanel({
  workspaceId,
  revision,
  readStatus,
  readDiff,
  prepareGitReview,
  stageFile,
  unstageFile,
}: Props) {
  const [retry, setRetry] = useState(0);
  const [indexEpoch, setIndexEpoch] = useState(0);
  const [pendingAction, setPendingAction] = useState<{
    path: string;
    kind: "stage" | "unstage";
  } | null>(null);
  const pendingRef = useRef(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    workspaceId: string;
    revision: number;
    retry: number;
    reader: Props["readStatus"];
    status?: GitStatus;
    error?: string;
  } | null>(null);
  const current =
    result?.workspaceId === workspaceId &&
    result?.revision === revision &&
    result?.retry === retry &&
    result?.reader === readStatus
      ? result
      : null;
  const loading = Boolean(workspaceId && !current);

  async function changeIndex(kind: "stage" | "unstage", file: GitFile) {
    const action = kind === "stage" ? stageFile : unstageFile;
    if (
      !workspaceId ||
      !action ||
      pendingRef.current ||
      !(kind === "stage" ? file.stageable : file.unstageable)
    )
      return;
    if (
      !window.confirm(
        `${t(kind === "stage" ? "Stage the current working tree content of this file? Git clean filters may run." : "Remove all staged changes for this file from the index? Working tree content is kept.")}\n\n${file.path}`,
      )
    )
      return;
    pendingRef.current = true;
    setPendingAction({ path: file.path, kind });
    setIndexError(null);
    try {
      const status = await action(workspaceId, file);
      setResult({ workspaceId, revision, retry, reader: readStatus, status });
      setIndexEpoch((value) => value + 1);
    } catch (reason) {
      setIndexError(kind === "stage" ? gitStageError(reason) : gitUnstageError(reason));
      setRetry((value) => value + 1);
      setIndexEpoch((value) => value + 1);
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void readStatus(workspaceId).then(
      (status) => {
        if (active) setResult({ workspaceId, revision, retry, reader: readStatus, status });
      },
      (reason) => {
        if (active)
          setResult({
            workspaceId,
            revision,
            retry,
            reader: readStatus,
            error: gitStatusError(reason),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceId, revision, retry, readStatus]);

  return (
    <section className="ui-panel project-git" aria-label={t("Git workspace")} aria-busy={loading}>
      <header className="project-git-header">
        <h2>{t("Git workspace")}</h2>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={!workspaceId || loading || pendingAction !== null}
          onClick={() => {
            setIndexError(null);
            setRetry((value) => value + 1);
          }}
        >
          {t("Refresh Git status")}
        </button>
      </header>
      <div role={current?.status ? undefined : "status"}>
        {indexError ? <p role="alert">{indexError}</p> : null}
        {!workspaceId ? (
          <p>{t("Open a project folder to inspect Git changes.")}</p>
        ) : loading ? (
          <p>{t("Reading Git status…")}</p>
        ) : current?.error ? (
          <p>{current.error}</p>
        ) : current?.status ? (
          <GitDetails
            status={current.status}
            workspaceId={workspaceId}
            readDiff={readDiff}
            prepareGitReview={prepareGitReview}
            stageFile={stageFile ? (file) => changeIndex("stage", file) : undefined}
            unstageFile={unstageFile ? (file) => changeIndex("unstage", file) : undefined}
            pendingAction={pendingAction}
            indexEpoch={indexEpoch}
          />
        ) : null}
      </div>
    </section>
  );
}

function GitDetails({
  status,
  workspaceId,
  readDiff,
  prepareGitReview,
  stageFile,
  unstageFile,
  pendingAction,
  indexEpoch,
}: {
  status: GitStatus;
  workspaceId?: string | null;
  readDiff?: GitDiffPanelProps["readDiff"];
  prepareGitReview?: GitDiffPanelProps["prepareGitReview"];
  stageFile?: (file: GitFile) => Promise<void>;
  unstageFile?: (file: GitFile) => Promise<void>;
  pendingAction: { path: string; kind: "stage" | "unstage" } | null;
  indexEpoch: number;
}) {
  if (!status.isRepository) return <p>{t("This project is not a Git working tree.")}</p>;
  const counts: Array<[string, number]> = [
    ["Staged", status.staged],
    ["Unstaged", status.unstaged],
    ["Untracked", status.untracked],
    ["Conflicts", status.conflicts],
  ];
  return (
    <>
      <p className="project-git-branch">
        <strong>
          {status.branch === "(detached)"
            ? t("Detached HEAD")
            : status.branch || t("Unknown branch")}
        </strong>
        {status.upstream ? (
          <span>
            {status.upstream} · {t("Ahead")} {status.ahead} · {t("Behind")} {status.behind}
          </span>
        ) : (
          <span>{t("No upstream configured")}</span>
        )}
      </p>
      <p className="project-git-hint">
        {t(
          "Changes within this project folder. Upstream counts use local refs; no fetch is performed. Submodule contents are not inspected.",
        )}
      </p>
      <dl className="project-git-counts">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {workspaceId && readDiff ? (
        <GitDiffPanel
          key={indexEpoch}
          workspaceId={workspaceId}
          readDiff={readDiff}
          prepareGitReview={prepareGitReview}
        />
      ) : null}
      {status.totalFiles === 0 ? (
        <p>{t("No changes in this project folder.")}</p>
      ) : (
        <ul className="project-git-files" aria-label={t("Changed files")}>
          {status.files.map((file) => (
            <li key={file.path}>
              <div className="project-git-file-heading">
                <span className="project-git-path">
                  {file.originalPath ? `${file.originalPath} → ` : ""}
                  {file.path}
                </span>
                {file.stageable && stageFile ? (
                  <button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm"
                    disabled={pendingAction !== null}
                    aria-busy={pendingAction?.kind === "stage" && pendingAction.path === file.path}
                    onClick={() => void stageFile(file)}
                  >
                    {pendingAction?.kind === "stage" && pendingAction.path === file.path
                      ? t("Staging…")
                      : t("Stage file")}
                  </button>
                ) : null}
                {file.unstageable && unstageFile ? (
                  <button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm"
                    disabled={pendingAction !== null}
                    aria-busy={
                      pendingAction?.kind === "unstage" && pendingAction.path === file.path
                    }
                    onClick={() => void unstageFile(file)}
                  >
                    {pendingAction?.kind === "unstage" && pendingAction.path === file.path
                      ? t("Unstaging…")
                      : t("Unstage file")}
                  </button>
                ) : null}
              </div>
              <span className="project-git-file-status">
                {t("Index")}: {gitChangeLabel(file.indexStatus)} · {t("Working tree")}:{" "}
                {gitChangeLabel(file.worktreeStatus)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {status.truncated ? (
        <p>{t("Showing the first 200 changed entries. Counts include all reported entries.")}</p>
      ) : null}
      {status.untracked > 0 ? (
        <p className="project-git-hint">{t("Untracked directories are grouped as one entry.")}</p>
      ) : null}
    </>
  );
}
