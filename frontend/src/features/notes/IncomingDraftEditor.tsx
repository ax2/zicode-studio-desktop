import { DraftSaveAttempt } from "./DraftSaveAttempt";
import { useId, useState } from "react";
import { t } from "../../shared/i18n";
import type { NoteDraft } from "./draft-repository";
import type { NotesStore } from "./notesStore";

export function IncomingDraftEditor({ draft, store, busy, pending }: { draft: NoteDraft; store: NotesStore; busy: boolean; pending: boolean }) {
  const id = useId();
  const notebooks = store((state) => state.snapshot.notebooks);
  const [notebookId, setNotebookId] = useState("");
  const validTarget = notebooks.some((book) => book.id === notebookId);
  return <div className="notes-incoming-draft">
    <label htmlFor={`${id}-title`}>{t("Note title")}</label>
    <input id={`${id}-title`} className="ui-input" value={draft.title} disabled={busy}
      onChange={(event) => store.getState().updateIncomingDraft(draft.id, { title: event.target.value })} />
    <label htmlFor={`${id}-content`}>{t("Note content")}</label>
    <textarea id={`${id}-content`} className="ui-textarea" rows={8} value={draft.content} disabled={busy} translate="no"
      onChange={(event) => store.getState().updateIncomingDraft(draft.id, { content: event.target.value })} />
    <label htmlFor={`${id}-notebook`}>{t("Destination notebook")}</label>
    <select id={`${id}-notebook`} className="ui-select" value={validTarget ? notebookId : ""} disabled={busy}
      onChange={(event) => setNotebookId(event.target.value)}>
      <option value="">{t("Choose a notebook")}</option>
      {notebooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
    </select>
    <DraftSaveAttempt key={draft.revision} draft={draft} store={store} busy={busy} pending={pending} />
    <button type="button" className="ui-button ui-button--secondary" disabled={busy || pending || !validTarget || !!draft.saveAttemptNotebookId}
      onClick={() => void store.getState().saveIncomingDraft(draft.id, notebookId)}>{t("Save draft as new note")}</button>
  </div>;
}
