import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { setupNotesApp } from "./notes-app.js";

const NOTE = {
  id: "note-1",
  notebookId: "book-1",
  title: "Roadmap",
  content: "# Plan\n\nSafe content",
  tags: ["plugin"],
  createdAt: "2026-07-31T08:00:00Z",
  updatedAt: "2026-07-31T08:00:00Z",
  version: "sha256:original",
  source: null,
};

function createGateway() {
  return {
    list: vi.fn(async () => ({
      snapshot: {
        notebooks: [{ id: "book-1", title: "Product", noteCount: 1 }],
        notes: [NOTE],
        tags: ["plugin"],
      },
    })),
    get: vi.fn(async () => ({ note: structuredClone(NOTE) })),
    createNotebook: vi.fn(),
    create: vi.fn(),
    save: vi.fn(async (_sceneId, note) => ({
      note: { ...note, version: "sha256:saved" },
    })),
    delete: vi.fn(async () => ({ deleted: true })),
    capture: vi.fn(),
    uploadAttachment: vi.fn(async () => ({
      attachment: {
        markdown: "[proof.txt](/attachments/note-1/11111111-1111-4111-8111-111111111111.txt)",
      },
    })),
    attachmentUrl: vi.fn(() => "http://127.0.0.1/attachment"),
    importMarkdown: vi.fn(),
    exportBackup: vi.fn(async () => ({
      backup: { schemaVersion: 1, notebook: { title: "Product" }, notes: [], attachments: [] },
    })),
    importBackup: vi.fn(),
    rebuild: vi.fn(async () => ({
      report: { validNotes: 1, invalidFiles: [], orphanAttachmentDirectories: [] },
    })),
  };
}

function render(gateway, options = {}) {
  document.body.innerHTML = '<aside id="navigation"></aside><main id="content"></main>';
  document.body.dataset.activePlugin = "com.zicode.notes";
  const app = setupNotesApp({
    gateway,
    getTarget: () => ({ sceneId: "programming" }),
    ...options,
  });
  app.renderNavigation(document.getElementById("navigation"));
  app.renderContent(document.getElementById("content"));
  return app;
}

afterEach(() => {
  document.body.innerHTML = "";
  delete document.body.dataset.activePlugin;
  setLocale("zh-CN");
});

describe("Notes application", () => {
  it("renders the notebook and opens a Markdown note in the main view", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);

    await vi.waitFor(() =>
      expect(document.querySelector(".notes-list-item")?.textContent).toContain("Roadmap"),
    );
    expect(document.querySelector(".notes-notebook-branch")?.open).toBe(true);
    expect(document.querySelector(".notes-notebook-summary")?.textContent).toContain("Product");
    expect(document.querySelector(".notes-notebook-children .notes-list-item")?.textContent).toContain(
      "Roadmap",
    );
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-notes-title]")?.value).toBe("Roadmap"),
    );

    expect(gateway.get).toHaveBeenCalledWith("programming", "book-1", "note-1");
    expect(document.querySelector(".notes-preview").textContent).toContain("Safe content");
    expect(document.querySelector(".notes-editor-tabs").getAttribute("aria-label")).toBe(
      "Note view",
    );
    expect(document.querySelector(".notes-editor-actions").getAttribute("aria-label")).toBe(
      "Note actions",
    );
    expect(document.querySelector('[data-notes-mode="edit"]').getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(
      document.querySelector('[data-notes-mode="preview"]').getAttribute("aria-pressed"),
    ).toBe("true");

    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-notes-content]").value).toContain("Safe content"),
    );
  });

  it("groups every note beneath its owning notebook", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.list.mockResolvedValue({
      snapshot: {
        notebooks: [
          { id: "book-1", title: "Product", noteCount: 1 },
          { id: "book-2", title: "Research", noteCount: 1 },
        ],
        notes: [
          NOTE,
          {
            ...NOTE,
            id: "note-2",
            notebookId: "book-2",
            title: "Interview notes",
          },
        ],
        tags: [],
      },
    });
    render(gateway);

    await vi.waitFor(() =>
      expect(document.querySelectorAll(".notes-notebook-branch")).toHaveLength(2),
    );
    const branches = [...document.querySelectorAll(".notes-notebook-branch")];
    expect(branches[0].querySelector(".notes-notebook-title")?.textContent).toBe("Product");
    expect(branches[0].querySelectorAll(".notes-tree-note")).toHaveLength(1);
    expect(branches[0].querySelector(".notes-tree-note")?.textContent).toContain("Roadmap");
    expect(branches[0].textContent).not.toContain("Interview notes");
    expect(branches[1].querySelector(".notes-notebook-title")?.textContent).toBe("Research");
    expect(branches[1].querySelectorAll(".notes-tree-note")).toHaveLength(1);
    expect(branches[1].querySelector(".notes-tree-note")?.textContent).toContain(
      "Interview notes",
    );
    expect(branches[1].textContent).not.toContain("Roadmap");
  });

  it("saves with the loaded optimistic version and preserves the body in preview mode", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector("[data-notes-content]")).toBeTruthy());

    const textarea = document.querySelector("[data-notes-content]");
    textarea.value = "# Updated\n\nBody";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Preview")
      .click();
    expect(document.querySelector(".notes-preview").textContent).toContain("Body");
    expect(
      document.querySelector('[data-notes-mode="preview"]').getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelector('[data-notes-mode="edit"]').getAttribute("aria-pressed")).toBe(
      "false",
    );

    document.querySelector("[data-notes-save]").click();
    await vi.waitFor(() => expect(gateway.save).toHaveBeenCalledOnce());
    expect(gateway.save.mock.calls[0][1]).toMatchObject({
      id: "note-1",
      content: "# Updated\n\nBody",
      version: "sha256:original",
    });
  });

  it("auto-saves a dirty editor before navigating away", async () => {
    setLocale("en");
    const gateway = createGateway();
    const app = render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector("[data-notes-title]")).toBeTruthy());

    const title = document.querySelector("[data-notes-title]");
    title.value = "Changed";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    await app.canDeactivate();
    expect(gateway.save).toHaveBeenCalledOnce();
    expect(gateway.save.mock.calls[0][1]).toMatchObject({ title: "Changed" });
  });

  it("uploads a bounded attachment and inserts its portable Markdown link", async () => {
    setLocale("en");
    const gateway = createGateway();
    const file = {
      name: "proof.txt",
      type: "text/plain",
      size: 5,
      arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
    };
    render(gateway, { chooseFile: vi.fn(async () => file) });
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector("[data-notes-content]")).toBeTruthy());

    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Attach")
      .click();
    await vi.waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(gateway.save).toHaveBeenCalledOnce());

    expect(gateway.uploadAttachment.mock.calls[0][2]).toMatchObject({
      fileName: "proof.txt",
      mimeType: "text/plain",
      dataBase64: "aGVsbG8=",
    });
    expect(document.querySelector("[data-notes-content]").value).toContain("/attachments/note-1/");
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Preview")
      .click();
    expect(gateway.attachmentUrl).toHaveBeenCalledWith(
      "programming",
      expect.objectContaining({ id: "note-1" }),
      "11111111-1111-4111-8111-111111111111.txt",
    );
    expect(document.querySelector(".notes-preview a").href).toBe(
      "http://127.0.0.1/attachment",
    );
  });

  it("exports a readable notebook backup from the data management section", async () => {
    setLocale("en");
    const gateway = createGateway();
    const downloadFile = vi.fn();
    render(gateway, { downloadFile });
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-notebook-summary").click();
    expect(document.querySelector(".notes-notebook-summary").classList.contains("active")).toBe(
      true,
    );

    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Export readable backup")
      .click();
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
    expect(downloadFile.mock.calls[0][0]).toBe("Product.zicode-notes.json");
    expect(downloadFile.mock.calls[0][1]).toContain('"schemaVersion": 1');
  });

  it("captures a structured chat exchange and can return the note to Chat", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.create.mockResolvedValue({
      note: {
        ...NOTE,
        id: "chat-note",
        title: "How should we design this?",
        content: "## Question\n\nHow?\n\n## Answer\n\nUse a bridge.",
      },
    });
    const onUseInChat = vi.fn();
    const app = render(gateway, { onUseInChat });
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());

    await app.captureChatExchange({
      question: "How should we design this?",
      answer: "Use a two-way knowledge bridge.",
      sessionId: "session-1",
    });

    expect(gateway.create).toHaveBeenCalledWith(
      "programming",
      "book-1",
      expect.objectContaining({
        title: "How should we design this?",
        tags: ["chat", "captured"],
        content: expect.stringContaining("## Answer"),
      }),
    );
    document.querySelector(".notes-use-in-chat").click();
    expect(onUseInChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: "chat-note" }),
      "",
    );
  });

  it("shows notebook and note icons in the navigation tree", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.list.mockResolvedValue({
      snapshot: {
        notebooks: [{ id: "book-1", title: "Product", icon: "🚀", noteCount: 1 }],
        notes: [{ ...NOTE, icon: "⭐" }],
        tags: [],
      },
    });
    render(gateway);
    await vi.waitFor(() =>
      expect(document.querySelector(".notes-notebook-icon-badge")?.textContent).toBe("🚀"),
    );
    expect(document.querySelector(".notes-folder-glyph")?.textContent).toMatch(/^[📁📂]$/u);
    expect(document.querySelector(".notes-note-icon")?.textContent).toBe("⭐");
  });

  it("creates a note in the owning notebook from the inline action", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.create.mockResolvedValue({ note: { ...NOTE, id: "new-1" } });
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-notebook-new-note").click();
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledOnce());
    expect(gateway.create.mock.calls[0][1]).toBe("book-1");
  });

  it("edits notebook icon and title from the inline form", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.updateNotebook = vi.fn(async () => ({
      notebook: { id: "book-1", title: "Product", icon: "📦" },
    }));
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-notebook-summary")).toBeTruthy());
    document.querySelector(".notes-notebook-edit").click();
    expect(document.querySelector(".notes-notebook-edit-form")).toBeTruthy();
    const iconInput = document.querySelector('.notes-notebook-edit-form input[name="icon"]');
    iconInput.value = "📦";
    iconInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('.notes-notebook-edit-form button[type="submit"]').click();
    await vi.waitFor(() => expect(gateway.updateNotebook).toHaveBeenCalledOnce());
    expect(gateway.updateNotebook.mock.calls[0][1]).toMatchObject({
      notebookId: "book-1",
      title: "Product",
      icon: "📦",
    });
  });

  it("quick-adds built-in and existing tags with icons", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector(".notes-tag-input")).toBeTruthy());

    expect(
      [...document.querySelectorAll(".notes-tag-chip")].some((chip) =>
        chip.textContent.includes("plugin"),
      ),
    ).toBe(true);

    const tagInput = document.querySelector(".notes-tag-input");
    tagInput.value = "idea";
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
    const suggestion = [...document.querySelectorAll(".notes-tag-suggestion")].find((item) =>
      item.textContent.includes("idea"),
    );
    expect(suggestion.textContent).toContain("💡");
    suggestion.click();
    expect(document.querySelector("[data-notes-tags]").value).toContain("idea");
    expect(document.querySelector("[data-notes-tags]").value).toContain("plugin");
  });

  it("hides tag suggestions when clicking outside the editor", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector(".notes-tag-input")).toBeTruthy());

    const input = document.querySelector(".notes-tag-input");
    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector(".notes-tag-suggestions").hidden).toBe(false),
    );
    document
      .querySelector(".notes-title-input")
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".notes-tag-suggestions").hidden).toBe(true);
  });

  it("does not offer partial prefixes as new tags but creates brand-new ones", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector(".notes-tag-input")).toBeTruthy());

    const input = document.querySelector(".notes-tag-input");
    input.value = "i";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const partialSuggestions = [...document.querySelectorAll(".notes-tag-suggestion")].map(
      (s) => s.querySelector("span:last-child")?.textContent.trim(),
    );
    expect(partialSuggestions).not.toContain("i");
    expect(partialSuggestions).toContain("inbox");

    input.value = "brandnew";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const newTag = [...document.querySelectorAll(".notes-tag-suggestion")].find(
      (s) => s.querySelector("span:last-child")?.textContent.includes("brandnew"),
    );
    expect(newTag).toBeTruthy();
    newTag.click();
    expect(document.querySelector("[data-notes-tags]").value).toContain("brandnew");
  });

  it("brings only the selected text into Chat from the editor", async () => {
    setLocale("en");
    const gateway = createGateway();
    const onUseInChat = vi.fn();
    render(gateway, { onUseInChat });
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector("[data-notes-content]")).toBeTruthy());

    const textarea = document.querySelector("[data-notes-content]");
    textarea.value = "# Plan\n\nSafe content\n\nMore";
    textarea.selectionStart = textarea.value.indexOf("Safe");
    textarea.selectionEnd = textarea.value.indexOf("Safe") + "Safe content".length;
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Discuss in Chat")
      .click();
    expect(onUseInChat).toHaveBeenCalledOnce();
    expect(onUseInChat.mock.calls[0][1]).toBe("Safe content");
  });

  it("confirms note deletion with a two-step button", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.delete = vi.fn(async () => ({ deleted: true }));
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-delete")).toBeTruthy());

    const del = document.querySelector(".notes-delete");
    del.click();
    expect(gateway.delete).not.toHaveBeenCalled();
    expect(del.getAttribute("aria-label")).toBe("Confirm delete");
    del.click();
    await vi.waitFor(() => expect(gateway.delete).toHaveBeenCalledOnce());
  });

  it("opens a grouped emoji picker and applies the chosen icon", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());

    document.querySelector("[data-notes-icon]").click();
    expect(document.querySelector(".notes-emoji-picker").hidden).toBe(false);
    expect(document.querySelectorAll(".notes-emoji-tab").length).toBeGreaterThan(3);
    document.querySelectorAll(".notes-emoji-tab")[1].click();
    expect(document.querySelector(".notes-emoji-picker").hidden).toBe(false);
    document.querySelectorAll(".notes-emoji-tab")[0].click();
    [...document.querySelectorAll(".notes-emoji-cell")]
      .find((cell) => cell.textContent === "😀")
      ?.click();
    expect(document.querySelector("[data-notes-icon]").value).toBe("😀");
  });

  it("auto-saves tag additions before navigating away", async () => {
    setLocale("en");
    const gateway = createGateway();
    const app = render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector(".notes-preview")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Edit")
      .click();
    await vi.waitFor(() => expect(document.querySelector(".notes-tag-input")).toBeTruthy());

    const tagInput = document.querySelector(".notes-tag-input");
    tagInput.value = "idea";
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
    tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector("[data-notes-tags]").value).toContain("idea");

    await app.canDeactivate();
    expect(gateway.save.mock.calls.at(-1)[1].tags).toEqual(
      expect.arrayContaining(["plugin", "idea"]),
    );
  });

  it("shows a tag-filtered note list in the content area", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-nav-item")).toBeTruthy());
    const tagBtn = [...document.querySelectorAll(".notes-nav-item")].find((b) =>
      b.textContent.includes("plugin"),
    );
    tagBtn.click();
    await vi.waitFor(() => expect(document.querySelector(".notes-results")).toBeTruthy());
    expect(
      document.querySelector(".notes-results-list .notes-result-item")?.textContent,
    ).toContain("Roadmap");
    document.querySelector(".notes-results-list .notes-result-item").click();
    await vi.waitFor(() => expect(document.querySelector("[data-notes-title]")).toBeTruthy());
  });

  it("keeps the tag section expanded after selecting a tag", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-nav-section")).toBeTruthy());
    const findSection = () =>
      [...document.querySelectorAll(".notes-nav-section")].find((s) =>
        s.querySelector("summary")?.textContent.includes("Tags"),
      );
    findSection().querySelector("summary").click();
    expect(findSection().open).toBe(true);
    const tagBtn = [...findSection().querySelectorAll(".notes-nav-item")].find((b) =>
      b.textContent.includes("plugin"),
    );
    tagBtn.click();
    await vi.waitFor(() => expect(document.querySelector(".notes-results")).toBeTruthy());
    expect(findSection().open).toBe(true);
  });

  it("renders nested notebooks and moves a note between them by drag", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.list.mockResolvedValue({
      snapshot: {
        notebooks: [
          { id: "book-1", title: "Product", noteCount: 1 },
          { id: "book-2", title: "Research", noteCount: 1, parentId: "book-1" },
        ],
        notes: [
          NOTE,
          { ...NOTE, id: "note-2", notebookId: "book-2", title: "Interview notes" },
        ],
        tags: [],
      },
    });
    gateway.moveNote = vi.fn(async () => ({ note: { ...NOTE, notebookId: "book-2" } }));
    render(gateway);
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".notes-notebook-branch")).toHaveLength(2),
    );

    const note = [...document.querySelectorAll(".notes-tree-note")].find((el) =>
      el.textContent.includes("Roadmap"),
    );
    expect(note.draggable).toBe(true);
    const target = [...document.querySelectorAll(".notes-notebook-summary")].find((el) =>
      el.textContent.includes("Research"),
    );
    const start = new Event("dragstart", { bubbles: true });
    start.dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    note.dispatchEvent(start);
    expect(start.dataTransfer.setData).toHaveBeenCalledWith(
      "text/plain",
      JSON.stringify({ noteId: "note-1", notebookId: "book-1" }),
    );

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    drop.dataTransfer = {
      getData: () => JSON.stringify({ noteId: "note-1", notebookId: "book-1" }),
    };
    target.dispatchEvent(drop);
    await vi.waitFor(() => expect(gateway.moveNote).toHaveBeenCalledOnce());
    expect(gateway.moveNote.mock.calls[0][1]).toMatchObject({
      noteId: "note-1",
      targetNotebookId: "book-2",
    });
  });

  it("offers a parent notebook and an icon picker when creating a notebook", async () => {
    setLocale("en");
    const gateway = createGateway();
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-nav-section")).toBeTruthy());
    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "New notebook")
      .click();
    expect(document.querySelector('select[name="parentId"]')).toBeTruthy();
    expect(document.querySelector('select[name="parentId"] option').textContent).toBe("Top level");
    document.querySelector('input[name="icon"]').click();
    expect(document.querySelector(".notes-emoji-picker").hidden).toBe(false);
  });

  it("moves a note to another notebook from the fallback move button", async () => {
    setLocale("en");
    const gateway = createGateway();
    gateway.moveNote = vi.fn(async () => ({ note: { ...NOTE, notebookId: "book-2" } }));
    gateway.list.mockResolvedValue({
      snapshot: {
        notebooks: [
          { id: "book-1", title: "Product", noteCount: 1 },
          { id: "book-2", title: "Research", noteCount: 0 },
        ],
        notes: [NOTE],
        tags: [],
      },
    });
    render(gateway);
    await vi.waitFor(() => expect(document.querySelector(".notes-tree-note")).toBeTruthy());
    document.querySelector(".notes-move-btn").click();
    expect(document.querySelector(".notes-move-popover")).toBeTruthy();
    const research = [...document.querySelectorAll(".notes-move-popover-item")].find((b) =>
      b.textContent.includes("Research"),
    );
    research.click();
    await vi.waitFor(() => expect(gateway.moveNote).toHaveBeenCalledOnce());
    expect(gateway.moveNote.mock.calls[0][1]).toMatchObject({
      noteId: "note-1",
      targetNotebookId: "book-2",
    });
  });
});
