import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotesContent, NotesNav } from "./NotesApp";
import {
  createNotesStore,
  type NotesStoreOptions,
  type ProjectInfo,
} from "./notesStore";

export interface NotesAppHandle {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  setTarget(): Promise<void>;
  setProject(project: ProjectInfo | null): void;
  newNote(): Promise<void>;
  startCapture(): Promise<void>;
  captureChatExchange(input: { question?: string; answer?: string; sessionId?: string }): Promise<unknown>;
  canDeactivate(): Promise<boolean>;
  destroy(): void;
}

export function setupNotesApp(options: NotesStoreOptions): NotesAppHandle | null {
  if (!options.gateway) return null;
  const store = createNotesStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;

  function mountNavRoot(container: HTMLElement, element: ReactNode) {
    if (navRoot) {
      navRoot.unmount();
      navRoot = null;
    }
    container.querySelector('[data-notes-root="nav"]')?.remove();
    const wrapper = document.createElement("div");
    wrapper.dataset.notesRoot = "nav";
    container.append(wrapper);
    navRoot = createRoot(wrapper);
    navRoot.render(element);
  }

  function mountContentRoot(container: HTMLElement, element: ReactNode) {
    if (contentRoot) {
      contentRoot.unmount();
      contentRoot = null;
    }
    container.querySelector('[data-notes-root="content"]')?.remove();
    const wrapper = document.createElement("div");
    wrapper.dataset.notesRoot = "content";
    container.append(wrapper);
    contentRoot = createRoot(wrapper);
    contentRoot.render(element);
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (
      document.body.dataset.activePlugin === "com.zicode.notes" &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void store.getState().saveEditor();
    }
  };
  document.addEventListener("keydown", handleKeydown);

  return {
    renderNavigation(container) {
      mountNavRoot(container, createElement(NotesNav, { store }));
      if (!store.getState().loading && store.getState().snapshot.notebooks.length === 0 && !store.getState().error) {
        void store.getState().load();
      }
    },
    renderContent(container) {
      mountContentRoot(container, createElement(NotesContent, { store }));
      if (!store.getState().loading && store.getState().snapshot.notebooks.length === 0 && !store.getState().error) {
        void store.getState().load();
      }
    },
    setTarget() {
      if (document.body.dataset.activePlugin === "com.zicode.notes") {
        return store.getState().setTarget();
      }
      return Promise.resolve();
    },
    setProject(project) {
      store.getState().setProject(project);
    },
    newNote() {
      return store.getState().newNote();
    },
    startCapture() {
      return store.getState().startCapture();
    },
    captureChatExchange(input) {
      return store.getState().captureChatExchange(input);
    },
    async canDeactivate() {
      await store.getState().saveEditor();
      return true;
    },
    destroy() {
      document.removeEventListener("keydown", handleKeydown);
      store.getState().destroy();
      navRoot?.unmount();
      navRoot = null;
      contentRoot?.unmount();
      contentRoot = null;
    },
  };
}

export { createNotesStore } from "./notesStore";
export { parseTags, formatDate, tagIcon } from "./notesLogic";
