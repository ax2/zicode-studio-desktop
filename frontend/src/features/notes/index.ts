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
  openNote(notebookId: string, noteId: string): Promise<void>;
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
    wrapper.className = "notes-main";
    container.append(wrapper);
    contentRoot = createRoot(wrapper);
    contentRoot.render(element);
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (document.body.dataset.activePlugin !== "com.zicode.notes") return;
    const meta = event.ctrlKey || event.metaKey;
    if (!meta) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      void store.getState().saveEditor();
      return;
    }
    if (!event.shiftKey && key === "e") {
      event.preventDefault();
      store.getState().setPreview(!store.getState().preview);
      return;
    }
    if (!event.shiftKey && key === "n") {
      event.preventDefault();
      void store.getState().newNote();
      return;
    }
    if (!event.shiftKey && key === "d") {
      event.preventDefault();
      if (!store.getState().draftContent.trim()) return;
      void store.getState().duplicateNote();
      return;
    }
    if (event.shiftKey && key === "c") {
      event.preventDefault();
      void store.getState().copyNote();
      return;
    }
    if (event.shiftKey && key === "d") {
      event.preventDefault();
      void store.getState().downloadNote();
      return;
    }
    if (event.shiftKey && key === "t") {
      event.preventDefault();
      void store.getState().loadTrash();
      store.getState().setMode("trash");
      return;
    }
    if (key === "enter" && !event.shiftKey) {
      const note = store.getState().selectedNote;
      if (!note) return;
      if (!store.getState().draftContent.trim()) return;
      event.preventDefault();
      let selection = "";
      if (store.getState().preview) {
        const windowSelection = window.getSelection();
        const preview = document.querySelector(".notes-preview");
        if (
          windowSelection &&
          preview &&
          windowSelection.anchorNode &&
          preview.contains(windowSelection.anchorNode)
        ) {
          selection = windowSelection.toString().trim();
        }
      } else {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          ".notes-content-input",
        );
        if (textarea) {
          selection = textarea.value
            .slice(textarea.selectionStart, textarea.selectionEnd)
            .trim();
        }
      }
      void store.getState().discussInChat(note, selection);
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
    openNote(notebookId, noteId) {
      return store.getState().openNote(notebookId, noteId);
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
