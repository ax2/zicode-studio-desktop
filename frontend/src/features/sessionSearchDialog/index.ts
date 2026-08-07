import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { t } from "../../shared/i18n";
import type {
  SessionSearchResult,
  SessionSummary,
} from "../sessionSidebar/sessionSidebarLogic";
import {
  SessionSearchDialogApp,
  type SearchDialogController,
} from "./SessionSearchDialogApp";
import {
  isSearchShortcut,
  normalizeQuery,
  SEARCH_DEBOUNCE_MS,
  shortcutHintLabel,
} from "./sessionSearchDialogLogic";
import {
  createSearchDialogStore,
  type SessionSearchDialogStoreHook,
} from "./sessionSearchDialogStore";

export {
  shortcutHintLabel,
  isSearchShortcut,
  normalizeQuery,
} from "./sessionSearchDialogLogic";

export interface SessionSearchDialogOptions {
  triggerInput?: HTMLInputElement | null;
  triggerClear?: HTMLButtonElement | null;
  overlay?: HTMLElement | null;
  dialog?: HTMLElement | null;
  input?: HTMLInputElement | null;
  list?: HTMLElement | null;
  data?: {
    searchSessions(
      workspaceId: string,
      query: string,
    ): Promise<{ results: SessionSearchResult[] }>;
  };
  getWorkspaceId?(): string;
  getSessions?(): SessionSummary[];
  onSelect?(session: SessionSummary, options: { query: string }): void;
  onQueryChange?(query: string): void;
  onError?(error: unknown): void;
}

export interface SessionSearchDialogHandle {
  open(): void;
  close(options?: { restoreFocus?: boolean }): void;
  dispose(): void;
}

export function setupSessionSearchDialog({
  triggerInput,
  triggerClear,
  overlay,
  dialog,
  input,
  list,
  data,
  getWorkspaceId,
  getSessions,
  onSelect,
  onQueryChange,
  onError = console.error,
}: SessionSearchDialogOptions = {}): SessionSearchDialogHandle {
  if (!triggerInput) {
    return { open() {}, close() {}, dispose() {} };
  }
  // The React shell renders its own overlay/dialog/input/list via a portal;
  // the legacy element arguments are accepted for call-site compatibility.
  void overlay;
  void dialog;
  void input;
  void list;
  const activeTrigger = triggerInput;

  const store = createSearchDialogStore();
  let root: Root | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSeq = 0;
  let suppressOpenUntil = 0;

  const commit = (patch: Partial<ReturnType<SessionSearchDialogStoreHook["getState"]>>) => {
    store.setState(patch);
    flushSync(() => {});
  };

  const updateTriggerPlaceholder = () => {
    activeTrigger.placeholder = `${t("Search...")} (${shortcutHintLabel()})`;
  };
  updateTriggerPlaceholder();

  const visibleRows = () => [
    ...document.querySelectorAll<HTMLElement>(".session-search-result"),
  ];

  const controller: SearchDialogController = {
    getSessions: () => getSessions?.() ?? [],
    setQuery(nextQuery) {
      commit({ query: nextQuery, messageMatches: [], activeIndex: 0 });
      activeTrigger.value = nextQuery;
      triggerClear?.classList.toggle("hidden", nextQuery.length === 0);
      onQueryChange?.(nextQuery);
      runMessageSearch(normalizeQuery(nextQuery));
    },
    selectSession(sessionId) {
      const session =
        getSessions?.().find((item) => item.id === sessionId) ?? {
          id: sessionId,
          isCurrentWorkspace: true,
        };
      close({ restoreFocus: false });
      onSelect?.(session, { query: store.getState().query });
    },
    moveActive(delta) {
      const state = store.getState();
      const rows = visibleRows();
      if (rows.length === 0) {
        commit({ activeIndex: 0 });
        return;
      }
      commit({
        activeIndex: Math.max(0, Math.min(state.activeIndex + delta, rows.length - 1)),
      });
    },
    selectActive() {
      const id = visibleRows()[store.getState().activeIndex]?.dataset.sessionId;
      if (id) controller.selectSession(id);
    },
    close(options) {
      close(options);
    },
  };

  function close({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    searchSeq += 1;
    commit({ open: false, loadingMessages: false });
    if (restoreFocus) {
      suppressOpenUntil = Date.now() + 250;
      activeTrigger.focus();
    }
  }

  function open(initialQuery: string = activeTrigger.value) {
    if (Date.now() < suppressOpenUntil) return;
    commit({ open: true });
    controller.setQuery(initialQuery ?? "");
  }

  function runMessageSearch(nextQuery: string) {
    if (searchTimer) clearTimeout(searchTimer);
    if (nextQuery.length < 2) {
      commit({ messageMatches: [], loadingMessages: false });
      return;
    }
    commit({ loadingMessages: true });
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      const workspaceId = getWorkspaceId?.();
      if (!workspaceId) return;
      try {
        const response = await data?.searchSessions(workspaceId, nextQuery);
        if (seq !== searchSeq) return;
        commit({ messageMatches: response?.results ?? [] });
      } catch (error) {
        if (seq === searchSeq) onError(error);
      } finally {
        if (seq === searchSeq) {
          commit({ loadingMessages: false });
        }
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  const onTriggerFocus = () => open();
  const onTriggerClick = () => open();
  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") return;
    const editingKey =
      event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
    if (!editingKey) return;
    event.preventDefault();
    open(event.key.length === 1 ? event.key : activeTrigger.value);
  };
  const clearWithoutOpening = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    suppressOpenUntil = Date.now() + 250;
    controller.setQuery("");
    close({ restoreFocus: false });
  };
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (isSearchShortcut(event)) {
      event.preventDefault();
      if (store.getState().open) {
        document
          .querySelector<HTMLInputElement>(".session-search-dialog-input")
          ?.focus();
        document
          .querySelector<HTMLInputElement>(".session-search-dialog-input")
          ?.select();
      } else {
        open();
      }
      return;
    }
    if (!store.getState().open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab") return;
    const dialogElement = document.querySelector(".session-search-dialog");
    if (!dialogElement) return;
    const focusable = [
      ...dialogElement.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input, [href], [tabindex]",
      ),
    ].filter((element) => element.getAttribute("tabindex") !== "-1");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !dialogElement.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const onLocaleChanged = () => {
    updateTriggerPlaceholder();
  };

  activeTrigger.addEventListener("focus", onTriggerFocus);
  activeTrigger.addEventListener("click", onTriggerClick);
  activeTrigger.addEventListener("keydown", onTriggerKeyDown);
  triggerClear?.addEventListener("pointerdown", clearWithoutOpening);
  triggerClear?.addEventListener("mousedown", clearWithoutOpening);
  triggerClear?.addEventListener("click", clearWithoutOpening);
  document.addEventListener("keydown", onDocumentKeyDown);
  globalThis.window?.addEventListener("zicode:locale-changed", onLocaleChanged);

  const rootElement = document.getElementById("session-search-dialog-root");
  if (rootElement) {
    const mountedRoot = createRoot(rootElement);
    root = mountedRoot;
    flushSync(() => {
      mountedRoot.render(
        createElement(SessionSearchDialogApp, { controller, store }),
      );
    });
  }

  return {
    open: () => open(),
    close: (options) => close(options),
    dispose() {
      activeTrigger.removeEventListener("focus", onTriggerFocus);
      activeTrigger.removeEventListener("click", onTriggerClick);
      activeTrigger.removeEventListener("keydown", onTriggerKeyDown);
      triggerClear?.removeEventListener("pointerdown", clearWithoutOpening);
      triggerClear?.removeEventListener("mousedown", clearWithoutOpening);
      triggerClear?.removeEventListener("click", clearWithoutOpening);
      document.removeEventListener("keydown", onDocumentKeyDown);
      globalThis.window?.removeEventListener("zicode:locale-changed", onLocaleChanged);
      root?.unmount();
    },
  };
}
