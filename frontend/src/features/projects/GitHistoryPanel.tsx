import { useEffect, useId, useState } from "react";
import { t } from "../../shared/i18n";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { ReadCommitDiff } from "./commit-diff";
import {
  type GitHistory,
  type GitHistoryCursor,
  gitHistoryError,
  type ReadGitHistory,
} from "./git-history";
import type { PrepareGitReview } from "./git-review";

export function GitHistoryPanel({
  workspaceId,
  revision,
  readHistory,
  readCommitDiff,
  prepareGitReview,
}: {
  workspaceId?: string | null;
  revision: number;
  readHistory: ReadGitHistory;
  readCommitDiff: ReadCommitDiff;
  prepareGitReview: PrepareGitReview;
}) {
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<{
    workspace: string;
    revision: number;
    reader: ReadGitHistory;
    cursor: GitHistoryCursor;
  } | null>(null);
  const cursor =
    page &&
    page.workspace === workspaceId &&
    page.revision === revision &&
    page.reader === readHistory
      ? page.cursor
      : undefined;
  const [result, setResult] = useState<{
    workspace: string;
    revision: number;
    retry: number;
    reader: ReadGitHistory;
    cursor?: GitHistoryCursor;
    history?: GitHistory;
    error?: string;
  } | null>(null);
  const id = useId();
  const current =
    result?.workspace === workspaceId &&
    result?.revision === revision &&
    result?.retry === retry &&
    result?.reader === readHistory &&
    result?.cursor === cursor
      ? result
      : null;
  const loading = Boolean(expanded && workspaceId && !current);
  useEffect(() => {
    if (!expanded || !workspaceId) return;
    let active = true;
    const scope = { workspace: workspaceId, revision, retry, reader: readHistory, cursor };
    void (cursor ? readHistory(workspaceId, cursor) : readHistory(workspaceId)).then(
      (history) => {
        if (active) setResult({ ...scope, history });
      },
      (error) => {
        if (active) setResult({ ...scope, error: gitHistoryError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [expanded, workspaceId, revision, retry, readHistory, cursor]);

  return (
    <section className="ui-panel project-git" aria-label={t("Recent commits")}>
      <header className="project-git-header">
        <h2>{t("Recent commits")}</h2>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={!workspaceId}
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            setPage(null);
            setRetry((value) => value + 1);
          }}
        >
          {expanded ? t("Hide commit history") : t("View commit history")}
        </button>
        {expanded ? (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={!workspaceId || loading}
            onClick={() => {
              setPage(null);
              setRetry((value) => value + 1);
            }}
          >
            {t("Refresh commit history")}
          </button>
        ) : null}
      </header>
      <div id={id} aria-busy={loading}>
        {!workspaceId ? (
          <p>{t("Open a project folder to inspect Git changes.")}</p>
        ) : expanded ? (
          <>
            <p className="project-git-hint">
              {t(
                "Each page shows up to 50 commits affecting this project folder. Pages follow the HEAD captured at the first read; refresh to follow the current branch. Only local history is read, so shallow or partial clones may be incomplete.",
              )}
            </p>
            {loading ? (
              <p role="status">{t("Reading commit history…")}</p>
            ) : current?.error ? (
              <p role="alert">{current.error}</p>
            ) : current?.history ? (
              <HistoryDetails
                history={current.history}
                workspace={workspaceId}
                readCommitDiff={readCommitDiff}
                prepareGitReview={prepareGitReview}
              />
            ) : null}
            {workspaceId && (cursor || current?.history?.nextCursor) ? (
              <nav className="project-git-diff-actions" aria-label={t("Commit history pages")}>
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  disabled={loading || !cursor || cursor.offset === 0}
                  onClick={() => {
                    if (cursor && cursor.offset >= 50)
                      setPage({
                        workspace: workspaceId,
                        revision,
                        reader: readHistory,
                        cursor: { head: cursor.head, offset: cursor.offset - 50 },
                      });
                  }}
                >
                  {t("Newer commits")}
                </button>
                <span>
                  {t("History page")}: {(cursor?.offset ?? 0) / 50 + 1}
                </span>
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  disabled={loading || !current?.history?.nextCursor}
                  onClick={() => {
                    const next = current?.history?.nextCursor;
                    if (next)
                      setPage({
                        workspace: workspaceId,
                        revision,
                        reader: readHistory,
                        cursor: next,
                      });
                  }}
                >
                  {t("Older commits")}
                </button>
              </nav>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function HistoryDetails({
  history,
  workspace,
  readCommitDiff,
  prepareGitReview,
}: {
  history: GitHistory;
  workspace: string;
  readCommitDiff: ReadCommitDiff;
  prepareGitReview: PrepareGitReview;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      {history.head ? (
        <p className="project-git-path">
          {t("HEAD at last read")}: <code>{history.head}</code>
        </p>
      ) : null}
      {!history.commits.length ? (
        <p role="status">
          {history.head
            ? t("No commits affecting this folder were found in the local history.")
            : t("This branch has no commits yet.")}
        </p>
      ) : (
        <ol className="project-git-files">
          {history.commits.map((commit) => (
            <li key={commit.oid}>
              <details
                onToggle={(event) => {
                  if (!event.currentTarget.open)
                    setSelected((value) => (value === commit.oid ? null : value));
                }}
              >
                <summary className="project-git-path">
                  <strong>
                    {commit.message.split(/\r?\n/, 1)[0] || t("Commit without a message")}
                  </strong>
                </summary>
                <p className="project-git-path">
                  <code>{commit.oid}</code>
                </p>
                <p>
                  {t("Commit author")}: {commit.author} ·{" "}
                  <time dateTime={commit.authoredAt}>
                    {new Date(commit.authoredAt).toLocaleString()}
                  </time>
                </p>
                {commit.truncated ? (
                  <p role="status">
                    {t(
                      "Commit text was truncated. Use your Git client to read the complete message and author.",
                    )}
                  </p>
                ) : null}
                <textarea
                  className="ui-textarea project-git-patch"
                  readOnly
                  rows={6}
                  value={commit.message}
                  aria-label={t("Commit message")}
                />
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  aria-expanded={selected === commit.oid}
                  onClick={() => setSelected(selected === commit.oid ? null : commit.oid)}
                >
                  {selected === commit.oid ? t("Close commit diff") : t("View commit changes")}
                </button>
                {selected === commit.oid ? (
                  <CommitDiffPanel
                    key={commit.oid}
                    workspace={workspace}
                    oid={commit.oid}
                    readDiff={readCommitDiff}
                    prepareGitReview={prepareGitReview}
                  />
                ) : null}
              </details>
            </li>
          ))}
        </ol>
      )}
      {history.hasMore && !history.nextCursor ? (
        <p>{t("More commits are available. Use your Git client to explore older history.")}</p>
      ) : null}
    </>
  );
}
