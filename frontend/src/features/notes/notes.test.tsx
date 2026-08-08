import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { t } from "../../shared/i18n";
import {
  allTagSuggestions,
  buildChildrenByParent,
  conversationNoteTitle,
  formatDate,
  parseTags,
  safeFileName,
  tagIcon,
} from "./notesLogic";
import { NotesContent, NotesNav } from "./NotesApp";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";
import type { Note, NotesSnapshot } from "./notesLogic";

const NOTE: Note = {
  id: "note-1",
  notebookId: "book-1",
  title: "Roadmap",
  content: "# Plan\n\nSafe content",
  tags: ["plugin"],
  createdAt: "2026-07-31T08:00:00Z",
  updatedAt: "2026-07-31T08:00:00Z",
};

const SNAPSHOT: NotesSnapshot = {
  notebooks: [
    { id: "book-1", title: "Projects", icon: "🚀", noteCount: 1 },
    { id: "book-2", title: "Journal", parentId: "book-1" },
  ],
  notes: [{ id: "note-1", notebookId: "book-1", title: "Roadmap", updatedAt: "2026-07-31T08:00:00Z" }],
  tags: ["plugin", "idea"],
};

function gatewayStub(overrides: Partial<NotesGatewayLike> = {}): NotesGatewayLike {
  return {
    list: vi.fn(async () => ({ snapshot: SNAPSHOT })),
    get: vi.fn(async () => ({ note: NOTE })),
    createNotebook: vi.fn(async () => ({ notebook: { id: "book-9", title: "New" } })),
    updateNotebook: vi.fn(async () => ({})),
    deleteNotebook: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ note: { ...NOTE, id: "note-9", title: "Untitled note" } })),
    save: vi.fn(async () => ({ note: { ...NOTE, title: "Updated" } })),
    delete: vi.fn(async () => ({})),
    moveNote: vi.fn(async () => ({})),
    capture: vi.fn(async () => ({ note: NOTE })),
    uploadAttachment: vi.fn(async () => ({ attachment: { markdown: "![img](/attachments/x)" } })),
    attachmentUrl: vi.fn(() => "/api/attachments/x"),
    importMarkdown: vi.fn(async () => ({ note: NOTE })),
    exportBackup: vi.fn(async () => ({ backup: {} })),
    importBackup: vi.fn(async () => ({ notebook: { id: "book-9", title: "Imported" } })),
    rebuild: vi.fn(async () => ({ report: { validNotes: 1, invalidFiles: [] } })),
    ...overrides,
  };
}

function storeWithGateway(overrides: Partial<NotesGatewayLike> = {}) {
  return createNotesStore({
    gateway: gatewayStub(overrides),
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    getProject: () => ({ id: "ws-1", path: "C:/work", name: "work" }),
    notify: vi.fn(),
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("notes logic", () => {
  it("parses tags, dates, titles, and file names", () => {
    expect(parseTags("a, #b, c")).toEqual(["a", "b", "c"]);
    expect(formatDate("2026-07-31T08:00:00Z")).toBeTruthy();
    expect(conversationNoteTitle("First line\nSecond")).toBe("First line");
    expect(conversationNoteTitle("x".repeat(80))).toHaveLength(61);
    expect(safeFileName('a/b:c')).toBe("a-b-c");
    expect(tagIcon("idea")).toBe("💡");
    expect(tagIcon("custom")).toBe("🏷️");
  });

  it("builds the notebook tree and tag suggestions", () => {
    const map = buildChildrenByParent(SNAPSHOT.notebooks);
    expect(map.get(null)?.map((n) => n.id)).toEqual(["book-1"]);
    expect(map.get("book-1")?.map((n) => n.id)).toEqual(["book-2"]);
    expect(allTagSuggestions(["custom"])).toContain("inbox");
  });
});

describe("notes store", () => {
  it("opens the project workspace from the project header", () => {
    const store = storeWithGateway();
    const dispatched: string[] = [];
    const listener = (event: Event) => dispatched.push(event.type);
    window.addEventListener("zicode:open-project", listener);
    const { container } = render(<NotesNav store={store} />);
    const header = container.querySelector(".notes-project-header") as HTMLElement;
    expect(header).toBeTruthy();
    header.click();
    window.removeEventListener("zicode:open-project", listener);
    expect(dispatched).toEqual(["zicode:open-project"]);
  });

  it("carries the selected editor text into the chat", async () => {
    const onUseInChat = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      onUseInChat,
    });
    await store.getState().load();
    await store.getState().selectNote({
      ...SNAPSHOT.notes[0],
      title: "Selection",
    });
    const { container } = render(<NotesContent store={store} />);
    // switch to edit mode
    const editTab = container.querySelector(".notes-edit-tab") as HTMLButtonElement;
    editTab.click();
    await waitFor(() =>
      expect(container.querySelector(".notes-content-input")).toBeTruthy(),
    );
    const textarea = container.querySelector(".notes-content-input") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "Safe content with a selected part");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => expect(textarea.value).toBe("Safe content with a selected part"));
    textarea.setSelectionRange(5, 28);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
    const useInChat = container.querySelector(".notes-use-in-chat") as HTMLButtonElement;
    useInChat.click();
    expect(onUseInChat).toHaveBeenCalledTimes(1);
    expect(onUseInChat.mock.calls[0][1]).toBe("content with a selected");
  });

  it("expands and collapses a notebook from its summary without a toggle fight", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-notebook-summary")).toBeTruthy(),
    );
    const branch = container.querySelector(
      ".notes-notebook-branch",
    ) as HTMLDetailsElement;
    const summary = container.querySelector(
      ".notes-notebook-summary",
    ) as HTMLElement;

    summary.click();
    await waitFor(() => expect(branch.open).toBe(true));

    summary.click();
    await waitFor(() => expect(branch.open).toBe(false));
    expect(branch.open).toBe(false);
  });

  it("loads the snapshot and selects a note into drafts", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    expect(store.getState().snapshot.notebooks).toHaveLength(2);
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    expect(store.getState().selectedNote?.id).toBe("note-1");
    expect(store.getState().draftTitle).toBe("Roadmap");
    expect(store.getState().draftContent).toContain("# Plan");
  });

  it("opens a note by id through the deep-link handle", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().openNote("book-1", "note-1");
    expect(store.getState().selectedNote?.id).toBe("note-1");
    expect(store.getState().draftTitle).toBe("Roadmap");
  });

  it("keeps recent notes visible across tag filters", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    expect(store.getState().recentNotes.map((note) => note.id)).toContain("note-1");
    await store.getState().applyFilter({ tag: "idea" });
    expect(store.getState().recentNotes.map((note) => note.id)).toContain("note-1");
  });

  it("exports a readable backup through the download hook", async () => {
    const downloadFile = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub({
        exportBackup: vi.fn(async () => ({ backup: { schemaVersion: 1 } })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      downloadFile,
    });
    await store.getState().load();
    store.getState().selectNotebook("book-1");
    await store.getState().exportBackup();
    expect(downloadFile).toHaveBeenCalledOnce();
    const [fileName, content] = downloadFile.mock.calls[0];
    expect(fileName).toBe("Projects.zicode-notes.json");
    expect(JSON.parse(content)).toMatchObject({ schemaVersion: 1 });
  });

  it("imports a readable backup through the file picker", async () => {
    const importBackup = vi.fn(async () => ({ notebook: { id: "book-1", title: "Imported" } }));
    const store = createNotesStore({
      gateway: gatewayStub({ importBackup }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      chooseFile: vi.fn(
        async () =>
          ({
            size: 128,
            text: async () =>
              JSON.stringify({ schemaVersion: 1, notebook: { title: "Imported" } }),
          }) as unknown as File,
      ),
    });
    await store.getState().load();
    await store.getState().importBackup();
    expect(importBackup).toHaveBeenCalledOnce();
    expect(store.getState().selectedNotebookId).toBe("book-1");
    const backupArg = (importBackup.mock.calls[0] as unknown[])[2];
    expect(backupArg).toMatchObject({ schemaVersion: 1 });
  });

  it("creates a new note and marks it for editing", async () => {
    const create = vi.fn(async () => ({ note: { ...NOTE, id: "note-1", title: "Untitled note" } }));
    const store = storeWithGateway({ create });
    await store.getState().load();
    await store.getState().newNote();
    expect(store.getState().selectedNote?.title).toBe("Untitled note");
    expect(store.getState().dirty).toBe(false);
  });

  it("deletes a notebook after confirmation and reloads", async () => {
    const deleteNotebook = vi.fn(async () => ({ deleted: true }));
    const notify = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub({ deleteNotebook }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify,
      confirmDelete: () => true,
    });
    await store.getState().load();
    await store.getState().deleteNotebook("book-1");
    expect(deleteNotebook).toHaveBeenCalledWith("programming", "ws-1", "book-1");
    expect(notify).toHaveBeenCalledWith("笔记本已删除");
  });

  it("skips deletion when the confirmation is declined", async () => {
    const deleteNotebook = vi.fn(async () => ({ deleted: true }));
    const store = createNotesStore({
      gateway: gatewayStub({ deleteNotebook }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      confirmDelete: () => false,
    });
    await store.getState().load();
    await store.getState().deleteNotebook("book-1");
    expect(deleteNotebook).not.toHaveBeenCalled();
  });

  it("saves the editor draft through the gateway", async () => {
    const save = vi.fn(async (_sceneId: string, _workspaceId: string, note: Note) => ({
      note: { ...note, id: "note-1" },
    }));
    const store = storeWithGateway({ save });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ title: "Renamed", content: "New body" });
    expect(store.getState().dirty).toBe(true);
    await store.getState().saveEditor();
    expect(save).toHaveBeenCalled();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saveState).toBe("saved");
  });

  it("tracks unsaved, saving, and saved states in the editor", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    expect(store.getState().saveState).toBe("idle");
    store.getState().setDraft({ title: "Renamed" });
    expect(store.getState().saveState).toBe("dirty");
    await store.getState().saveEditor();
    expect(store.getState().saveState).toBe("saved");
  });

  it("captures a chat exchange into a conversation note", async () => {
    const create = vi.fn(async () => ({ note: { ...NOTE, id: "note-chat", title: "Question" } }));
    const store = storeWithGateway({ create });
    await store.getState().load();
    const note = await store.getState().captureChatExchange({ question: "Q?", answer: "A!" });
    expect(note.id).toBe("note-chat");
    expect(create).toHaveBeenCalled();
    expect(store.getState().snapshot.tags).toContain("chat");
  });

  it("moves a note to another notebook", async () => {
    const moveNote = vi.fn(async () => ({}));
    const store = storeWithGateway({ moveNote });
    await store.getState().load();
    await store.getState().moveNoteTo("book-1", "note-1", "book-2");
    expect(moveNote).toHaveBeenCalledWith(
      "programming",
      "ws-1",
      expect.objectContaining({ targetNotebookId: "book-2" }),
    );
  });
});

describe("notes React components", () => {
  it("renders the notebook tree, tags, and data management sections", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    render(<NotesNav store={store} />);
    await waitFor(() => expect(document.querySelector(".notes-notebook-branch")).toBeTruthy());
    expect(document.querySelector(".notes-notebook-title")?.textContent).toBe("Projects");
    expect(document.querySelectorAll(".notes-nav-button").length).toBeGreaterThan(0);
    expect(document.querySelector(".notes-search-input")).toBeTruthy();
  });

  it("renders the note editor after selecting a note", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setPreview(false);
    render(<NotesContent store={store} />);
    expect(document.querySelector(".notes-editor")).toBeTruthy();
    expect((document.querySelector(".notes-title-input") as HTMLInputElement).value).toBe(
      "Roadmap",
    );
    expect(document.querySelector(".notes-content-input")).toBeTruthy();
    expect(document.querySelectorAll(".notes-tag-chip").length).toBe(1);
  });

  it("switches to preview mode and renders markdown", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setPreview(true);
    render(<NotesContent store={store} />);
    expect(document.querySelector(".notes-preview")).toBeTruthy();
  });

  it("renders the empty library when no notebook exists", async () => {
    const store = createNotesStore({
      gateway: gatewayStub({
        list: vi.fn(async () => ({ snapshot: { notebooks: [], notes: [], tags: [] } })),
      }),
    });
    await store.getState().load();
    render(<NotesContent store={store} />);
    expect(document.querySelector(".notes-state-panel")).toBeTruthy();
    expect(document.body.textContent).toContain(t("Your local Notes library"));
  });
});
