export { createModelDropdownFeed } from "./modelDropdown";
export type { ModelDropdownFeed, ModelDropdownSnapshot, ModelLike } from "./modelDropdown";
export {
  activeSlashQuery,
  computeSlashMatches,
  titleCaseCommandName,
} from "./slashMenu";
export type { SlashCommand, SlashMenuState } from "./slashMenu";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { create } from "zustand";
import { ComposerApp, type ComposerStore } from "./ComposerApp";
import { EMPTY_SLASH_STATE, computeSlashMatches } from "./slashMenu";
import {
  getComposerStore,
  setComposerStore,
} from "./composerStore";
import type { SlashCommand } from "./slashMenu";

export interface ComposerElements {
  input: HTMLTextAreaElement;
  form: HTMLFormElement;
  abortButton: HTMLButtonElement;
  sendButton: HTMLButtonElement;
  composerCard: HTMLElement;
  commandButton: HTMLButtonElement;
  attachButton: HTMLButtonElement;
  imageInput: HTMLInputElement;
  imagePreviews: HTMLElement;
  skillSlashMenu: HTMLElement;
  queuedMessages: HTMLElement;
  modelDropdown: HTMLElement;
  modelDropdownBtn: HTMLButtonElement;
  modelDropdownLabel: HTMLElement;
  modelDropdownMenu: HTMLElement;
  thinkingBtn: HTMLButtonElement;
}

export interface ComposerSubmitOptions {
  altKey: boolean;
}

export interface ComposerHandle extends ComposerElements {
  setQueue(queue: { steering?: string[]; followUp?: string[] }): void;
  dispose(): void;
}

export function setupComposer(
  options: { onSubmit?: (submit: ComposerSubmitOptions) => void } = {},
): ComposerHandle | null {
  const rootElement = document.getElementById("composer-root");
  if (!rootElement) return null;
  const store = create<ComposerStore>()((set) => ({
    queue: {},
    setQueue: (queue) => set({ queue }),
    slash: EMPTY_SLASH_STATE,
    setSlash: (patch) =>
      set((state) => ({ slash: { ...state.slash, ...patch } })),
    getCommands: () => [],
    setGetCommands: (getCommands) => set({ getCommands }),
  }));
  setComposerStore(store);
  let root: Root | null = null;
  flushSync(() => {
    root = createRoot(rootElement);
    root.render(
      createElement(ComposerApp, { store, onSubmit: options.onSubmit }),
    );
  });
  const required = <T,>(element: T | null): T => {
    if (!element) throw new Error("composer element missing");
    return element;
  };
  const elements: ComposerElements = {
    input: required(document.getElementById("message-input") as HTMLTextAreaElement | null),
    form: required(document.getElementById("chat-form") as HTMLFormElement | null),
    abortButton: required(document.getElementById("abort-btn") as HTMLButtonElement | null),
    sendButton: required(document.getElementById("send-btn") as HTMLButtonElement | null),
    composerCard: required(document.getElementById("composer-card") as HTMLElement | null),
    commandButton: required(document.getElementById("command-btn") as HTMLButtonElement | null),
    attachButton: required(document.getElementById("attach-btn") as HTMLButtonElement | null),
    imageInput: required(document.getElementById("image-input") as HTMLInputElement | null),
    imagePreviews: required(document.getElementById("image-previews") as HTMLElement | null),
    skillSlashMenu: required(document.getElementById("skill-slash-menu") as HTMLElement | null),
    queuedMessages: required(document.getElementById("queued-messages") as HTMLElement | null),
    modelDropdown: required(document.getElementById("model-dropdown") as HTMLElement | null),
    modelDropdownBtn: required(
      document.getElementById("model-dropdown-btn") as HTMLButtonElement | null,
    ),
    modelDropdownLabel: required(
      document.getElementById("model-dropdown-label") as HTMLElement | null,
    ),
    modelDropdownMenu: required(document.getElementById("model-dropdown-menu") as HTMLElement | null),
    thinkingBtn: required(document.getElementById("thinking-btn") as HTMLButtonElement | null),
  };
  return {
    ...elements,
    setQueue: (queue) => store.getState().setQueue(queue),
    dispose: () => {
      root?.unmount();
      setComposerStore(null);
    },
  };
}

export function setupComposerSlashMenu({
  input,
  container,
  commandButton = null,
  getCommands,
}: {
  input?: HTMLTextAreaElement | null;
  container?: HTMLElement | null;
  commandButton?: HTMLButtonElement | null;
  getCommands: () => SlashCommand[];
}): { close(): void; update(): void; openAll(): void } {
  const store = getComposerStore();
  if (!store || !input) return { close() {}, update() {}, openAll() {} };
  // The menu listbox is owned by the React composer shell; the container
  // argument is accepted for call-site compatibility only.
  void container;
  store.getState().setGetCommands(getCommands);

  const close = () => store.getState().setSlash(EMPTY_SLASH_STATE);

  const openAll = () => {
    const state = store.getState();
    const computed = computeSlashMatches(input, state.getCommands());
    if (computed) {
      state.setSlash({
        open: true,
        query: computed.query,
        matches: computed.matches,
        selectedIndex: 0,
      });
    } else if (input.value.trim().length === 0) {
      input.value = "/";
      input.setSelectionRange(1, 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.focus();
  };

  const update = () => {
    const state = store.getState();
    const computed = computeSlashMatches(input, state.getCommands());
    if (!computed) {
      state.setSlash(EMPTY_SLASH_STATE);
      return;
    }
    state.setSlash({
      open: true,
      query: computed.query,
      matches: computed.matches,
      selectedIndex: Math.min(
        state.slash.selectedIndex,
        Math.max(computed.matches.length - 1, 0),
      ),
    });
  };

  commandButton?.addEventListener("click", openAll);
  return { close, update, openAll };
}
