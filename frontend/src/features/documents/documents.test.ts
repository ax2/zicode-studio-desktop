import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentsStore, type DocumentsGateway } from "./documentsStore";
import { setLocale } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";

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
    });
    expect(store.getState().result?.markdown).toContain("# Introduction");
    expect(notify).toHaveBeenCalledWith("Document imported");
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
