import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { type CommitDiff, commitDiffError, type ReadCommitDiff } from "./commit-diff";
import type { PrepareGitReview } from "./git-review";
import { PrepareGitReviewButton } from "./PrepareGitReviewButton";

export function CommitDiffPanel({
  workspace,
  oid,
  readDiff,
  prepareGitReview,
}: {
  workspace: string;
  oid: string;
  readDiff: ReadCommitDiff;
  prepareGitReview?: PrepareGitReview;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    workspace: string;
    oid: string;
    retry: number;
    reader: ReadCommitDiff;
    diff?: CommitDiff;
    error?: string;
  } | null>(null);
  const current =
    result?.workspace === workspace &&
    result.oid === oid &&
    result.retry === retry &&
    result.reader === readDiff
      ? result
      : null;
  useEffect(() => {
    let active = true;
    const scope = { workspace, oid, retry, reader: readDiff };
    void readDiff(workspace, oid).then(
      (diff) => {
        if (active) setResult({ ...scope, diff });
      },
      (error) => {
        if (active) setResult({ ...scope, error: commitDiffError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [workspace, oid, retry, readDiff]);
  return (
    <section aria-label={t("Commit changes")} aria-busy={!current}>
      <p className="project-git-hint">
        {t(
          "Changes are limited to this project folder. Renames appear as deletion and addition; binary contents and submodule internals are not shown.",
        )}
      </p>
      {!current ? (
        <p role="status">{t("Loading commit diff…")}</p>
      ) : current.error ? (
        <>
          <p role="alert">{current.error}</p>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Retry")}
          </button>
        </>
      ) : current.diff ? (
        <>
          <p>
            {current.diff.parentCount === 0
              ? t("Root commit compared with an empty tree.")
              : current.diff.parentCount > 1
                ? t("Merge commit compared with its first parent only.")
                : t("Commit compared with its parent.")}
          </p>
          {current.diff.parent ? (
            <p className="project-git-path">
              {t("Comparison parent")}: <code>{current.diff.parent}</code>
            </p>
          ) : null}
          {current.diff.truncated ? (
            <p role="status">
              {t("Diff preview was truncated. Use your Git client to review the complete changes.")}
            </p>
          ) : null}
          {current.diff.patch ? (
            <textarea
              className="ui-textarea project-git-patch"
              rows={16}
              readOnly
              wrap="off"
              value={current.diff.patch}
              aria-label={t("Commit diff content")}
            />
          ) : !current.diff.truncated ? (
            <p role="status">{t("No changes in this comparison.")}</p>
          ) : null}
          {current.diff.patch && prepareGitReview ? (
            <PrepareGitReviewButton
              workspace={workspace}
              source={{ kind: "commit", diff: current.diff }}
              prepare={prepareGitReview}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
