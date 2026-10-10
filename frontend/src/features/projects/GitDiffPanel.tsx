import { useId, useState } from "react";
import { t } from "../../shared/i18n.js";
import type { PrepareGitReview } from "./git-review";
import type { GitDiff, GitDiffMode } from "./git-status";
import { PrepareGitReviewButton } from "./PrepareGitReviewButton";
import { useWorkspaceDiff } from "./use-workspace-diff";

export interface GitDiffPanelProps {
  workspaceId: string;
  readDiff: (workspaceId: string, mode: GitDiffMode) => Promise<GitDiff>;
  prepareGitReview?: PrepareGitReview;
}

export function GitDiffPanel({ workspaceId, readDiff, prepareGitReview }: GitDiffPanelProps) {
  const [mode, setMode] = useState<GitDiffMode | null>(null);
  const [revision, setRevision] = useState(0);
  const regionId = useId();
  const current = useWorkspaceDiff(workspaceId, mode, revision, readDiff);

  function select(next: GitDiffMode) {
    setMode(next);
    setRevision((value) => value + 1);
  }

  return (
    <section className="project-git-diff" aria-label={t("Review Git changes")}>
      <div className="project-git-diff-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          aria-pressed={mode === "unstaged"}
          aria-controls={regionId}
          onClick={() => select("unstaged")}
        >
          {t("View unstaged diff")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          aria-pressed={mode === "staged"}
          aria-controls={regionId}
          onClick={() => select("staged")}
        >
          {t("View staged diff")}
        </button>
        {mode ? (
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={() => setMode(null)}
          >
            {t("Close diff")}
          </button>
        ) : null}
      </div>
      <div id={regionId} aria-busy={Boolean(mode && !current)}>
        {mode ? (
          <>
            <p>
              {mode === "staged"
                ? t("Index compared with HEAD. Untracked files are not included.")
                : t("Working tree compared with the index. Untracked files are not included.")}
            </p>
            <p role="status">
              {!current
                ? t("Loading Git diff…")
                : current.error ||
                  (current.diff?.truncated
                    ? t(
                        "Diff preview was truncated. Use your Git client to review the complete changes.",
                      )
                    : current.diff?.patch
                      ? t("Git diff loaded")
                      : t("No changes in this comparison."))}
            </p>
            {current?.diff?.patch ? (
              <textarea
                className="ui-textarea project-git-patch"
                readOnly
                rows={16}
                wrap="off"
                value={current.diff.patch}
                aria-label={t("Git diff content")}
              />
            ) : null}
            {current?.diff && current.receivedAt ? (
              <p className="project-git-hint">
                {t("Preview received")}:{" "}
                <time dateTime={current.receivedAt}>
                  {new Date(current.receivedAt).toLocaleString()}
                </time>
                {" · "}
                {t(
                  "Files, index and HEAD may have changed. Select the comparison again to refresh before review.",
                )}
              </p>
            ) : null}
            {current?.diff?.patch && current.receivedAt && prepareGitReview ? (
              <PrepareGitReviewButton
                key={`${workspaceId}:${mode}:${revision}`}
                workspace={workspaceId}
                source={{ kind: "workspace", diff: current.diff, receivedAt: current.receivedAt }}
                prepare={prepareGitReview}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
