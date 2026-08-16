import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { t } from "../../shared/i18n";
import {
  allTagSuggestions,
  buildChildrenByParent,
  buildHeadingOutline,
  conversationNoteTitle,
  estimateReadingMinutes,
  findActiveOutlineId,
  formatDate,
  formatRelativeTime,
  highlightSegments,
  noteFrontmatter,
  parseTags,
  safeFileName,
  sortNotesByRelevance,
  stripMarkdown,
  tagIcon,
} from "./notesLogic";
import { NotesContent, NotesNav, markUnresolvedWikilinks, wikilinkMarkdown } from "./NotesApp";
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
    knowledge: vi.fn(async () => ({ snapshot: { links: [] } })),
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
    exportAllBackup: vi.fn(async () => ({ backup: { notebooks: [] } })),
    importBackup: vi.fn(async () => ({ notebook: { id: "book-9", title: "Imported" } })),
    importAllBackup: vi.fn(async () => ({ notebooks: [] })),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("notes logic", () => {
  it("converts wikilinks to note links for the preview", () => {
    expect(wikilinkMarkdown("See [[Design]] and [[Roadmap]]")).toBe(
      "See [Design](zicode-note://Design) and [Roadmap](zicode-note://Roadmap)",
    );
    expect(wikilinkMarkdown("No link here")).toBe("No link here");
    expect(
      wikilinkMarkdown("```js\nconst x = [[1, 2]];\n```\nSee [[Design]]"),
    ).toBe("```js\nconst x = [[1, 2]];\n```\nSee [Design](zicode-note://Design)");
    expect(wikilinkMarkdown("Inline `[[a, b]]` and [[Design]]")).toBe(
      "Inline `[[a, b]]` and [Design](zicode-note://Design)",
    );
  });

  it("strips markdown syntax from search snippets", () => {
    expect(stripMarkdown("# Heading\n\nSome **bold** and `code` with [a link](https://x)")).toBe(
      "Heading Some bold and code with a link",
    );
    expect(stripMarkdown("- item one\n- item two")).toBe("item one item two");
  });

  it("ranks title matches above content-only matches", () => {
    const notes = [
      { title: "Changelog" },
      { title: "Roadmap" },
      { title: "Design" },
    ];
    expect(sortNotesByRelevance(notes, "road").map((note) => note.title)).toEqual([
      "Roadmap",
      "Changelog",
      "Design",
    ]);
  });

  it("marks wikilinks to non-existent notes as unresolved", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<a href="zicode-note://Roadmap">Roadmap</a><a href="zicode-note://Missing">Missing</a>';
    markUnresolvedWikilinks(root, [
      { id: "note-1", notebookId: "book-1", title: "Roadmap" },
    ]);
    expect(root.querySelector('a[href="zicode-note://Roadmap"]')?.className).toBe("");
    expect(root.querySelector('a[href="zicode-note://Missing"]')?.className).toContain(
      "notes-wikilink-unresolved",
    );
  });

  it("parses tags, dates, titles, and file names", () => {
    expect(parseTags("a, #b, c")).toEqual(["a", "b", "c"]);
    expect(formatDate("2026-07-31T08:00:00Z")).toBeTruthy();
    expect(formatDate("2020-03-01T08:00:00Z")).toContain("2020");
    expect(formatDate("invalid")).toBe("");
    expect(formatRelativeTime(new Date().toISOString())).toBeTruthy();
    expect(formatRelativeTime("invalid")).toBe("");
    expect(conversationNoteTitle("First line\nSecond")).toBe("First line");
    expect(conversationNoteTitle("x".repeat(80))).toHaveLength(61);
    expect(conversationNoteTitle("# Heading\nBody")).toBe("Heading");
    expect(conversationNoteTitle("## Deep heading\nBody")).toBe("Deep heading");
    expect(noteFrontmatter("Roadmap", ["plugin"])).toContain('title: "Roadmap"');
    expect(noteFrontmatter("Roadmap", ["plugin"])).toContain("  - plugin");
    expect(noteFrontmatter("Roadmap", [])).not.toContain("tags:");
    expect(noteFrontmatter("Roadmap", [], "https://example.com/article")).toContain(
      'source: "https://example.com/article"',
    );
    expect(safeFileName('a/b:c')).toBe("a-b-c");
    expect(tagIcon("idea")).toBe("💡");
    expect(tagIcon("custom")).toBe("🏷️");
    expect(estimateReadingMinutes("")).toBe(0);
    expect(estimateReadingMinutes("word ".repeat(200))).toBe(1);
    expect(estimateReadingMinutes("你好世界".repeat(100))).toBe(1);
    expect(estimateReadingMinutes("こんにちは".repeat(100))).toBe(1);
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
      { id: "note-h-intro", level: 1, text: "Intro" },
      { id: "note-h-setup", level: 2, text: "Setup" },
      { id: "note-h-setup-2", level: 2, text: "Setup" },
      { id: "note-h-deep", level: 3, text: "Deep" },
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

    const captureFailed = new Error("Cannot retrieve the web page") as Error & {
      code?: string;
    };
    captureFailed.code = "capture_failed";
    expect(localizeNotesHostError(captureFailed).message).toBe(
      t("Cannot retrieve the page. Check your network or proxy settings."),
    );

    const unknown = new Error("Unrelated failure");
    expect(localizeNotesHostError(unknown)).toBe(unknown);
  });

  it("loads backlinks for the selected note and skips self-links", async () => {
    const store = storeWithGateway({
      knowledge: vi.fn(async () => ({
        snapshot: {
          links: [
            {
              fromNotebookId: "book-2",
              fromNoteId: "note-2",
              fromTitle: "Source Note",
              toNotebookId: "book-1",
              toNoteId: "note-1",
              toTitle: "Roadmap",
              kind: "wikilink",
            },
            {
              fromNotebookId: "book-1",
              fromNoteId: "note-1",
              fromTitle: "Roadmap",
              toNotebookId: "book-1",
              toNoteId: "note-1",
              toTitle: "Roadmap",
              kind: "reference",
            },
            {
              fromNotebookId: "book-3",
              fromNoteId: "note-3",
              fromTitle: "Other",
              toNotebookId: "book-9",
              toNoteId: "note-9",
              toTitle: "Other",
              kind: "wikilink",
            },
          ],
          similar: [
            {
              leftNotebookId: "book-1",
              leftNoteId: "note-1",
              leftTitle: "Roadmap",
              rightNotebookId: "book-2",
              rightNoteId: "note-2",
              rightTitle: "Source Note",
              sharedTags: ["plugin"],
            },
          ],
        },
      })),
    });
    await store.getState().loadBacklinks(NOTE);
    expect(store.getState().backlinks).toEqual([
      { notebookId: "book-2", noteId: "note-2", title: "Source Note", kind: "wikilink" },
    ]);
    expect(store.getState().similarNotes).toEqual([
      { notebookId: "book-2", noteId: "note-2", title: "Source Note", sharedTags: ["plugin"] },
    ]);
  });

  it("ignores a stale backlinks response after a newer note is selected", async () => {
    type KnowledgeResponse = Awaited<ReturnType<NotesGatewayLike["knowledge"]>>;
    let resolveFirst!: (value: KnowledgeResponse) => void;
    let resolveSecond!: (value: KnowledgeResponse) => void;
    const first = new Promise<KnowledgeResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<KnowledgeResponse>((resolve) => {
      resolveSecond = resolve;
    });
    const knowledge = vi
      .fn<NotesGatewayLike["knowledge"]>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const store = storeWithGateway({ knowledge });

    const firstCall = store.getState().loadBacklinks({ ...NOTE, id: "note-1" });
    const secondCall = store.getState().loadBacklinks({ ...NOTE, id: "note-2" });

    resolveSecond({
      snapshot: {
        links: [
          {
            fromNotebookId: "book-2",
            fromNoteId: "note-2",
            fromTitle: "Newer",
            toNotebookId: "book-1",
            toNoteId: "note-2",
            toTitle: "Roadmap",
            kind: "wikilink",
          },
        ],
      },
    });
    await secondCall;

    resolveFirst({
      snapshot: {
        links: [
          {
            fromNotebookId: "book-2",
            fromNoteId: "note-2",
            fromTitle: "Older",
            toNotebookId: "book-1",
            toNoteId: "note-1",
            toTitle: "Roadmap",
            kind: "wikilink",
          },
        ],
      },
    });
    await firstCall;

    expect(store.getState().backlinks).toEqual([
      { notebookId: "book-2", noteId: "note-2", title: "Newer", kind: "wikilink" },
    ]);
  });

  it("suggests and inserts a wikilink while typing [[", async () => {
    const twoNoteSnapshot: NotesSnapshot = {
      notebooks: [{ id: "book-1", title: "Projects", icon: "🚀", noteCount: 2 }],
      notes: [
        { id: "note-1", notebookId: "book-1", title: "Roadmap", updatedAt: "2026-07-31T08:00:00Z" },
        { id: "note-2", notebookId: "book-1", title: "Design", updatedAt: "2026-07-31T09:00:00Z" },
      ],
      tags: [],
    };
    const app = setupNotesApp({
      gateway: gatewayStub({
        list: vi.fn(async () => ({ snapshot: twoNoteSnapshot })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() =>
      expect(nav.querySelector(".notes-list-item.notes-tree-note")).toBeTruthy(),
    );
    (nav.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());

    (content.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() => expect(content.querySelector(".notes-content-input")).toBeTruthy());
    const textarea = content.querySelector(".notes-content-input") as HTMLTextAreaElement;
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("textarea value setter missing");
    setter.call(textarea, "See [[Des");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => {
      expect(content.querySelector(".notes-link-suggestions")).toBeTruthy();
    });
    const suggestion = [...content.querySelectorAll(".notes-link-suggestion")].find((button) =>
      (button.textContent ?? "").includes("Design"),
    ) as HTMLButtonElement;
    suggestion.click();

    await waitFor(() => {
      expect((content.querySelector(".notes-content-input") as HTMLTextAreaElement).value).toBe(
        "See [[Design]]",
      );
    });

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("navigates wikilink suggestions with arrow keys", async () => {
    const threeNoteSnapshot: NotesSnapshot = {
      notebooks: [{ id: "book-1", title: "Projects", icon: "🚀", noteCount: 3 }],
      notes: [
        { id: "note-1", notebookId: "book-1", title: "Roadmap", updatedAt: "2026-07-31T08:00:00Z" },
        { id: "note-2", notebookId: "book-1", title: "Design", updatedAt: "2026-07-31T09:00:00Z" },
        { id: "note-3", notebookId: "book-1", title: "Demo", updatedAt: "2026-07-31T10:00:00Z" },
      ],
      tags: [],
    };
    const app = setupNotesApp({
      gateway: gatewayStub({
        list: vi.fn(async () => ({ snapshot: threeNoteSnapshot })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() =>
      expect(nav.querySelector(".notes-list-item.notes-tree-note")).toBeTruthy(),
    );
    (nav.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());
    (content.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() => expect(content.querySelector(".notes-content-input")).toBeTruthy());
    const textarea = content.querySelector(".notes-content-input") as HTMLTextAreaElement;
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("textarea value setter missing");
    setter.call(textarea, "See [[De");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() =>
      expect(content.querySelectorAll(".notes-link-suggestion").length).toBeGreaterThanOrEqual(2),
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitFor(() => {
      const active = content.querySelector(".notes-link-suggestion.is-active");
      expect(active?.textContent ?? "").toContain("Design");
    });
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    await waitFor(() => {
      expect((content.querySelector(".notes-content-input") as HTMLTextAreaElement).value).toBe(
        "See [[Design]]",
      );
    });

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
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

  it("surfaces captured source metadata in the preview", async () => {
    const store = storeWithGateway({
      get: vi.fn(async () => ({
        note: {
          ...NOTE,
          source: {
            url: "https://example.com/article",
            siteName: "Example Site",
            author: "Alice",
            publishedAt: "2026-07-30T00:00:00Z",
            capturedAt: "2026-07-31T08:00:00Z",
          },
        },
      })),
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    const source = await waitFor(() => {
      const element = container.querySelector(".notes-source");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(source.textContent).toContain("Example Site");
    expect(source.textContent).toContain("Alice");
    expect(source.textContent).toContain("发布于");
    expect(source.textContent).toContain("剪藏于");
  });

  it("copies the captured source URL", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      clipboard: { writeText },
    });
    const store = storeWithGateway({
      get: vi.fn(async () => ({
        note: {
          ...NOTE,
          source: { url: "https://example.com/article" },
        },
      })),
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    const copy = await waitFor(
      () => container.querySelector(".notes-source-copy") as HTMLButtonElement,
    );
    copy.click();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://example.com/article"));
  });

  it("clears the search query when showing all notes", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    store.getState().setQuery("road");
    await store.getState().applyFilter({});
    expect(store.getState().query).toBe("");
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
    await waitFor(() => expect(onUseInChat).toHaveBeenCalledTimes(1));
    expect(onUseInChat.mock.calls[0][1]).toBe("content with a selected");
  });

  it("carries selected preview text into the chat", async () => {
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
      title: "Preview selection",
    });
    const { container } = render(<NotesContent store={store} />);
    const previewEl = container.querySelector(".notes-preview") as HTMLElement;
    await waitFor(() => expect(previewEl).toBeTruthy());
    // Simulate a window selection anchored inside the rendered preview.
    const selectionStub = {
      rangeCount: 1,
      anchorNode: previewEl,
      toString: () => "highlighted phrase",
    };
    vi.spyOn(window, "getSelection").mockReturnValue(selectionStub as unknown as Selection);
    const useInChat = container.querySelector(".notes-use-in-chat") as HTMLButtonElement;
    useInChat.click();
    await waitFor(() => expect(onUseInChat).toHaveBeenCalledTimes(1));
    expect(onUseInChat.mock.calls[0][1]).toBe("highlighted phrase");
  });

  it("saves pending edits before discussing a note in chat", async () => {
    const onUseInChat = vi.fn();
    const gateway = gatewayStub();
    const store = createNotesStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      onUseInChat,
    });
    await store.getState().load();
    await store.getState().selectNote({ ...SNAPSHOT.notes[0], title: "Dirty note" });
    const note = store.getState().selectedNote as Note;
    store.getState().setDraft({ content: "unsaved edit" });
    expect(store.getState().dirty).toBe(true);
    await store.getState().discussInChat(note, "");
    expect(gateway.save).toHaveBeenCalledTimes(1);
    expect(onUseInChat).toHaveBeenCalledTimes(1);
    expect(onUseInChat.mock.calls[0][0].title).toBe("Updated");
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

  it("moves focus between notebook summaries and notes with arrow keys", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-notebook-summary")).toBeTruthy(),
    );

    const summary = container.querySelector(
      ".notes-notebook-summary",
    ) as HTMLElement;
    summary.click();
    await waitFor(() =>
      expect(
        (summary.closest("details") as HTMLDetailsElement).open,
      ).toBe(true),
    );

    summary.focus();
    summary.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement?.matches(".notes-tree-note")).toBe(true);
  });

  it("expands and collapses a notebook with left/right arrow keys", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    const { container } = render(<NotesNav store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-notebook-summary")).toBeTruthy(),
    );

    const summary = container.querySelector(
      ".notes-notebook-summary",
    ) as HTMLElement;
    const branch = summary.closest("details") as HTMLDetailsElement;
    expect(branch.open).toBe(false);

    summary.focus();
    summary.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await waitFor(() => expect(branch.open).toBe(true));

    summary.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await waitFor(() => expect(branch.open).toBe(false));
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

  it("duplicates the current note with Ctrl+D", async () => {
    const create = vi.fn(async () => ({
      note: { ...NOTE, id: "note-9", title: "Roadmap (副本)" },
    }));
    const list = vi.fn(async () => ({
      snapshot: {
        ...SNAPSHOT,
        notes: [
          ...SNAPSHOT.notes,
          { id: "note-9", notebookId: "book-1", title: "Roadmap (副本)" },
        ],
      },
    }));
    const app = setupNotesApp({
      gateway: gatewayStub({ create, list }),
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

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      "programming",
      "ws-1",
      "book-1",
      expect.objectContaining({ title: "Roadmap (副本)" }),
    );

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("copies the current note markdown with Ctrl+Shift+C", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const app = setupNotesApp({
      gateway: gatewayStub(),
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

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toContain("# Plan");

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("discusses the current note with Ctrl+Enter", async () => {
    const onUseInChat = vi.fn();
    const app = setupNotesApp({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      onUseInChat,
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() => expect(content.querySelector(".notes-empty-library")).toBeTruthy());

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(onUseInChat).toHaveBeenCalledTimes(1));

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("discusses only the selected text with Ctrl+Enter in edit mode", async () => {
    const onUseInChat = vi.fn();
    const app = setupNotesApp({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      onUseInChat,
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() => expect(content.querySelector(".notes-empty-library")).toBeTruthy());

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());
    (content.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() => expect(content.querySelector(".notes-content-input")).toBeTruthy());
    const textarea = content.querySelector(".notes-content-input") as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(2, 6);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(onUseInChat).toHaveBeenCalledTimes(1));
    expect(onUseInChat.mock.calls[0][1]).toBe("Plan");

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("indents the note content with Tab", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "ab" });
    const { container } = render(<NotesContent store={store} />);
    (container.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-content-input")).toBeTruthy(),
    );
    const textarea = container.querySelector(
      ".notes-content-input",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(store.getState().draftContent).toBe("a  b"));
  });

  it("wraps the selected note content in bold with Ctrl+B", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "ab" });
    const { container } = render(<NotesContent store={store} />);
    (container.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-content-input")).toBeTruthy(),
    );
    const textarea = container.querySelector(
      ".notes-content-input",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 2);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(store.getState().draftContent).toBe("**ab**"));
  });

  it("wraps the selected note content in italics with Ctrl+I", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "ab" });
    const { container } = render(<NotesContent store={store} />);
    (container.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-content-input")).toBeTruthy(),
    );
    const textarea = container.querySelector(
      ".notes-content-input",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 2);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "i",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(store.getState().draftContent).toBe("*ab*"));
  });

  it("dedents the note content with Shift+Tab", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "  ab" });
    const { container } = render(<NotesContent store={store} />);
    (container.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-content-input")).toBeTruthy(),
    );
    const textarea = container.querySelector(
      ".notes-content-input",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(store.getState().draftContent).toBe("ab"));
  });

  it("indents the selected line with Tab instead of replacing the selection", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "abc" });
    const { container } = render(<NotesContent store={store} />);
    (container.querySelector(".notes-edit-tab") as HTMLButtonElement).click();
    await waitFor(() =>
      expect(container.querySelector(".notes-content-input")).toBeTruthy(),
    );
    const textarea = container.querySelector(
      ".notes-content-input",
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(1, 2);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(store.getState().draftContent).toBe("  abc"));
  });

  it("does not discuss an empty note with Ctrl+Enter", async () => {
    const onUseInChat = vi.fn();
    const app = setupNotesApp({
      gateway: gatewayStub({
        get: vi.fn(async () => ({ note: { ...NOTE, content: "" } })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      onUseInChat,
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() => expect(content.querySelector(".notes-empty-library")).toBeTruthy());

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onUseInChat).not.toHaveBeenCalled();

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("downloads the current note with Ctrl+Shift+D", async () => {
    const downloadFile = vi.fn();
    const app = setupNotesApp({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      downloadFile,
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app?.renderNavigation(nav);
    app?.renderContent(content);
    document.body.dataset.activePlugin = "com.zicode.notes";
    await waitFor(() => expect(content.querySelector(".notes-empty-library")).toBeTruthy());

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));

    app?.destroy();
    document.body.dataset.activePlugin = "";
    nav.remove();
    content.remove();
  });

  it("toggles edit and preview with Ctrl+E", async () => {
    const app = setupNotesApp({
      gateway: gatewayStub(),
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

    const notebookBranch = [...nav.querySelectorAll(".notes-notebook-branch")].find((branch) =>
      (branch.querySelector(".notes-notebook-title")?.textContent ?? "").includes("Projects"),
    );
    (notebookBranch?.querySelector(".notes-list-item.notes-tree-note") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".notes-editor")).toBeTruthy());
    expect(content.querySelector(".notes-preview")).toBeTruthy();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "e", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(content.querySelector(".notes-content-input")).toBeTruthy());

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "e", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(content.querySelector(".notes-preview")).toBeTruthy());

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

  it("pins and unpins a note for quick access", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    store.getState().togglePinned("note-1");
    expect(store.getState().pinnedNoteIds).toEqual(["note-1"]);
    await vi.waitFor(() =>
      expect(store.getState().pinnedNotes.map((note) => note.id)).toContain("note-1"),
    );
    store.getState().togglePinned("note-1");
    expect(store.getState().pinnedNoteIds).toEqual([]);
    await vi.waitFor(() => expect(store.getState().pinnedNotes).toEqual([]));
  });

  it("pins the current note from the editor title row", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-editor")).toBeTruthy(),
    );
    const pinButton = container.querySelector(
      ".notes-title-row .notes-pin-btn",
    ) as HTMLButtonElement;
    pinButton.click();
    expect(store.getState().pinnedNoteIds).toEqual(["note-1"]);
  });

  it("clears the capturing flag and surfaces a localized capture error", async () => {
    const capture = vi.fn(async () => {
      throw new Error("Page is unreachable: timeout");
    });
    const store = storeWithGateway({ capture });
    await store.getState().load();
    await expect(
      store.getState().captureUrl({
        url: "https://example.com",
        title: "",
        notebookId: "book-1",
        tags: [],
      }),
    ).rejects.toThrow();
    expect(store.getState().capturing).toBe(false);
    expect(store.getState().error).toBeTruthy();
  });

  it("surfaces a localized notebook-creation error instead of swallowing it", async () => {
    const createNotebook = vi.fn(async () => {
      throw new Error("Notes backup contains too many notes");
    });
    const store = storeWithGateway({ createNotebook });
    await store.getState().load();
    await expect(
      store.getState().createNotebook("Projects", "🚀"),
    ).rejects.toThrow();
    expect(store.getState().error).toBeTruthy();
    expect(store.getState().loading).toBe(false);
  });

  it("surfaces a localized notebook-rename error instead of swallowing it", async () => {
    const updateNotebook = vi.fn(async () => {
      throw new Error("Notebook not found");
    });
    const store = storeWithGateway({ updateNotebook });
    await store.getState().load();
    await expect(
      store.getState().updateNotebook("book-1", "Renamed", "🚀"),
    ).rejects.toThrow();
    expect(store.getState().error).toBeTruthy();
    expect(store.getState().loading).toBe(false);
  });

  it("passes the parent id when re-parenting a notebook", async () => {
    const updateNotebook = vi.fn(async () => ({}));
    const store = storeWithGateway({ updateNotebook });
    await store.getState().load();
    await store.getState().updateNotebook("book-1", "Renamed", "🚀", "book-2");
    expect(updateNotebook).toHaveBeenCalledWith(
      "programming",
      "ws-1",
      expect.objectContaining({ notebookId: "book-1", parentId: "book-2" }),
    );
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
    await store.getState().selectNotebook("book-1");
    await store.getState().exportBackup();
    expect(downloadFile).toHaveBeenCalledOnce();
    const [fileName, content] = downloadFile.mock.calls[0];
    expect(fileName).toBe("Projects.zicode-notes.json");
    expect(JSON.parse(content)).toMatchObject({ schemaVersion: 1 });
  });

  it("exports every notebook as one workspace backup through the download hook", async () => {
    const downloadFile = vi.fn();
    const exportAllBackup = vi.fn(async () => ({
      backup: { schemaVersion: 1, notebooks: [{ notebook: { id: "book-1" } }] },
    }));
    const store = createNotesStore({
      gateway: gatewayStub({ exportAllBackup }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      downloadFile,
    });
    await store.getState().exportAllBackup();
    expect(exportAllBackup).toHaveBeenCalledWith("programming", "ws-1");
    expect(downloadFile).toHaveBeenCalledOnce();
    const [fileName, content] = downloadFile.mock.calls[0];
    expect(fileName).toBe("zicode-notes-all-ws-1.json");
    expect(JSON.parse(content).notebooks).toHaveLength(1);
  });

  it("saves pending edits before exporting a backup", async () => {
    const order: string[] = [];
    const gateway = gatewayStub({
      save: vi.fn(async () => {
        order.push("save");
        return { note: { ...NOTE, title: "Saved" } };
      }),
      exportAllBackup: vi.fn(async () => {
        order.push("export");
        return { backup: { notebooks: [] } };
      }),
    });
    const store = createNotesStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      downloadFile: vi.fn(),
    });
    await store.getState().load();
    await store.getState().selectNote({ ...SNAPSHOT.notes[0], title: "Dirty" });
    store.getState().setDraft({ content: "unsaved edit" });
    expect(store.getState().dirty).toBe(true);
    await store.getState().exportAllBackup();
    expect(order).toEqual(["save", "export"]);
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

  it("rejects a non-object notes backup", async () => {
    const importBackup = vi.fn(async () => ({ notebook: { id: "book-1", title: "Imported" } }));
    const store = createNotesStore({
      gateway: gatewayStub({ importBackup }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      chooseFile: vi.fn(
        async () => ({ size: 16, text: async () => '"hello"' }) as unknown as File,
      ),
    });
    await store.getState().load();
    await store.getState().importBackup();
    expect(importBackup).not.toHaveBeenCalled();
    expect(store.getState().error?.message).toContain("JSON");
  });

  it("imports every notebook from a workspace backup bundle", async () => {
    const importAllBackup = vi.fn(async () => ({
      notebooks: [
        { id: "book-1", title: "Alpha (Imported)" },
        { id: "book-2", title: "Beta (Imported)" },
      ],
    }));
    const store = createNotesStore({
      gateway: gatewayStub({ importAllBackup }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      chooseFile: vi.fn(
        async () =>
          ({
            size: 128,
            text: async () =>
              JSON.stringify({
                schemaVersion: 1,
                notebooks: [{ notebook: { title: "Alpha" } }],
              }),
          }) as unknown as File,
      ),
    });
    await store.getState().load();
    await store.getState().importAllBackup();
    expect(importAllBackup).toHaveBeenCalledOnce();
    expect(store.getState().selectedNotebookId).toBe("book-1");
    const backupArg = (importAllBackup.mock.calls[0] as unknown[])[2];
    expect(backupArg).toMatchObject({ schemaVersion: 1, notebooks: expect.any(Array) });
  });

  it("creates a new note and marks it for editing", async () => {
    const create = vi.fn(async () => ({ note: { ...NOTE, id: "note-1", title: "Untitled note" } }));
    const store = storeWithGateway({ create });
    await store.getState().load();
    await store.getState().newNote();
    expect(store.getState().selectedNote?.title).toBe("Untitled note");
    expect(store.getState().dirty).toBe(false);
  });

  it("clears tag/web-clip/search filters when creating a note so the editor stays open", async () => {
    const create = vi.fn(async () => ({ note: { ...NOTE, id: "note-1", title: "Untitled note" } }));
    const store = storeWithGateway({ create });
    await store.getState().load();
    await store.getState().applyFilter({ tag: "idea" });
    expect(store.getState().selectedTag).toBe("idea");
    await store.getState().newNote();
    expect(store.getState().selectedTag).toBeNull();
    expect(store.getState().sourceOnly).toBe(false);
    expect(store.getState().query).toBe("");
    expect(store.getState().selectedNote?.title).toBe("Untitled note");
  });

  it("duplicates the current note with a copy suffix and keeps its content", async () => {
    const create = vi.fn(async () => ({
      note: { ...NOTE, id: "note-9", title: "Roadmap (副本)" },
    }));
    const list = vi.fn(async () => ({
      snapshot: {
        ...SNAPSHOT,
        notes: [
          ...SNAPSHOT.notes,
          { id: "note-9", notebookId: "book-1", title: "Roadmap (副本)" },
        ],
      },
    }));
    const notify = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub({ create, list }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      getProject: () => ({ id: "ws-1", path: "C:/work", name: "work" }),
      notify,
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    await store.getState().duplicateNote();
    expect(create).toHaveBeenCalledWith(
      "programming",
      "ws-1",
      "book-1",
      expect.objectContaining({
        title: "Roadmap (副本)",
        content: "# Plan\n\nSafe content",
        tags: ["plugin"],
        icon: "📝",
      }),
    );
    expect(store.getState().selectedNote?.id).toBe("note-9");
    expect(notify).toHaveBeenCalledWith(t("Note duplicated"));
  });

  it("copies the live markdown to the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const notify = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      getProject: () => ({ id: "ws-1", path: "C:/work", name: "work" }),
      notify,
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    await store.getState().copyNote();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("# Plan\n\nSafe content"),
    );
    expect(String(writeText.mock.calls[0][0])).toContain('title: "Roadmap"');
    expect(notify).toHaveBeenCalledWith(t("Copied"));
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
    expect(notify).toHaveBeenCalledWith("笔记本已移入回收站，可在回收站恢复。");
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

  it("notifies only on manual save, not on autosave", async () => {
    const notify = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify,
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);

    store.getState().setDraft({ content: "Silent autosave" });
    await store.getState().saveEditor(true);
    expect(notify).not.toHaveBeenCalledWith(t("Note saved"));

    store.getState().setDraft({ content: "Manual save" });
    await store.getState().saveEditor();
    expect(notify).toHaveBeenCalledWith(t("Note saved"));
  });

  it("flushes a pending autosave when the window loses focus", async () => {
    const save = vi.fn(async (_sceneId: string, _workspaceId: string, note: Note) => ({
      note: { ...note, id: "note-1" },
    }));
    const store = storeWithGateway({ save });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    render(<NotesContent store={store} />);
    store.getState().setDraft({ content: "Draft before blur" });
    expect(store.getState().dirty).toBe(true);

    window.dispatchEvent(new Event("blur"));
    await waitFor(() => expect(save).toHaveBeenCalled());
  });

  it("auto-titles an untitled note from its first content line", async () => {
    const save = vi.fn(async (_sceneId: string, _workspaceId: string, note: Note) => ({
      note: { ...note, id: "note-1" },
    }));
    const store = storeWithGateway({ save });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({
      title: t("Untitled note"),
      content: "First line\nSecond line",
    });
    await store.getState().saveEditor();
    expect(save).toHaveBeenCalledWith(
      "programming",
      "ws-1",
      expect.objectContaining({ title: "First line" }),
    );
    expect(store.getState().draftTitle).toBe("First line");
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

  it("returns to the dirty state after a failed save instead of staying on saving", async () => {
    const save = vi.fn(async () => {
      throw new Error("save failed");
    });
    const store = storeWithGateway({ save });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ title: "Renamed" });
    await store.getState().saveEditor();
    expect(store.getState().saveState).toBe("dirty");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().error).toBeTruthy();
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

  it("downloads the current note as Markdown", async () => {
    const downloadFile = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      getProject: () => ({ id: "ws-1", path: "C:/work", name: "work" }),
      notify: vi.fn(),
      downloadFile,
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    await store.getState().downloadNote();

    expect(downloadFile).toHaveBeenCalledWith(
      "Roadmap.md",
      expect.stringContaining('title: "Roadmap"'),
      "text/markdown",
    );
  });

  it("downloads the live draft even when it has unsaved changes", async () => {
    const downloadFile = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      getProject: () => ({ id: "ws-1", path: "C:/work", name: "work" }),
      notify: vi.fn(),
      downloadFile,
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ title: "Draft title", content: "Draft body" });
    await store.getState().downloadNote();

    expect(downloadFile).toHaveBeenCalledWith(
      "Draft title.md",
      expect.stringContaining("Draft body"),
      "text/markdown",
    );
  });

  it("does not download an empty note", async () => {
    const downloadFile = vi.fn();
    const store = createNotesStore({
      gateway: gatewayStub({
        get: vi.fn(async () => ({ note: { ...NOTE, content: "" } })),
      }),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      getProject: () => ({ id: "ws-1", path: "C:/work", name: "work" }),
      notify: vi.fn(),
      downloadFile,
    });
    await store.getState().load();
    await store.getState().selectNote({ ...SNAPSHOT.notes[0] });
    await store.getState().downloadNote();
    expect(downloadFile).not.toHaveBeenCalled();
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
    expect(document.querySelector(".notes-editor-stats")?.textContent).toContain(
      String(NOTE.content.length),
    );
  });

  it("collapses secondary actions into a More menu on narrow screens", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setPreview(false);
    render(<NotesContent store={store} />);

    const moreButton = await waitFor(
      () => document.querySelector(".notes-more-btn") as HTMLButtonElement,
    );
    expect(moreButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".notes-more-menu")).toBeNull();
    expect(document.querySelector(".notes-editor-actions .notes-attach")).toBeNull();

    moreButton.click();
    await waitFor(() =>
      expect(document.querySelector(".notes-more-menu")).toBeTruthy(),
    );
    expect(document.querySelector(".notes-more-menu .notes-attach")).toBeTruthy();
    expect(document.querySelector(".notes-more-menu .notes-delete")).toBeTruthy();

    moreButton.click();
    await waitFor(() =>
      expect(document.querySelector(".notes-more-menu")).toBeNull(),
    );
  });

  it("focuses and selects the title when a new note is created", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.setState({ preview: false, focusTitleOnNextRender: true });
    render(<NotesContent store={store} />);
    const titleInput = document.querySelector(".notes-title-input") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(titleInput));
  });

  it("switches to preview mode and renders markdown", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setPreview(true);
    render(<NotesContent store={store} />);
    expect(document.querySelector(".notes-preview")).toBeTruthy();
  });

  it("shows an empty-state hint when previewing a blank note", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "" });
    store.getState().setPreview(true);
    render(<NotesContent store={store} />);
    expect(document.querySelector(".notes-preview-empty")).toBeTruthy();
  });

  it("disables Discuss-in-Chat for an empty note", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setDraft({ content: "" });
    store.getState().setPreview(false);
    render(<NotesContent store={store} />);
    const discuss = document.querySelector(".notes-use-in-chat") as HTMLButtonElement;
    expect(discuss.disabled).toBe(true);
  });

  it("preserves unsaved edits when toggling to preview", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    store.getState().setPreview(false);
    store.getState().setDraft({ content: "EDITED before preview" });
    expect(store.getState().dirty).toBe(true);

    store.getState().setPreview(true);

    expect(store.getState().draftContent).toBe("EDITED before preview");
    expect(store.getState().dirty).toBe(true);
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

  it("opens the image lightbox from an inline note image in preview", async () => {
    const store = storeWithGateway({
      get: vi.fn(async () => ({
        note: {
          ...NOTE,
          content:
            "# Plan\n\n![shot](/attachments/note-1/00000000-0000-0000-0000-000000000000.png)",
        },
      })),
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    const image = await waitFor(
      () => container.querySelector("img.inline-image") as HTMLImageElement,
    );
    image.click();
    await waitFor(() =>
      expect(
        document.querySelector(".image-lightbox-overlay")?.classList.contains("open"),
      ).toBe(true),
    );
    (document.querySelector(".image-lightbox-close") as HTMLButtonElement).click();
  });

  it("renders non-image attachments as preview/download chips", async () => {
    const store = storeWithGateway({
      get: vi.fn(async () => ({
        note: {
          ...NOTE,
          content:
            "# Plan\n\n[report](/attachments/note-1/00000000-0000-0000-0000-000000000000.pdf)",
        },
      })),
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    const link = await waitFor(
      () => container.querySelector("a.notes-attachment-link") as HTMLAnchorElement,
    );
    expect(link.getAttribute("data-attachment-view")).toBe("1");
    expect(link.getAttribute("data-attachment-kind")).toBe("pdf");
    expect(link.querySelector(".notes-attachment-icon")?.textContent).toBe("📕");
    expect(link.querySelector(".notes-attachment-label")?.textContent).toBe("report");

    link.click();
    await waitFor(() =>
      expect(
        document.querySelector(".attachment-viewer-overlay")?.classList.contains("open"),
      ).toBe(true),
    );
    expect(
      document.querySelector(".attachment-viewer-name")?.textContent,
    ).toBe("report");
    expect(
      (document.querySelector(".attachment-viewer-open") as HTMLButtonElement).hidden,
    ).toBe(false);
    (document.querySelector(".attachment-viewer-close") as HTMLButtonElement).click();
  });

  it("previews a text attachment in-app and hides the open-in-tab action", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "# Readme\n\nAttached text",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const store = storeWithGateway({
      get: vi.fn(async () => ({
        note: {
          ...NOTE,
          content:
            "# Plan\n\n[readme](/attachments/note-1/00000000-0000-0000-0000-000000000000.txt)",
        },
      })),
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    const link = await waitFor(
      () => container.querySelector("a.notes-attachment-link") as HTMLAnchorElement,
    );
    expect(link.getAttribute("data-attachment-kind")).toBe("txt");
    expect(link.querySelector(".notes-attachment-icon")?.textContent).toBe("📄");

    link.click();
    await waitFor(() =>
      expect(
        document.querySelector(".attachment-viewer-content")?.textContent,
      ).toBe("# Readme\n\nAttached text"),
    );
    expect(
      (document.querySelector(".attachment-viewer-open") as HTMLButtonElement).hidden,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/attachments/x"),
    );
    (document.querySelector(".attachment-viewer-close") as HTMLButtonElement).click();
  });

  it("ignores a stale text fetch after opening a newer attachment", async () => {
    const pendingResolvers: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn((_url: string) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise((resolve) => pendingResolvers.push(resolve));
      }
      return Promise.resolve({ ok: true, text: async () => "new content" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = storeWithGateway({
      get: vi.fn(async () => ({
        note: {
          ...NOTE,
          content:
            "# Plan\n\n[a](/attachments/note-1/00000000-0000-0000-0000-000000000000.txt)\n\n[b](/attachments/note-1/00000000-0000-0000-0000-000000000001.txt)",
        },
      })),
    });
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    const links = await waitFor(() => {
      const items = Array.from(
        container.querySelectorAll("a.notes-attachment-link"),
      ) as HTMLAnchorElement[];
      if (items.length !== 2) throw new Error("attachments not rendered");
      return items;
    });
    expect(links).toHaveLength(2);

    // Open the first (slow) attachment, close it, then open the second (fast).
    links[0].click();
    await waitFor(() =>
      expect(
        document.querySelector(".attachment-viewer-overlay")?.classList.contains("open"),
      ).toBe(true),
    );
    (document.querySelector(".attachment-viewer-close") as HTMLButtonElement).click();
    links[1].click();
    await waitFor(() =>
      expect(
        document.querySelector(".attachment-viewer-content")?.textContent,
      ).toBe("new content"),
    );

    // Let the stale fetch resolve; it must not overwrite the newer preview.
    pendingResolvers[0]?.({ ok: true, text: async () => "old content" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document.querySelector(".attachment-viewer-content")?.textContent,
    ).toBe("new content");
  });

  it("shows the last-edited date for a note with a timestamp", async () => {
    const store = storeWithGateway();
    await store.getState().load();
    await store.getState().selectNote(SNAPSHOT.notes[0]);
    const { container } = render(<NotesContent store={store} />);
    await waitFor(() =>
      expect(container.querySelector(".notes-editor")).toBeTruthy(),
    );
    expect(container.querySelector(".notes-edited-at")?.textContent).toContain(
      t("Last edited"),
    );
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

  it("keeps moving remaining notes when one move fails", async () => {
    const moveNote = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        params: { noteId: string },
      ) => {
        if (params.noteId === "note-2") throw new Error("move failed");
        return {};
      },
    );
    const notify = vi.fn();
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
      notify,
    });
    await store.getState().load();
    store.getState().toggleSelectMode();
    store.getState().toggleNoteSelected("note-1");
    store.getState().toggleNoteSelected("note-2");
    await store.getState().moveSelectedNotes("book-2");
    expect(moveNote).toHaveBeenCalledTimes(2);
    expect(store.getState().selectMode).toBe(false);
    expect(store.getState().selectedNoteIds).toEqual([]);
    expect(notify).toHaveBeenCalled();
    expect(store.getState().error?.message).toBe("move failed");
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

  it("keeps deleting remaining notes when one delete fails", async () => {
    const del = vi.fn(
      async (
        _sceneId: string,
        _workspaceId: string,
        note: { id: string; notebookId: string; version?: number },
      ) => {
        if (note.id === "note-2") throw new Error("delete failed");
        return {};
      },
    );
    const listTrash = vi.fn(async () => ({ trash: [] }));
    const notify = vi.fn();
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
      notify,
    });
    await store.getState().load();
    store.getState().toggleSelectMode();
    store.getState().toggleNoteSelected("note-1");
    store.getState().toggleNoteSelected("note-2");
    await store.getState().deleteSelectedNotes();
    expect(del).toHaveBeenCalledTimes(2);
    expect(store.getState().selectMode).toBe(false);
    expect(store.getState().selectedNoteIds).toEqual([]);
    expect(notify).toHaveBeenCalled();
    expect(store.getState().error?.message).toBe("delete failed");
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
