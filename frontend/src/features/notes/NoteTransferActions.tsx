import { t } from "../../shared/i18n";
import type { NotesStore } from "./notesStore";

export function NoteTransferActions({ store }: { store: NotesStore }) {
  const busy = store((state) => state.transferBusy);
  const actions = [
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
      {busy ? <p role="status">{t("Notes import or export in progress…")}</p> : null}
    </div>
  );
}
