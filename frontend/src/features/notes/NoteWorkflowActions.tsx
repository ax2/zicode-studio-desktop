import { t } from "../../shared/i18n";
import type { NotesStore } from "./notesStore";

export function NoteWorkflowActions({ store }: { store: NotesStore }) {
  const busy = store((state) => state.workflowBusy);
  const disabled = store((state) =>
    Boolean(state.workflowBusy || state.editorLocked || state.transferBusy),
  );
  return (
    <div aria-busy={Boolean(busy)}>
      <button
        type="button"
        className="notes-nav-button"
        disabled={disabled}
        onClick={() => void store.getState().rebuildIndex()}
      >
        {t("Check and rebuild Vault")}
      </button>
      <button
        type="button"
        className="notes-nav-button"
        disabled={disabled}
        onClick={() => void store.getState().publishAstro()}
      >
        {t("Build Astro site")}
      </button>
      {busy ? (
        <p role="status">
          {busy === "build"
            ? t("Preparing or building the Astro site…")
            : busy === "rebuild"
              ? t("Checking the notebook…")
              : t("Preparing Chat handoff…")}
        </p>
      ) : null}
    </div>
  );
}
