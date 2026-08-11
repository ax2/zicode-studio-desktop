import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { t } from "../../shared/i18n";
import {
  allTagSuggestions,
  buildChildrenByParent,
  buildHeadingOutline,
  conversationNoteTitle,
  findActiveOutlineId,
  formatDate,
  highlightSegments,
  parseTags,
  safeFileName,
  tagIcon,
} from "./notesLogic";
import { NotesContent, NotesNav } from "./NotesApp";
import { setupNotesApp } from "./index";
import {
  createNotesStore,
  localizeNotesHostError,
  type NotesGatewayLike,
} from "./notesStore";
import type { Note, NotesSnapshot } from "./notesLogic";

// jsdom has no PointerEvent yet; the notes tree drag is pointer-driven, so
// provide a minimal MouseEvent subclass with the pointer fields the handlers
// read. Kept local to this test file.
if (typeof PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  const polyfill = PointerEventPolyfill as unknown as typeof PointerEvent;
  (globalThis as unknown as Record<string, unknown>).PointerEvent = polyfill;
  (window as unknown as Record<string, unknown>).PointerEvent = polyfill;
}

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
    listTrash: vi.fn(async () => ({ trash: [] })),
    restoreTrash: vi.fn(async () => ({ note: NOTE })),
    purgeTrash: vi.fn(async () => ({})),
    emptyTrash: vi.fn(async () => ({ emptied: 0 })),
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

  it("splits text into highlighted segments case-insensitively", () => {
    expect(highlightSegments("Roadmap", "road")).toEqual([
      { text: "Road", match: true },
      { text: "map", match: false },
    ]);
    expect(highlightSegments("Roadmap", "ma")).toEqual([
      { text: "Road", match: false },
      { text: "ma", match: true },
      { text: "p", match: false },
    ]);
    expect(highlightSegments("Roadmap", "")).toEqual([{ text: "Roadmap", match: false }]);
    expect(highlightSegments("Roadmap", "xyz")).toEqual([{ text: "Roadmap", match: false }]);
    expect(highlightSegments("", "road")).toEqual([{ text: "", match: false }]);
  });

  it("builds a heading outline with stable ids", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<h1>Intro</h1><p>x</p><h2>Setup</h2><h2>Setup</h2><h3>Deep</h3><h4>Ignored</h4>";
    expect(buildHeadingOutline(root)).toEqual([
      { id: "intro", level: 1, text: "Intro" },
      { id: "setup", level: 2, text: "Setup" },
      { id: "setup-2", level: 2, text: "Setup" },
      { id: "deep", level: 3, text: "Deep" },
    ]);
    expect(root.querySelector("h4")?.id).toBe("");
  });

  it("finds the active outline heading near the reading line", () => {
    expect(findActiveOutlineId([], 0)).toBeNull();
    const items = [
      { id: "a", top: 20 },
      { id: "b", top: 300 },
      { id: "c", top: 700 },
    ];
    expect(findActiveOutlineId(items, 0)).toBe("a");
    expect(findActiveOutlineId(items, 0, 400)).toBe("b");
    expect(findActiveOutlineId([{ id: "x", top: 200 }], 0, 80)).toBe("x");
  });

  it("builds the notebook tree and tag suggestions", () => {
    const map = buildChildrenByParent(SNAPSHOT.notebooks);
    expect(map.get(null)?.map((n) => n.id)).toEqual(["book-1"]);
    expect(map.get("book-1")?.map((n) => n.id)).toEqual(["book-2"]);
    expect(allTagSuggestions(["custom"])).toContain("inbox");
  });
});

describe("notes store", () => {
  it("maps a closed Pi runtime to the localized recovery message", () => {
    const closed = new Error("Pi RPC request failed: ProcessClosed");
    expect(localizeNotesHostError(closed).message).toBe(
      t("Pi runtime is disconnected. Start a new session to reconnect."),
    );
  });

  it("localizes known host API errors for the active locale", () => {
    const permission = new Error(
      "Grant Notes network access in Plugin Manager before capturing a web page",
    ) as Error & { code?: string };
    permission.code = "permission_denied";
    expect(localizeNotesHostError(permission).message).toBe(
      t(
        "Grant Notes network access in Plugin Manager before capturing a web page",
      ),
    );

    const quota = new Error("Notes backup contains too many notes") as Error & {
      code?: string;
    };
    quota.code = "quota_exceeded";
    expect(localizeNotesHostError(quota).message).toBe(
      t("Notes backup contains too many notes"),
    );

    const unknown = new Error("Unrelated failure");
    expect(localizeNotesHostError(unknown)).toBe(unknown);
  });

  it("closes the mobile function-area drawer when a note is selected", async () => {
    const store = storeWithGateway();
    const requests: Array<{ open?: boolean }> = [];
    const listener = (event: Event) => {
      requests.push((event as CustomEvent<{ open?: boolean }>).detail);
    };
    document.addEventListener("zicode:function-area-request", listener);
    try {
      await store.getState().load();
      await store.getState().selectNote(SNAPSHOT.notes[0]);
      expect(requests.some((detail) => detail.open === false)).toBe(true);
    } finally {
      document.removeEventListener("zicode:function-area-request", listener);
    }
  });

  it("does not duplicate the shell project row inside the notes navigation", () => {
    const store = storeWithGateway();
    const { container } = render(<NotesNav store={store} />);
    // The plugin shell already renders the project row for every application;
    // Notes must not render its own duplicate project header on top of it.
    expect(container.querySelector(".notes-project-header")).toBeNull();
  });

  it("highlights the search query inside note titles", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    store.getState().setQuery("road");
    const { container } = render(<NotesNav store={store} />);
    expect(store.getState().query).toBe("road");
    expect((container.querySelector(".notes-search-input") as HTMLInputElement).value).toBe("road");
    expect(container.textContent).toContain("Roadmap");
    expect(container.querySelector(".notes-list-item strong")?.textContent).toBe("Roadmap");
    await waitFor(() =>
      expect(container.querySelector("mark.notes-search-hit")).toBeTruthy(),
    );
    const marks = [...container.querySelectorAll("mark.notes-search-hit")];
    expect(marks.some((mark) => mark.textContent === "Road")).toBe(true);
    store.getState().setQuery("");
  });

  it("highlights query matches in filtered results", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    store.getState().setQuery("road");
    await store.getState().applyFilter({ tag: "idea" });
    const { container } = render(<NotesContent store={store} />);
    await waitFor(() =>
      expect(container.querySelector("mark.notes-search-hit")).toBeTruthy(),
    );
    expect(container.querySelector(".notes-results-title")?.textContent).toContain("idea");
    store.getState().setQuery("");
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

  it("collapses and re-expands a nav section from its summary", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-nav-section")).toBeTruthy(),
    );
    const section = container.querySelector(
      ".notes-nav-section",
    ) as HTMLDetailsElement;
    const summary = container.querySelector(
      ".notes-nav-section-title",
    ) as HTMLElement;

    expect(section.open).toBe(true);
    summary.click();
    await waitFor(() => expect(section.open).toBe(false));
    summary.click();
    await waitFor(() => expect(section.open).toBe(true));
  });

  it("drags a note to another notebook with a live ghost and drop highlight", async () => {
    const moveNote = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        _payload: {
          notebookId: string;
          noteId: string;
          targetNotebookId: string;
          expectedVersion?: number;
        },
      ) => ({}),
    );
    const store = storeWithGateway({ moveNote });
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-list-item.notes-tree-note")).toBeTruthy(),
    );

    const note = container.querySelector(
      ".notes-list-item.notes-tree-note",
    ) as HTMLElement;
    const targetBranch = [...container.querySelectorAll(".notes-notebook-branch")].find(
      (branch) =>
        (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Journal"),
    ) as HTMLDetailsElement;
    expect(targetBranch).toBeTruthy();

    // jsdom has no layout engine, so hit-testing returns nothing; route every
    // probe to the target notebook branch to exercise the drop pipeline.
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = (() => targetBranch) as unknown as typeof document.elementFromPoint;
    try {
      note.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: 10,
          clientY: 10,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: 30,
          clientY: 10,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
      await waitFor(() =>
        expect(document.body.classList.contains("notes-dragging")).toBe(true),
      );
      expect(document.querySelector(".notes-drag-ghost")).toBeTruthy();
      expect(targetBranch.classList.contains("drop-target")).toBe(true);

      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: 30,
          clientY: 10,
          button: 0,
          buttons: 0,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
      await waitFor(() => expect(moveNote).toHaveBeenCalled());
      const payload = moveNote.mock.calls[0][2] as {
        notebookId: string;
        noteId: string;
        targetNotebookId: string;
      };
      expect(payload.notebookId).toBe("book-1");
      expect(payload.noteId).toBe("note-1");
      expect(payload.targetNotebookId).toBe("book-2");
      expect(document.querySelector(".notes-drag-ghost")).toBeNull();
      expect(document.body.classList.contains("notes-dragging")).toBe(false);
    } finally {
      if (originalElementFromPoint === undefined) {
        delete (document as unknown as Record<string, unknown>).elementFromPoint;
      } else {
        document.elementFromPoint = originalElementFromPoint;
      }
    }
  });

  it("lists trash and restores or purges trashed notes", async () => {
    const listTrash = vi.fn(async () => ({
      trash: [
        {
          notebookId: "book-1",
          note: SNAPSHOT.notes[0],
          deletedAt: "2026-08-09T00:00:00Z",
        },
      ],
    }));
    const restoreTrash = vi.fn(async () => ({ note: NOTE }));
    const purgeTrash = vi.fn(async () => ({}));
    const store = storeWithGateway({ listTrash, restoreTrash, purgeTrash });
    await store.getState().loadTrash();
    expect(store.getState().trash).toHaveLength(1);
    expect(store.getState().trash[0].note.title).toBe("Roadmap");

    await store.getState().restoreFromTrash(store.getState().trash[0]);
    expect(restoreTrash).toHaveBeenCalledWith("programming", "ws-1", "book-1", "note-1");
    expect(listTrash).toHaveBeenCalledTimes(2);

    await store.getState().purgeFromTrash(store.getState().trash[0]);
    expect(purgeTrash).toHaveBeenCalledWith("programming", "ws-1", "book-1", "note-1");
  });

  it("empties the trash through the store", async () => {
    const listTrash = vi.fn(async () => ({ trash: [] }));
    const emptyTrash = vi.fn(async () => ({ emptied: 2 }));
    const store = storeWithGateway({ listTrash, emptyTrash });
    await store.getState().emptyTrash();
    expect(emptyTrash).toHaveBeenCalledWith("programming", "ws-1");
    expect(listTrash).toHaveBeenCalledTimes(1);
  });

  it("renders the trash view with restore and purge actions", async () => {
    const listTrash = vi.fn(async () => ({
      trash: [
        {
          notebookId: "book-1",
          note: SNAPSHOT.notes[0],
          deletedAt: "2026-08-09T00:00:00Z",
        },
      ],
    }));
    const store = storeWithGateway({ listTrash });
    await store.getState().load();
    await store.getState().loadTrash();
    store.getState().setMode("trash");
    const { container } = render(<NotesContent store={store} />);
    expect(container.querySelector(".notes-trash-panel")).toBeTruthy();
    expect(container.textContent).toContain(t("Trash"));
    expect(container.textContent).toContain("Roadmap");
    expect(container.querySelector(".notes-trash-restore")).toBeTruthy();
    expect(container.querySelector(".notes-trash-purge")).toBeTruthy();
    expect(container.textContent).toContain("Projects");
    const emptyBtn = container.querySelector(".notes-trash-empty") as HTMLButtonElement;
    expect(emptyBtn).toBeTruthy();
    expect(emptyBtn.textContent).toContain(t("Empty trash"));
    emptyBtn.click();
    await waitFor(() =>
      expect(container.querySelector(".notes-trash-empty")?.textContent).toContain(
        t("Confirm empty trash"),
      ),
    );
  });

  it("shows the empty trash state", async () => {
    const store = storeWithGateway();
    await store.getState().loadTrash();
    store.getState().setMode("trash");
    const { container } = render(<NotesContent store={store} />);
    expect(container.textContent).toContain(t("Trash is empty"));
  });

  it("handles Ctrl+N, Ctrl+Shift+T, and Ctrl+S notes shortcuts", async () => {
    const create = vi.fn(async () => ({ note: { ...NOTE, id: "note-9", title: "Untitled note" } }));
    const save = vi.fn(async () => ({ note: { ...NOTE, title: "Untitled note" } }));
    const app = setupNotesApp({
      gateway: gatewayStub({ create, save }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() => expect(content.querySelector(".notes-empty-library")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());
    expect(create).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(content.querySelector(".notes-trash-panel")).toBeTruthy());

    const allNotes = [...nav.querySelectorAll(".notes-nav-button")].find((button) =>
      (button.textContent ?? "").includes(t("All notes")),
    ) as HTMLButtonElement;
    allNotes.click();
    await waitFor(() => expect(content.querySelector(".notes-empty-library")).toBeTruthy());
    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(save).toHaveBeenCalled();

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
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

  it("awaits an async confirmation before deleting a notebook", async () => {
    const deleteNotebook = vi.fn(async () => ({ deleted: true }));
    const store = createNotesStore({
      gateway: gatewayStub({ deleteNotebook }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      confirmDelete: async () => false,
    });
    await store.getState().load();
    await store.getState().deleteNotebook("book-1");
    expect(deleteNotebook).not.toHaveBeenCalled();

    const accepting = createNotesStore({
      gateway: gatewayStub({ deleteNotebook }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      confirmDelete: async () => true,
    });
    await accepting.getState().load();
    await accepting.getState().deleteNotebook("book-1");
    expect(deleteNotebook).toHaveBeenCalledWith("programming", "ws-1", "book-1");
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

  it("renders a clickable heading outline in preview mode", async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const store = storeWithGateway();
      await store.getState().load();
      await store.getState().selectNote(SNAPSHOT.notes[0]);
      const { container } = render(<NotesContent store={store} />);
      await waitFor(() =>
        expect(container.querySelector(".notes-outline")).toBeTruthy(),
      );
      expect(container.querySelector(".notes-outline li.active")).toBeTruthy();
      expect(container.querySelector(".notes-outline button")?.textContent).toBe("Plan");
      (container.querySelector(".notes-outline button") as HTMLButtonElement).click();
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("selects notes and moves them through the batch bar", async () => {
    const moveNote = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        _payload: {
          notebookId: string;
          noteId: string;
          targetNotebookId: string;
          expectedVersion?: number;
        },
      ) => ({}),
    );
    const store = storeWithGateway({ moveNote });
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() => expect(container.querySelector(".notes-list-item")).toBeTruthy());

    (container.querySelector(".notes-select-mode") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-select-check")).toBeTruthy(),
    );
    (container.querySelector(".notes-list-item") as HTMLElement).click();
    await waitFor(() => expect(container.querySelector(".notes-batch-bar")).toBeTruthy());
    expect(container.textContent).toContain(t("Selected"));

    (container.querySelector(".notes-batch-bar .ui-button") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-batch-move-item")).toBeTruthy(),
    );
    const target = [...container.querySelectorAll(".notes-batch-move-item")].find((button) =>
      (button.textContent ?? "").includes("Journal"),
    ) as HTMLButtonElement;
    target.click();
    await waitFor(() => expect(moveNote).toHaveBeenCalled());
    expect(moveNote.mock.calls[0][2]).toMatchObject({
      noteId: "note-1",
      targetNotebookId: "book-2",
    });
    expect(store.getState().selectMode).toBe(false);
  });

  it("moves every selected note to the target notebook", async () => {
    const moveNote = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        _payload: {
          notebookId: string;
          noteId: string;
          targetNotebookId: string;
          expectedVersion?: number;
        },
      ) => ({}),
    );
    const store = createNotesStore({
      gateway: gatewayStub({
        moveNote,
        list: vi.fn(async () => ({
          snapshot: {
            notebooks: SNAPSHOT.notebooks,
            notes: [
              SNAPSHOT.notes[0],
              {
                id: "note-2",
                notebookId: "book-1",
                title: "Second",
                updatedAt: "2026-07-31T08:00:00Z",
              },
            ],
            tags: SNAPSHOT.tags,
          },
        })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    await store.getState().load();
    store.getState().toggleSelectMode();
    store.getState().toggleNoteSelected("note-1");
    store.getState().toggleNoteSelected("note-2");
    await store.getState().moveSelectedNotes("book-2");
    expect(moveNote).toHaveBeenCalledTimes(2);
    expect(moveNote.mock.calls[0][2]).toMatchObject({
      noteId: "note-1",
      targetNotebookId: "book-2",
    });
    expect(moveNote.mock.calls[1][2]).toMatchObject({
      noteId: "note-2",
      targetNotebookId: "book-2",
    });
    expect(store.getState().selectMode).toBe(false);
    expect(store.getState().selectedNoteIds).toEqual([]);
  });

  it("deletes every selected note into the trash", async () => {
    const del = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        _note: { id: string; notebookId: string; version?: number },
      ) => ({}),
    );
    const listTrash = vi.fn(async () => ({ trash: [] }));
    const store = createNotesStore({
      gateway: gatewayStub({
        delete: del,
        listTrash,
        list: vi.fn(async () => ({
          snapshot: {
            notebooks: SNAPSHOT.notebooks,
            notes: [
              SNAPSHOT.notes[0],
              {
                id: "note-2",
                notebookId: "book-1",
                title: "Second",
                updatedAt: "2026-07-31T08:00:00Z",
              },
            ],
            tags: SNAPSHOT.tags,
          },
        })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    await store.getState().load();
    store.getState().toggleSelectMode();
    store.getState().toggleNoteSelected("note-1");
    store.getState().toggleNoteSelected("note-2");
    await store.getState().deleteSelectedNotes();
    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls[0][2]).toMatchObject({ id: "note-1" });
    expect(del.mock.calls[1][2]).toMatchObject({ id: "note-2" });
    expect(store.getState().selectMode).toBe(false);
    expect(store.getState().selectedNoteIds).toEqual([]);
    expect(listTrash).toHaveBeenCalled();
  });

  it("deletes selected notes to trash with confirmation", async () => {
    const del = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        _note: { id: string; notebookId: string; version?: number },
      ) => ({}),
    );
    const store = storeWithGateway({ delete: del });
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() => expect(container.querySelector(".notes-list-item")).toBeTruthy());

    (container.querySelector(".notes-select-mode") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-select-check")).toBeTruthy(),
    );
    (container.querySelector(".notes-list-item") as HTMLElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-batch-delete")).toBeTruthy(),
    );
    const deleteBtn = container.querySelector(".notes-batch-delete") as HTMLButtonElement;
    expect(deleteBtn.textContent).toContain(t("Delete selected"));
    deleteBtn.click();
    await waitFor(() =>
      expect(container.querySelector(".notes-batch-delete")?.textContent).toContain(
        t("Confirm delete selected"),
      ),
    );
    (container.querySelector(".notes-batch-delete") as HTMLButtonElement).click();
    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(del.mock.calls[0][2]).toMatchObject({ id: "note-1" });
    expect(store.getState().selectMode).toBe(false);
  });

  it("closes the move-to-notebook popover with Escape", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    const moveBtn = container.querySelector(".notes-move-btn") as HTMLButtonElement | null;
    expect(moveBtn).toBeTruthy();
    moveBtn?.click();
    await waitFor(() => expect(container.querySelector(".notes-move-popover")).toBeTruthy());

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => expect(container.querySelector(".notes-move-popover")).toBeNull());
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
    expect(document.querySelector(".notes-empty-quickstart")).toBeTruthy();
    expect(document.body.textContent).toContain(t("Quick start"));
  });
});
