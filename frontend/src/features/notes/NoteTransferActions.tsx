import { t } from "../../shared/i18n";
import type { NotesStore } from "./notesStore";

export function NoteTransferActions({ store }: { store: NotesStore }) {
  const busy = store((state) => state.transferBusy);
  const external = store((state) => state.externalImport);
  const actions = [
    [t("Import from Joplin"), "selectExternalImport"],
    [t("Import Markdown"), "importMarkdown"],
    [t("Export readable backup"), "exportBackup"],
    [t("Export all notebooks backup"), "exportAllBackup"],
    [t("Import backup"), "importBackup"],
    [t("Import all notebooks backup"), "importAllBackup"],
  ] as const;
  return (
    <div aria-busy={busy}>
      {actions.map(([label, action]) => (
        <button
          key={action}
          type="button"
          className="notes-nav-button"
          disabled={busy}
          onClick={() => void store.getState()[action]()}
        >
          {label}
        </button>
      ))}
      {external && (
        <section aria-label={t("Joplin import preview")}>
          <h3>{t("Joplin import preview")}</h3>
          <p>{external.file.name}</p>
          <p>{t("Import creates new copies. Existing notebooks keep their content.")}</p>
          <ul>
            {external.report.preview.map((book) => (
              <li key={book.id}>
                <strong>{book.title}</strong>
                {" · "}{t("Notes")} {book.noteCount}
                {" · "}{t("Attachments")} {book.attachmentCount}
                {book.titleExists && <span>{" · "}{t("Same title exists")}</span>}
              </li>
            ))}
          </ul>
          {external.report.warnings.length > 0 && (
            <details>
              <summary>{t("Items requiring review")} ({external.report.warnings.length})</summary>
              <ul>
                {external.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </details>
          )}
          <button type="button" disabled={busy} onClick={() => void store.getState().commitExternalImport()}>
            {t("Import Joplin notebooks")}
          </button>
          <button type="button" disabled={busy} onClick={() => store.getState().cancelExternalImport()}>
            {t("Cancel")}
          </button>
        </section>
      )}
      {busy ? <p role="status">{t("Notes import or export in progress…")}</p> : null}
    </div>
  );
}
