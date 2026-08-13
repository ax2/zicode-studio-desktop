import { useEffect } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { formatTime } from "./watchLogic";
import { createWatchStore, type WatchOptions, type WatchStore } from "./watchStore";

export type WatchAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

function WatchNav() {
  return <nav className="watch-nav" aria-label={t("Web Watch")} />;
}

function WatchMain({ store }: { store: WatchStore }) {
  const items = store((state) => state.items);
  const results = store((state) => state.results);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const draftName = store((state) => state.draftName);
  const draftUrl = store((state) => state.draftUrl);
  const editingId = store((state) => state.editingId);

  useEffect(() => {
    void store.getState().load();
  }, [store]);

  return (
    <div className="watch-main">
      <header className="watch-header">
        <h1>{t("Web Watch")}</h1>
        <p>{t("Detect when public web pages change with content hash checks.")}</p>
      </header>

      <section className="ui-card watch-composer">
        <div className="watch-composer-row">
          <input
            className="watch-name-input"
            value={draftName}
            placeholder={t("Watch name")}
            onChange={(event) => store.getState().setDraft({ draftName: event.target.value })}
          />
          <input
            className="watch-url-input"
            value={draftUrl}
            placeholder={t("Page URL")}
            type="url"
            onChange={(event) => store.getState().setDraft({ draftUrl: event.target.value })}
          />
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            disabled={busy || !draftName.trim() || !draftUrl.trim()}
            onClick={() => void store.getState().add()}
          >
            {t("Add watcher")}
          </button>
        </div>
        {error ? (
          <p className="idphoto-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="ui-card watch-list">
        {items.length > 0 ? (
          <>
            <div className="watch-list-header">
              <button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void store.getState().checkAll()}
              >
                {t("Check all")}
              </button>
            </div>
            <ul className="watch-items">
              {items.map((item) => {
                const result = results[item.id];
                const editing = editingId === item.id;
                return (
                  <li key={item.id} className="watch-item">
                    {editing ? (
                      <div className="watch-edit">
                        <input
                          className="watch-name-input"
                          value={draftName}
                          aria-label={t("Watch name")}
                          onChange={(event) =>
                            store.getState().setDraft({ draftName: event.target.value })
                          }
                        />
                        <input
                          className="watch-url-input"
                          value={draftUrl}
                          aria-label={t("Page URL")}
                          type="url"
                          onChange={(event) =>
                            store.getState().setDraft({ draftUrl: event.target.value })
                          }
                        />
                        <div className="watch-edit-actions">
                          <button
                            type="button"
                            className="ui-button ui-button--primary ui-button--sm"
                            disabled={busy || !draftName.trim() || !draftUrl.trim()}
                            onClick={() => void store.getState().saveEdit()}
                          >
                            {t("Save")}
                          </button>
                          <button
                            type="button"
                            className="ui-button ui-button--ghost ui-button--sm"
                            onClick={() => store.getState().cancelEdit()}
                          >
                            {t("Cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="watch-item-body">
                        <strong className="watch-item-name">{item.name}</strong>
                        <a className="watch-item-url" href={item.url} target="_blank" rel="noreferrer">
                          {item.url}
                        </a>
                      <span className="watch-item-meta">
                        {result
                          ? result.changed
                            ? t("Changed")
                            : t("Unchanged")
                          : item.lastCheckedAt
                            ? `${t("Changes")}: ${item.changeCount} · ${formatTime(item.lastCheckedAt)}`
                            : t("Not checked yet")}
                      </span>
                      </div>
                    )}
                    <div className="watch-item-actions">
                      {!editing ? (
                        <button
                          type="button"
                          className="ui-button ui-button--ghost ui-button--sm"
                          onClick={() => store.getState().startEdit(item)}
                        >
                          {t("Edit")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ui-button ui-button--secondary ui-button--sm"
                        disabled={busy}
                        onClick={() => void store.getState().check(item.id)}
                      >
                        {t("Check now")}
                      </button>
                      <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm"
                        onClick={() => {
                          if (globalThis.confirm?.(t("Delete this watcher? This cannot be undone."))) {
                            void store.getState().remove(item.id);
                          }
                        }}
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="idphoto-result-empty">{t("No watchers yet")}</p>
        )}
      </section>
    </div>
  );
}

export function createWatchApp(options: WatchOptions): WatchAppApi {
  const store = createWatchStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <WatchNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <WatchMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "watch.open";
    },
    executeCommand() {},
    refresh() {
      return store.getState().load();
    },
  };
}
