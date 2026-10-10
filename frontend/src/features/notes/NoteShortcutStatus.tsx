import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { NotesStore } from "./notesStore";

export function NoteShortcutStatus({ store }: { store: NotesStore }) {
  const loading = store((state) => state.shortcutsLoading);
  const error = store((state) => state.shortcutsError);
  const storageError = store((state) => state.shortcutsStorageError);
  const older = store((state) => state.olderShortcutsAvailable);
  const [recovering, setRecovering] = useState(false);
  const [clear, setClear] = useState<"recent" | "pinned" | null>(null);
  useEffect(() => {
    if (!clear) return;
    const timer = setTimeout(() => setClear(null), 4000);
    return () => clearTimeout(timer);
  }, [clear]);
  return (
    <>
      {loading && (
        <p className="ui-muted" role="status">
          {t("Loading note shortcuts…")}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {storageError && <p role="alert">{storageError}</p>}
      <button
        type="button"
        className="notes-nav-button"
        disabled={loading || recovering}
        onClick={() => void store.getState().refreshShortcuts()}
      >
        {t("Refresh shortcuts")}
      </button>
      {older && (
        <button
          type="button"
          className="notes-nav-button"
          disabled={loading || recovering}
          onClick={async () => {
            setRecovering(true);
            try {
              await store.getState().importOlderShortcuts();
            } finally {
              setRecovering(false);
            }
          }}
        >
          {recovering ? t("Recovering older shortcuts…") : t("Recover older shortcuts")}
        </button>
      )}
      <details>
        <summary>{t("Manage note shortcuts")}</summary>
        {(["recent", "pinned"] as const).map((list) => (
          <button
            key={list}
            type="button"
            className="notes-nav-button"
            disabled={loading || recovering}
            onClick={() => {
              if (clear !== list) {
                setClear(list);
                return;
              }
              setClear(null);
              void store.getState().clearShortcuts(list);
            }}
          >
            {clear === list
              ? t("Confirm clearing these shortcuts")
              : list === "recent"
                ? t("Clear recent note shortcuts")
                : t("Clear pinned note shortcuts")}
          </button>
        ))}
      </details>
    </>
  );
}
