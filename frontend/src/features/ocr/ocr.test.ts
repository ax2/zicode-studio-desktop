import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { createOcrStore, type OcrGateway } from "./ocrStore";

const RESULT = { ok: true, text: "Hello world", charCount: 11 };

function stubGateway(overrides: Partial<OcrGateway> = {}): OcrGateway {
  return { extract: vi.fn(async () => RESULT), ...overrides };
}

function createStore(gateway: OcrGateway) {
  const notify = vi.fn();
  const store = createOcrStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify,
  });
  return { store, notify };
}

describe("ocr store", () => {
  beforeEach(() => setLocale("en"));

  it("extracts text from an image", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().setImage("data:image/png;base64,AAAA", "shot.png");
    await store.getState().run();
    expect(gateway.extract).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "data:image/png;base64,AAAA",
      undefined,
    );
    expect(store.getState().result?.text).toBe("Hello world");
    expect(store.getState().editedText).toBe("Hello world");
    expect(notify).toHaveBeenCalledWith("Text extracted");
  });

  it("extracts immediately when an image is selected", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().extractImage("data:image/png;base64,AAAA", "shot.png");
    expect(gateway.extract).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "data:image/png;base64,AAAA",
      undefined,
    );
    expect(store.getState().result?.text).toBe("Hello world");
  });

  it("does not run without an image", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().run();
    expect(gateway.extract).not.toHaveBeenCalled();
  });

  it("surfaces gateway errors", async () => {
    const gateway = stubGateway({
      extract: vi.fn(async () => {
        throw new Error("no language pack");
      }),
    });
    const { store } = createStore(gateway);
    store.getState().setImage("data:image/png;base64,AAAA", "shot.png");
    await store.getState().run();
    expect(store.getState().error).toBe("no language pack");
  });

  it("downloads the extracted text as a text file", () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.setState({ editedText: "Hello world", fileName: "shot.png" });

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
});
