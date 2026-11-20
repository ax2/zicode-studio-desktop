import { t } from "../../shared/i18n";
import type { NotesStore } from "./notesStore";

export function NoteRelationshipStatus({ store }: { store: NotesStore }) {
  const loading = store((state) => state.relationshipLoading);
  const error = store((state) => state.relationshipError);
  const incomplete = store((state) => state.relationshipIncomplete);
  const dirty = store((state) => state.dirty);
  return (
    <>
      {/* Reserve both message sizes so routine save/refresh state changes
          cannot resize the flexing editor above this row. */}
      <p className="notes-relationship-status" role="status">
        <span data-active={dirty && !loading} aria-hidden={!dirty || loading}>
          {t("Relationships reflect saved notes. Save your edits to refresh them.")}
        </span>
        <span data-active={loading} aria-hidden={!loading}>
          {t("Loading note relationships…")}
        </span>
      </p>
      {incomplete ? (
        <p role="status">
          {t(
            "The note index reached its scan limit. Some relationships are omitted, and title links are not inferred.",
          )}
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>
            {error === t("Could not load note relationships.")
              ? error
              : `${t("Could not load note relationships.")} ${error}`}
          </p>
          <button
            type="button"
            className="ui-button ui-button--ghost"
            disabled={loading}
            onClick={() => {
              const note = store.getState().selectedNote;
              if (note) void store.getState().loadBacklinks(note);
            }}
          >
            {t("Retry")}
          </button>
        </div>
      ) : null}
    </>
  );
}
