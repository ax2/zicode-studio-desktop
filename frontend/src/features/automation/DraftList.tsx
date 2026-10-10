import { useEffect } from "react";
import { t } from "../../shared/i18n.js";
import type { createAutomationDraftStore, DraftSelection } from "./draft-store";
import { formatDate } from "./logic";

export function DraftList({
  store,
  onRestore,
}: {
  store: ReturnType<typeof createAutomationDraftStore>;
  onRestore(selection: DraftSelection): void;
}) {
  const state = store();
  useEffect(() => {
    void store.getState().load();
  }, [store]);
  return (
    <section className="ui-panel automation-card" aria-label={t("Automation drafts")}>
      <header>
        <h2>
          {t("Automation drafts")} ({state.drafts.length})
        </h2>
        <button
          type="button"
          className="ui-button ui-button--ghost"
          disabled={state.loading || state.saving}
          onClick={() => void state.load()}
        >
          {t("Refresh")}
        </button>
      </header>
      <p>
        {t(
          "Drafts never run. Restoring creates a new automation; the saved draft stays until you delete it.",
        )}
      </p>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.loading ? <p role="status">{t("Loading…")}</p> : null}
      {!state.loading && !state.error && !state.drafts.length ? (
        <p>{t("No automation drafts yet")}</p>
      ) : null}
      <div className="automation-list">
        {state.drafts.map((draft) => (
          <article key={draft.id} className="ui-card">
            <h3>{draft.title.trim() || t("Untitled draft")}</h3>
            <p>{draft.targetProject || t("Current project")}</p>
            <p>{formatDate(draft.updatedAt)}</p>
            <div className="automation-actions">
              <button
                type="button"
                className="ui-button ui-button--secondary"
                disabled={state.loading || state.saving || !state.revision}
                onClick={() => {
                  if (state.revision) onRestore({ draft, revision: state.revision });
                }}
              >
                {t("Restore draft")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost"
                disabled={state.loading || state.saving || !state.revision}
                onClick={() => void state.remove(draft.id)}
              >
                {t("Delete draft")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
