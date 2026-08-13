import { useEffect } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { formatCreatedAt } from "./clipboardLogic";
import { createClipboardStore, type ClipboardOptions, type ClipboardStore } from "./clipboardStore";

export type ClipboardAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

function ClipboardNav() {
  return <nav className="clipboard-nav" aria-label={t("Clipboard")} />;
}

function ClipboardMain({ store }: { store: ClipboardStore }) {
  const items = store((state) => state.items);
  const draft = store((state) => state.draft);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);

  useEffect(() => {
    void store.getState().load();
  }, [store]);

  return (
    <div className="clipboard-main">
      <header className="clipboard-header">
        <h1>{t("Clipboard Inbox")}</h1>
        <p>{t("Capture text and URLs before you organize them.")}</p>
      </header>

      <section className="ui-card clipboard-composer">
        <textarea
          className="clipboard-textarea"
          value={draft}
          placeholder={t("Type or paste text")}
          rows={3}
          onChange={(event) => store.getState().setDraft(event.target.value)}
        />
        <div className="clipboard-composer-actions">
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            onClick={() => void store.getState().paste()}
          >
            {t("Paste from clipboard")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            disabled={busy || !draft.trim()}
            aria-busy={busy}
            onClick={() => void store.getState().add()}
          >
            {t("Add to inbox")}
          </button>
        </div>
        {error ? (
          <p className="idphoto-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="ui-card clipboard-list">
        <div className="clipboard-list-header">
          <h2>{t("Clipboard Inbox")}</h2>
          {items.length > 0 ? (
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() => {
                if (globalThis.confirm?.(t("Clear the clipboard inbox? This cannot be undone."))) {
                  void store.getState().clear();
                }
              }}
            >
              {t("Clear all")}
            </button>
          ) : null}
        </div>
        {items.length > 0 ? (
          <ul className="clipboard-items">
            {items.map((item) => (
              <li key={item.id} className="clipboard-item">
                <div className="clipboard-item-body">
                  <div className="clipboard-item-meta">
                    <span className={`clipboard-kind clipboard-kind--${item.kind}`}>
                      {item.kind === "url" ? t("URL") : t("Text")}
                    </span>
                    <span className="clipboard-time">{formatCreatedAt(item.createdAt)}</span>
                  </div>
                  <p className="clipboard-item-text">{item.text}</p>
                </div>
                <div className="clipboard-item-actions">
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(item.text);
                    }}
                  >
                    {t("Copy")}
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm"
                    onClick={() => void store.getState().sendToNote(item.text)}
                  >
                    {t("Send to note")}
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm"
                    onClick={() => void store.getState().remove(item.id)}
                  >
                    {t("Delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="idphoto-result-empty">{t("No captured items yet")}</p>
        )}
      </section>
    </div>
  );
}

export function createClipboardApp(options: ClipboardOptions): ClipboardAppApi {
  const store = createClipboardStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <ClipboardNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <ClipboardMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "clipboard.open";
    },
    executeCommand() {},
    refresh() {
      return store.getState().load();
    },
  };
}
