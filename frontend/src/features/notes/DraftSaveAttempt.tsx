import { useState } from "react";
import { t } from "../../shared/i18n";
import type { NoteDraft } from "./draft-repository";
import type { NotesStore } from "./notesStore";

export function DraftSaveAttempt({ draft, store, busy, pending }: { draft: NoteDraft; store: NotesStore; busy: boolean; pending: boolean }) {
  const notebooks = store((state) => state.snapshot.notebooks);
  const [checked, setChecked] = useState(false);
  if (!draft.saveAttemptNotebookId) return null;
  const notebook = notebooks.find((book) => book.id === draft.saveAttemptNotebookId);
  return <div role="alert">
    <p>{t("The save result is uncertain. Check the destination notebook before retrying.")}</p>
    <p>{t("Destination notebook")}: {notebook?.title ?? t("Notebook unavailable")}</p>
    <label><input type="checkbox" checked={checked} disabled={busy || pending} onChange={(event) => setChecked(event.target.checked)} />
      {t("I checked the destination notebook and want to allow another attempt.")}</label>
    <button type="button" className="ui-button ui-button--secondary" disabled={busy || pending || !checked}
      onClick={() => { setChecked(false); void store.getState().acknowledgeDraftSave(draft.id); }}>{t("Allow another attempt")}</button>
  </div>;
}
