import { useCallback, useState } from "react";
import { t } from "../../shared/i18n";
import { type ModelPlan, ModelPlanFields } from "./NovelModelPlan";
import { type CharacterRequest, type RecordPage, useCharacterRecords } from "./useCharacterRecords";

type Job = {
  id: string;
  state: string;
  plan: ModelPlan;
  result: { text: string } | null;
  archivedDraftId: string | null;
};

function ReviewJob({
  job,
  request,
  onSaved,
  disabled,
}: {
  job: Job;
  request: CharacterRequest;
  onSaved: () => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(job.result?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [draftId] = useState(() => crypto.randomUUID());
  async function checkOrCancel(cancel: boolean) {
    setBusy(true);
    setError("");
    try {
      if (cancel) {
        const result = (await request({
          kind: "modelJob",
          action: { kind: "cancel", id: job.id },
        })) as { cancelRequested: boolean };
        setStatusMessage(
          t(
            result.cancelRequested
              ? "Cancellation requested. The provider may already have received this request."
              : "This process has no active request to cancel.",
          ),
        );
        setActive(false);
      } else {
        const result = (await request({
          kind: "modelJob",
          action: { kind: "status", id: job.id },
        })) as { active: boolean; job: Job | null };
        if (result.job && result.job.state !== job.state) onSaved();
        setActive(result.active);
        setStatusMessage(
          t(
            result.active
              ? "This request is active in Studio."
              : "No active request in this process. The remote outcome is unknown.",
          ),
        );
      }
    } catch {
      setError(t("Could not read saved model tasks."));
    } finally {
      setBusy(false);
    }
  }
  async function adopt() {
    setBusy(true);
    setError("");
    try {
      await request({
        kind: "modelJob",
        action: { kind: "adopt", selection: { jobId: job.id, draftId, text } },
      });
      onSaved();
    } catch (reason) {
      const code = String(reason);
      setError(
        t(
          code.includes("chapter_changed")
            ? "The chapter changed. Prepare a draft from the new revision."
            : code.includes("revision_changed")
              ? "The character version changed. Review it before preparing a new draft."
              : "Could not save the reviewed model suggestion.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        {job.plan.evidence.chapterTitle} · {job.plan.model.model} ·{" "}
        {job.archivedDraftId
          ? t("Saved as draft")
          : job.state === "ready"
            ? t("Ready for review")
            : job.state === "rejected"
              ? t("Suggestion unavailable")
              : t("Outcome unknown")}
      </summary>
      <ModelPlanFields plan={job.plan} />
      {job.state === "unknown" && (
        <>
          <button
            type="button"
            className="ui-button"
            disabled={disabled || busy}
            onClick={() => void checkOrCancel(false)}
          >
            {t("Check request status")}
          </button>
          {active && (
            <button
              type="button"
              className="ui-button"
              disabled={disabled || busy}
              onClick={() => void checkOrCancel(true)}
            >
              {t("Cancel active request")}
            </button>
          )}
          {statusMessage && <p role="status">{statusMessage}</p>}
        </>
      )}
      {job.result?.text && (
        <>
          <h4>{t("Original model suggestion")}</h4>
          <p className="visual-assets-backup-path">{job.result.text}</p>
        </>
      )}
      {job.state === "ready" && !job.archivedDraftId && job.result && (
        <>
          <label>
            {t("Author's reviewed text")}
            <textarea
              className="ui-textarea"
              value={text}
              maxLength={4000}
              disabled={busy || disabled}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ui-button"
            disabled={busy || disabled || !text.trim()}
            onClick={() => void adopt()}
          >
            {t("Save reviewed text as a draft")}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

export function NovelModelHistory({
  characterId,
  request,
  onSaved,
  disabled,
}: {
  characterId: string;
  request: CharacterRequest;
  onSaved: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        className="ui-button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {t("Saved model tasks")}
      </button>
      {open && (
        <History
          characterId={characterId}
          request={request}
          onSaved={onSaved}
          disabled={disabled}
        />
      )}
    </section>
  );
}

function History({
  characterId,
  request,
  onSaved,
  disabled,
}: {
  characterId: string;
  request: CharacterRequest;
  onSaved: () => void;
  disabled: boolean;
}) {
  const read = useCallback(
    async (before?: number) =>
      (await request({
        kind: "modelJob",
        action: { kind: "history", characterId, before },
      })) as RecordPage<Job, number>,
    [characterId, request],
  );
  const records = useCharacterRecords(read);
  return (
    <>
      <button
        type="button"
        className="ui-button"
        disabled={disabled || records.loading}
        onClick={records.reload}
      >
        {t("Refresh model tasks")}
      </button>
      {records.error && <p role="alert">{t("Could not read saved model tasks.")}</p>}
      {records.page?.entries.length === 0 && <p>{t("No saved model tasks.")}</p>}
      {records.page?.entries.map((job) => (
        <ReviewJob
          key={job.id + job.state}
          job={job}
          request={request}
          disabled={disabled || records.loading}
          onSaved={() => {
            records.reload();
            onSaved();
          }}
        />
      ))}
      {records.page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={disabled || records.loading}
          onClick={() => void records.more()}
        >
          {t("Load older model tasks")}
        </button>
      )}
    </>
  );
}

export function ArchivedSuggestion({
  id,
  request,
  disabled,
}: {
  id: string;
  request: CharacterRequest;
  disabled: boolean;
}) {
  const [source, setSource] = useState<{ plan: ModelPlan; result: { text: string } }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    setBusy(true);
    setError(false);
    try {
      const result = (await request({ kind: "modelSource", id })) as {
        source: { plan: ModelPlan; result: { text: string } } | null;
      };
      if (!result.source) throw new Error("missing");
      setSource(result.source);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {source ? (
        <>
          <h4>{t("Original model suggestion")}</h4>
          <p className="visual-assets-backup-path">{source.result.text}</p>
          <ModelPlanFields plan={source.plan} />
        </>
      ) : (
        <button
          type="button"
          className="ui-button"
          disabled={disabled || busy}
          onClick={() => void load()}
        >
          {t("View archived model source")}
        </button>
      )}
      {error && <p role="alert">{t("Could not read archived model source.")}</p>}
    </>
  );
}
