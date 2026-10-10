import { useEffect, useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
import { t } from "../../shared/i18n";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { formatCreatedAt, openableUrl } from "./clipboardLogic";
import { type ClipboardOptions, type ClipboardStore, createClipboardStore } from "./clipboardStore";

export type ClipboardAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
  setTarget(): Promise<void>;
};

function ClipboardNav() {
  return <nav className="clipboard-nav" aria-label={t("Clipboard")} />;
}

export function ClipboardMain({ store }: { store: ClipboardStore }) {
  const items = store((state) => state.items);
  const draft = store((state) => state.draft);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void store.getState().load();
  }, [store]);

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <div className="clipboard-main">
      <header className="clipboard-header">
        <h1>{t("Clipboard Inbox")}</h1>
        <p>{t("Capture text and URLs before you organize them. Send any item to a note when you're ready.")}</p>
      </header>

      <FirstRunGuide
        storageKey="clipboard"
        title={t("A scratchpad before you organize")}
        steps={[
          t("Paste or type text, or a URL."),
          t("Add it to the inbox."),
          t("Send any item to a note when you're ready."),
        ]}
        ctaLabel={t("Start capturing")}
        onCta={() => inputRef.current?.focus()}
      />

      <section className="ui-card clipboard-composer">
        <textarea
          ref={inputRef}
          className="clipboard-textarea"
          value={draft}
          placeholder={t("Type or paste text")}
          aria-label={t("Type or paste text")}
          rows={3}
          onChange={(event) => store.getState().setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (!busy && draft.trim()) void store.getState().add();
            }
          }}
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
            <>
              <button
                type="button"
                className={`ui-button ui-button--ghost ui-button--sm${
                  selecting ? " is-active" : ""
                }`}
                aria-pressed={selecting}
                onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
              >
                {selecting ? t("Done selecting") : t("Select")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={async () => {
                  if (await globalThis.confirm?.(t("Clear the clipboard inbox? This cannot be undone."))) {
                    void store.getState().clear();
                  }
                }}
              >
                {t("Clear all")}
              </button>
            </>
          ) : null}
        </div>
        {selecting ? (
          <div className="clipboard-bulk-bar" role="toolbar" aria-label={t("Bulk actions")}>
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() =>
                setSelected(
                  selected.size === items.length
                    ? new Set()
                    : new Set(items.map((item) => item.id)),
                )
              }
            >
              {selected.size === items.length ? t("Deselect all") : t("Select all")}
            </button>
            <span className="clipboard-bulk-count">
              {t("{count} selected").replace("{count}", String(selected.size))}
            </span>
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              disabled={selected.size === 0 || busy}
              onClick={() => {
                void store.getState().sendManyToNotes([...selected]);
                exitSelecting();
              }}
            >
              {t("Send to notes")} ({selected.size})
            </button>
            <button
              type="button"
              className="ui-button ui-button--danger ui-button--sm"
              disabled={selected.size === 0 || busy}
              onClick={async () => {
                const count = selected.size;
                if (
                  await globalThis.confirm?.(
                    t("Remove {count} selected items?").replace("{count}", String(count)),
                  )
                ) {
                  void store.getState().removeMany([...selected]);
                  exitSelecting();
                }
              }}
            >
              {t("Remove selected")} ({selected.size})
            </button>
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul className="clipboard-items">
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <li
                  key={item.id}
                  className={`clipboard-item${isSelected ? " is-selected" : ""}`}
                >
                  {selecting ? (
                    <input
                      type="checkbox"
                      className="clipboard-item-select"
                      aria-label={t("Select item")}
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                    />
                  ) : null}
                  <div className="clipboard-item-body">
                    <div className="clipboard-item-meta">
                      <span className={`clipboard-kind clipboard-kind--${item.kind}`}>
                        {item.kind === "url" ? t("URL") : t("Text")}
                      </span>
                      <span className="clipboard-time">{formatCreatedAt(item.createdAt)}</span>
                    </div>
                    <p className="clipboard-item-text">{item.text}</p>
                  </div>
                  {selecting ? null : (
                    <div className="clipboard-item-actions">
                      {openableUrl(item.text) ? (
                        <button
                          type="button"
                          className="ui-button ui-button--secondary ui-button--sm"
                          aria-label={`${t("Open link")} ${item.text.slice(0, 40)}`}
                          onClick={() => {
                            const url = openableUrl(item.text);
                            if (url) globalThis.open(url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          {t("Open link")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm"
                        aria-label={`${t("Copy")} ${item.text.slice(0, 40)}`}
                        onClick={() => void store.getState().copyItem(item.text)}
                      >
                        {t("Copy")}
                      </button>
                      <button
                        type="button"
                        className="ui-button ui-button--secondary ui-button--sm"
                        aria-label={`${t("Send to note")} ${item.text.slice(0, 40)}`}
                        onClick={() => void store.getState().sendToNote(item.text)}
                      >
                        {t("Send to note")}
                      </button>
                      <button
                        type="button"
                        className="ui-button ui-button--primary ui-button--sm"
                        aria-label={`${t("Add to chat")} ${item.text.slice(0, 40)}`}
                        onClick={() => void store.getState().discussInChat(item.text)}
                      >
                        {t("Add to chat")}
                      </button>
                      <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm"
                        aria-label={`${t("Delete")} ${item.text.slice(0, 40)}`}
                        onClick={() => void store.getState().remove(item.id)}
                      >
                        {t("Delete")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
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
    setTarget() {
      return store.getState().load();
    },
  };
}
