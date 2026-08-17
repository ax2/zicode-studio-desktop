import { useLayoutEffect, useRef } from "react";
import { t } from "../../shared/i18n";
import { isImeComposing } from "../../shared/ime";
import type { SessionSummary } from "../sessionSidebar/sessionSidebarLogic";
import {
  buildMessageRows,
  buildTitleRows,
  highlightParts,
  normalizeQuery,
} from "./sessionSearchDialogLogic";
import type { SessionSearchDialogStoreHook } from "./sessionSearchDialogStore";

export interface SearchDialogController {
  getSessions(): SessionSummary[];
  setQuery(query: string): void;
  selectSession(sessionId: string): void;
  moveActive(delta: number): void;
  selectActive(): void;
  close(options?: { restoreFocus?: boolean }): void;
}

export function SessionSearchDialogApp({
  controller,
  store,
}: {
  controller: SearchDialogController;
  store: SessionSearchDialogStoreHook;
}) {
  const open = store((state) => state.open);
  const query = store((state) => state.query);
  const messageMatches = store((state) => state.messageMatches);
  const loadingMessages = store((state) => state.loadingMessages);
  const activeIndex = store((state) => state.activeIndex);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);

  const titleRows = buildTitleRows(controller.getSessions() ?? [], query);
  const messageRows = buildMessageRows(messageMatches);
  const allRows = [...titleRows, ...messageRows];
  const normalized = normalizeQuery(query);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when the active row index changes
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(".session-search-result.active")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  const renderRow = (
    row: { sessionId: string; icon: string; title: string; meta?: string; snippet?: string },
    index: number,
  ) => {
    const isActive = index === activeIndex;
    return (
      <button
        type="button"
        className={`session-search-result${isActive ? " active" : ""}`}
        data-session-id={row.sessionId}
        role="option"
        aria-selected={isActive}
        key={row.sessionId}
        onClick={() => controller.selectSession(row.sessionId)}
      >
        <span className="session-search-result-icon">{row.icon}</span>
        <span className="session-search-result-copy">
          <span className="session-search-result-title">
            {highlightParts(row.title, query).map((part) =>
              part.mark ? (
                <mark key={part.key}>{part.text}</mark>
              ) : (
                <span key={part.key}>{part.text}</span>
              ),
            )}
          </span>
          {row.snippet ? (
            <span className="session-search-result-snippet">
              {highlightParts(row.snippet, query).map((part) =>
                part.mark ? (
                  <mark key={part.key}>{part.text}</mark>
                ) : (
                  <span key={part.key}>{part.text}</span>
                ),
              )}
            </span>
          ) : null}
          {row.meta ? (
            <span className="session-search-result-meta">{row.meta}</span>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: overlay click-catcher closes the dialog (vanilla behavior) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes on click only; Escape is handled on the input and document */}
      <div
        className="session-search-overlay"
        onClick={() => controller.close({ restoreFocus: true })}
      ></div>
      <div
        ref={dialogRef}
        className="session-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Search tasks")}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input, [href], [tabindex]",
            ) ?? [],
          ).filter((element) => element.getAttribute("tabindex") !== "-1");
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              !dialogRef.current?.contains(document.activeElement))
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="session-search-input-row">
          <svg
            className="session-search-input-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="session-search-dialog-input"
            placeholder={t("Search tasks and messages…")}
            aria-label={t("Search tasks and messages…")}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onInput={(event) => controller.setQuery(event.currentTarget.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (isImeComposing(event, composingRef.current)) return;
              if (event.key === "Escape") {
                event.preventDefault();
                controller.close({ restoreFocus: true });
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                controller.moveActive(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                controller.moveActive(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                controller.selectActive();
              }
            }}
          />
        </div>
        <div
          ref={listRef}
          className="session-search-results"
          role="listbox"
          aria-label={t("Search results")}
        >
          {titleRows.length > 0 ? (
            <div className="session-search-group" key="title-group">
              <div className="session-search-group-header">
                {normalized ? t("Tasks") : t("Recent tasks")}
              </div>
              {titleRows.map((row, index) => renderRow(row, index))}
            </div>
          ) : null}
          {messageRows.length > 0 ? (
            <div className="session-search-group" key="message-group">
              <div className="session-search-group-header">
                {t("Message matches")}
              </div>
              {messageRows.map((row, index) =>
                renderRow(row, titleRows.length + index),
              )}
            </div>
          ) : null}
          {loadingMessages ? (
            <div className="session-search-empty" key="loading">
              {t("Searching messages…")}
            </div>
          ) : allRows.length === 0 ? (
            <div className="session-search-empty" key="empty">
              {normalized ? t("No tasks or messages found") : t("No saved tasks")}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
