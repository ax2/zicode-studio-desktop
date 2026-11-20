import { DraftSaveAttempt } from "./DraftSaveAttempt";
import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { NotesStore } from "./notesStore";
import { IncomingDraftEditor } from "./IncomingDraftEditor";

export function NoteDraftRecovery({ store }: { store: NotesStore }) {
  const drafts = store((state) => state.recoveryDrafts);
  const error = store((state) => state.recoveryError);
  const pending = store((state) => state.recoveryPending);
  const busy = store((state) => state.recoveryBusy || state.editorLocked || state.transferBusy);
  const current = store((state) => (state.dirty ? state.selectedNote : null));
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    void store.getState().refreshDrafts();
  }, [store]);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  // Keep the collapsed recovery row mounted while typing and autosaving.
  // Transient writes must not insert/remove content above the editor.
  return (
    <section className="ui-card" aria-label={t("Local note recovery")}>
      <details>
        <summary>
          {t("Local note recovery")} · {drafts.length}
        </summary>
        <p className="ui-muted">
          {t(
            "Recovery copies stay in this browser or desktop profile. They are not a backup or device sync. Opening a draft keeps its original version; use a copy if the note has changed.",
          )}
        </p>
        <button
          className="ui-button ui-button--secondary"
          type="button"
          disabled={busy}
          onClick={() => void store.getState().refreshDrafts()}
        >
          {t("Refresh")}
        </button>
        {drafts.map((draft) => (
          <article key={draft.id}>
            <h3>{draft.title || t("Untitled note")}</h3>
            {draft.incoming && <IncomingDraftEditor draft={draft} store={store} busy={busy} pending={pending} />}
            {draft.attachmentMarkdown && (
              <p className="ui-muted">
                {t(
                  "This upload finished after leaving the note. Insert its link into the original note's current content.",
                )}
              </p>
            )}
            <p className="ui-muted">
              <time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleString()}</time>
            </p>
            {!draft.incoming && <DraftSaveAttempt key={draft.revision} draft={draft} store={store} busy={busy} pending={pending} />}
            <div className="ui-toolbar">
              {!draft.incoming && <button
                type="button"
                className="ui-button ui-button--secondary"
                disabled={
                  busy ||
                  (!draft.attachmentMarkdown &&
                    current?.id === draft.note.id &&
                    current.notebookId === draft.note.notebookId)
                }
                onClick={() => void store.getState().recoverDraft(draft.id)}
              >
                {draft.attachmentMarkdown ? t("Insert attachment link") : t("Open recovered draft")}
              </button>}
              {!draft.attachmentMarkdown && !draft.incoming && (
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  disabled={busy || pending || !!draft.saveAttemptNotebookId}
                  onClick={() => void store.getState().recoverDraft(draft.id, true)}
                >
                  {t("Save draft as new note")}
                </button>
              )}
              <button
                type="button"
                className="ui-button ui-button--ghost"
                onClick={() => store.getState().downloadDraft(draft.id)}
              >
                {t("Download draft")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--danger"
                disabled={
                  busy || (draft.incoming && pending) ||
                  (current?.id === draft.note.id && current.notebookId === draft.note.notebookId)
                }
                onClick={() => {
                  if (armed !== draft.id) {
                    setArmed(draft.id);
                    return;
                  }
                  setArmed(null);
                  void store.getState().discardDraft(draft.id);
                }}
              >
                {armed === draft.id ? t("Confirm discard draft") : t("Discard draft")}
              </button>
            </div>
          </article>
        ))}
        {pending && (
          <p role="status">
            {t("Local recovery copy is pending. Keep this window open until it finishes.")}
          </p>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
