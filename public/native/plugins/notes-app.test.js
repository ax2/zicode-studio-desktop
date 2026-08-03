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
    expect(document.querySelector("[data-notes-content]").value).toContain("Safe content");
    expect(document.querySelector(".notes-editor-tabs").getAttribute("aria-label")).toBe(
      "Note view",
    );
    expect(document.querySelector(".notes-editor-actions").getAttribute("aria-label")).toBe(
      "Note actions",
    );
    expect(document.querySelector('[data-notes-mode="edit"]').getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      document.querySelector('[data-notes-mode="preview"]').getAttribute("aria-pressed"),
    ).toBe("false");
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

  it("blocks navigation away from a dirty editor when discard is declined", async () => {
    setLocale("en");
    const gateway = createGateway();
    const confirmDiscard = vi.fn(() => false);
    const app = render(gateway, { confirmDiscard });
    await vi.waitFor(() => expect(document.querySelector(".notes-list-item")).toBeTruthy());
    document.querySelector(".notes-list-item").click();
    await vi.waitFor(() => expect(document.querySelector("[data-notes-title]")).toBeTruthy());

    const title = document.querySelector("[data-notes-title]");
    title.value = "Changed";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    expect(app.canDeactivate()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith("Discard unsaved note changes?");
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
    await vi.waitFor(() => expect(document.querySelector("[data-notes-content]")).toBeTruthy());

    [...document.querySelectorAll("button")]
      .find((control) => control.textContent === "Attach")
      .click();
    await vi.waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce());

    expect(gateway.uploadAttachment.mock.calls[0][2]).toMatchObject({
      fileName: "proof.txt",
      mimeType: "text/plain",
      dataBase64: "aGVsbG8=",
    });
    expect(document.querySelector("[data-notes-content]").value).toContain("/attachments/note-1/");
    expect(document.querySelector("[data-notes-save]").disabled).toBe(false);
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
    expect(onUseInChat).toHaveBeenCalledWith(expect.objectContaining({ id: "chat-note" }));
  });
});
