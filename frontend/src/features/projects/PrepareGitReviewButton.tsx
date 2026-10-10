import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { type GitReviewSource, gitReviewDraft, type PrepareGitReview } from "./git-review";

export function PrepareGitReviewButton({
  workspace,
  source,
  prepare,
}: {
  workspace: string;
  source: GitReviewSource;
  prepare: PrepareGitReview;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function handoff() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await prepare(gitReviewDraft(workspace, source));
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      {failed ? <p role="alert">{t("Could not prepare the review draft")}</p> : null}
      <p className="project-git-hint">
        {t(
          "Add this displayed diff and its comparison details to the current project's chat draft. Review and send it yourself; the existing draft is preserved.",
        )}
      </p>
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void handoff()}
      >
        {t("Prepare review in chat")}
      </button>
    </div>
  );
}
