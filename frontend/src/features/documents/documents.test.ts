import { beforeEach, describe, expect, it, vi } from "vitest";
import { friendlyPluginError } from "../../shared/hostErrors";
import { setLocale } from "../../shared/i18n";
import { createDocumentsStore, type DocumentsGateway } from "./documentsStore";

const RESULT = {
  ok: true,
  markdown: "# Introduction\n\nHello world",
  title: "Introduction",
  fileName: "report.docx",
  kind: "docx",
  charCount: 28,
};

function stubGateway(overrides: Partial<DocumentsGateway> = {}): DocumentsGateway {
  return { import: vi.fn(async () => RESULT), ...overrides };
}

function createStore(
  gateway: DocumentsGateway,
  saveToNotes = vi.fn(async () => {}),
  listNotebooks = vi.fn(async () => []),
) {
  const notify = vi.fn();
  const store = createDocumentsStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify,
    listNotebooks,
    saveToNotes,
  });
  return { store, notify, saveToNotes };
}

describe("documents store", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("imports a selected document through the gateway", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().setFile("report.docx", "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA");
    await store.getState().run();
    expect(gateway.import).toHaveBeenCalledWith({
      sceneId: "programming",
      workspaceId: "ws-1",
      document: expect.stringContaining("data:"),
      fileName: "report.docx",
    });
    expect(store.getState().result?.markdown).toContain("# Introduction");
    expect(notify).toHaveBeenCalledWith("Document imported");
  });

  it("imports immediately when a file is selected", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().importFile(
      "report.docx",
      "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA",
    );
    expect(gateway.import).toHaveBeenCalledWith({
      sceneId: "programming",
      workspaceId: "ws-1",
      document: expect.stringContaining("data:"),
      fileName: "report.docx",
    });
    expect(store.getState().result?.markdown).toContain("# Introduction");
  });


  it("finishes only the latest selected document after a conversion already started", async () => {
    const latest = { ...RESULT, markdown: "# Second copy" };
    let finish = (result: typeof RESULT): void => { throw new Error(result.fileName); };
    const pending = new Promise<typeof RESULT>((resolve) => { finish = resolve; });
    const convert = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(latest);
    const { store, notify } = createStore(stubGateway({ import: convert }));

    const first = store.getState().importFile("report.docx", "data:base64,AAAA");
    await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(1));
    const second = store.getState().importFile("report.docx", "data:base64,BBBB");
    await vi.waitFor(() => expect(store.getState().document).toBe("data:base64,BBBB"));
    expect(convert).toHaveBeenCalledTimes(1);
    expect(store.getState().result).toBeNull();

    finish(RESULT);
    await Promise.all([first, second]);
    expect(convert).toHaveBeenCalledTimes(2);
    expect(convert).toHaveBeenLastCalledWith(expect.objectContaining({ document: "data:base64,BBBB" }));
    expect(store.getState().result).toEqual(latest);
    expect(notify).toHaveBeenCalledExactlyOnceWith("Document imported");
  });

  it("ignores an earlier file read that completes after accepting the next file", async () => {
    let finish = (data: string): void => { throw new Error(data); };
    const slowRead = new Promise<string>((resolve) => { finish = resolve; });
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    const earlier = store.getState().importFile("old.pdf", slowRead);
    await store.getState().importFile("report.docx", "data:base64,BBBB");
    finish("data:base64,AAAA");
    await earlier;

    expect(gateway.import).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      fileName: "report.docx",
      document: "data:base64,BBBB",
    }));
    expect(store.getState().fileName).toBe("report.docx");
    expect(store.getState().result?.fileName).toBe("report.docx");
  });

  it("adds the converted Markdown into the chat composer", async () => {
    const gateway = stubGateway();
    const onUseInChat = vi.fn();
    const notify = vi.fn();
    const store = createDocumentsStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify,
      onUseInChat,
    });
    store
      .getState()
      .setFile("report.docx", "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA");
    await store.getState().run();
    await store.getState().discussInChat();
    expect(onUseInChat).toHaveBeenCalledWith(expect.stringContaining("# Introduction"));
    expect(notify).toHaveBeenCalledWith("Added to chat");
  });

  it("refuses to add oversized documents to chat", async () => {
    const gateway = stubGateway({
      import: vi.fn(async () => ({
        ok: true,
        markdown: "x".repeat(25_000),
        title: "Huge",
        fileName: "huge.md",
        kind: "md",
        charCount: 25_000,
      })),
    });
    const onUseInChat = vi.fn();
    const notify = vi.fn();
    const store = createDocumentsStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify,
      onUseInChat,
    });
    store.getState().setFile("huge.md", "data:text/plain;base64,AAAA");
    await store.getState().run();
    await store.getState().discussInChat();
    expect(onUseInChat).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("too long"),
    );
  });

  it("localizes runtime-disconnected errors when saving to notes", async () => {
    setLocale("zh-CN");
    const gateway = stubGateway();
    const saveToNotes = vi.fn(async () => {
      throw new Error("Pi RPC request failed: ProcessClosed");
    });
    const { store } = createStore(gateway, saveToNotes);
    store.getState().setFile("report.docx", "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA");
    await store.getState().run();
    await store.getState().save();
    expect(store.getState().error).toContain("Pi 运行时");
  });

  it("does not run without a selected document", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().run();
    expect(gateway.import).not.toHaveBeenCalled();
  });

  it("saves the imported markdown to notes", async () => {
    const gateway = stubGateway();
    const saveToNotes = vi.fn(async () => {});
    const listNotebooks = vi.fn(async () => [{ id: "nb1", title: "Research" }]);
    const { store, notify } = createStore(gateway, saveToNotes, listNotebooks);
    store.getState().setFile("report.docx", "data:base64,AAAA");
    await store.getState().run();
    await store.getState().save();
    expect(saveToNotes).toHaveBeenCalledWith("nb1", "report.docx", RESULT.markdown);
    expect(notify).toHaveBeenCalledWith("Saved to notes");
  });

  it.each([false, true])("keeps an earlier save failure out of the current document (changed workspace: %s)", async changed => {
    let workspaceId = "ws-1";
    const notify = vi.fn();
    let rejectSave = (error: Error): void => { throw error; };
    const pending = new Promise<void>((_, reject) => { rejectSave = reject; });
    const saveToNotes = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const gateway = stubGateway({
      import: vi.fn(async ({ fileName }) => ({ ...RESULT, fileName: fileName ?? "", markdown: "# " + fileName })),
    });
    const store = createDocumentsStore({
      gateway, notify, getTarget: () => ({ sceneId: "programming", workspaceId }),
      listNotebooks: async () => [{ id: workspaceId + "-notes", title: "Notebook" }], saveToNotes,
    });
    await store.getState().importFile("alpha.pdf", "data:base64,AAAA");
    const previous = store.getState().save();
    if (changed) {
      workspaceId = "ws-2";
      await store.getState().syncTarget();
    }
    await store.getState().importFile("beta.pdf", "data:base64,BBBB");
    notify.mockClear();
    rejectSave(new Error("Fixture write failed"));
    await previous;
    expect(store.getState().error).toBe("");
    expect(store.getState().result?.fileName).toBe("beta.pdf");
    if (changed) expect(notify).not.toHaveBeenCalled();
    else expect(notify).toHaveBeenCalledExactlyOnceWith("Could not save alpha.pdf to Notes.");
    await store.getState().save();
    expect(saveToNotes.mock.calls).toEqual([
      ["ws-1-notes", "alpha.pdf", "# alpha.pdf"],
      [workspaceId + "-notes", "beta.pdf", "# beta.pdf"],
    ]);
  });

  it("surfaces gateway errors", async () => {
    const gateway = stubGateway({
      import: vi.fn(async () => {
        throw new Error("unsupported type");
      }),
    });
    const { store } = createStore(gateway);
    store.getState().setFile("bad.exe", "data:base64,AAAA");
    await store.getState().run();
    expect(store.getState().error).toBe(
      friendlyPluginError(new Error("unsupported type")),
    );
  });

  it("downloads the imported markdown as a .md file", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.getState().setFile("report.docx", "data:base64,AAAA");
    await store.getState().run();

    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });
    const click = vi.fn();
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = click;
    try {
      store.getState().download();
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  it("clears the selected document and result", () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.getState().setFile("report.docx", "data:base64,AAAA");
    store.setState({ result: RESULT });
    store.getState().clear();
    expect(store.getState().fileName).toBe("");
    expect(store.getState().document).toBe("");
    expect(store.getState().result).toBeNull();
  });
});
