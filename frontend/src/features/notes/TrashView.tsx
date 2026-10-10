import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { DEFAULT_NOTE_ICON, formatDate, type TrashEntry } from "./notesLogic";
import type { NotesStore } from "./notesStore";
import { trashEntryKey } from "./trash-actions";

export function TrashView({ store }: { store: NotesStore }) {
  const trash = store((state) => state.trash);
  const trashLoading = store((state) => state.trashLoading);
  const trashLoaded = store((state) => state.trashLoaded);
  const trashError = store((state) => state.trashError);
  const snapshot = store((state) => state.snapshot);
  const setMode = store((state) => state.setMode);
  const busy = store((state) => state.trashBusy);
  const [armed, setArmed] = useState<string | null>(null);
  const emptyKey = JSON.stringify(trash.map(trashEntryKey));
  const emptyArmed = armed === emptyKey;
  useEffect(() => {
    void store.getState().loadTrash();
  }, [store]);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  const purge = (entry: TrashEntry) => {
    const key = trashEntryKey(entry);
    if (armed !== key) {
      setArmed(key);
      return;
    }
    setArmed(null);
    void store.getState().purgeFromTrash(entry);
  };
  const empty = () => {
    if (!emptyArmed) {
      setArmed(emptyKey);
      return;
    }
    setArmed(null);
    void store.getState().emptyTrash();
  };

  return (
    <section className="notes-state-panel notes-trash-panel ui-card">
      <div className="notes-trash-header">
        <h1>{t("Trash")}</h1>
        <div className="notes-trash-actions">
          {trash.length > 0 ? (
            <button
              type="button"
              className={`ui-button ui-button--danger ui-button--sm notes-trash-empty${
                emptyArmed ? " notes-delete-armed" : ""
              }`}
              disabled={trashLoading || busy || !trashLoaded}
              onClick={empty}
            >
              {emptyArmed ? t("Confirm empty trash") : t("Empty trash")}
            </button>
          ) : null}
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={() => setMode("library")}
          >
            {t("All notes")}
          </button>
        </div>
      </div>
      {trashError ? (
        <div className="notes-error-banner" role="alert">
          <span className="notes-error-inline">
            {trashError}
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              disabled={busy || trashLoading}
              onClick={() => {
                setArmed(null);
                void store.getState().loadTrash();
              }}
            >
              {t("Retry")}
            </button>
          </span>
        </div>
      ) : null}
      <p className="ui-muted">
        {t(
          "Empty trash permanently deletes only the items currently displayed. Other items are not included in this batch.",
        )}{" "}
        {t(
          "Older items without a known deletion date are kept for 30 days from first recognition.",
        )}
      </p>
      {busy && <p role="status">{t("Updating trash…")}</p>}
      {trashLoading ? <p className="notes-nav-message">{t("Loading trash…")}</p> : null}
      {trashLoaded && !trashLoading && !busy && !trashError && trash.length === 0 ? (
        <p className="notes-nav-message">{t("Trash is empty")}</p>
      ) : null}
      <div className="notes-trash-list">
        {trash.map((entry) => (
          <div key={trashEntryKey(entry)} className="notes-trash-item">
            <span className="notes-note-icon" aria-hidden="true">
              {entry.note.icon || DEFAULT_NOTE_ICON}
            </span>
            <span className="notes-list-item-main">
              <strong>{entry.note.title}</strong>
              <span>
                {snapshot.notebooks.find((notebook) => notebook.id === entry.notebookId)?.title ??
                  entry.notebookTitle ??
                  ""}
                {snapshot.notebooks.some((notebook) => notebook.id === entry.notebookId)
                  ? " · "
                  : entry.notebookTitle
                    ? " · "
                    : ""}
                {entry.deletionTimeKnown === false ? t("Retention started") : t("Deleted")}{" "}
                {formatDate(entry.deletedAt)}
              </span>
            </span>
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm notes-trash-restore"
              disabled={trashLoading || busy || !trashLoaded}
              onClick={() => void store.getState().restoreFromTrash(entry)}
            >
              {t("Restore")}
            </button>
            <button
              type="button"
              className={`ui-button ui-button--danger ui-button--sm notes-trash-purge${
                armed === trashEntryKey(entry) ? " notes-delete-armed" : ""
              }`}
              disabled={trashLoading || busy || !trashLoaded}
              onClick={() => purge(entry)}
            >
              {armed === trashEntryKey(entry)
                ? t("Confirm permanently delete")
                : t("Delete permanently")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
