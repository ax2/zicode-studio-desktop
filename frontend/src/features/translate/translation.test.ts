import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { createTranslationStore, type TranslationGateway } from "./translationStore";

const RESULT = {
  translated: "你好",
  model: "deepseek-v4-flash",
  targetLang: "中文",
  charCount: 2,
};

function stubGateway(overrides: Partial<TranslationGateway> = {}): TranslationGateway {
  return { translate: vi.fn(async () => RESULT), ...overrides };
}

function createStore(gateway: TranslationGateway) {
  const notify = vi.fn();
  const store = createTranslationStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify,
  });
  return { store, notify };
}

describe("translation store", () => {
  beforeEach(() => setLocale("en"));

  it("translates text through the gateway", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().setText("Hello");
    store.getState().setTargetLang("Chinese");
    await store.getState().run();
    expect(gateway.translate).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      { text: "Hello", targetLang: "Chinese" },
    );
    expect(store.getState().result?.translated).toBe("你好");
    expect(store.getState().editedText).toBe("你好");
    expect(notify).toHaveBeenCalledWith("Translation complete");
  });

  it("does not translate empty text", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().run();
    expect(gateway.translate).not.toHaveBeenCalled();
  });

  it("swaps languages and uses the previous result as new source", () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.getState().setTargetLang("Chinese");
    store.setState({ result: RESULT, editedText: RESULT.translated });
    store.getState().swap();
    expect(store.getState().targetLang).toBe("English");
    expect(store.getState().text).toBe("你好");
  });

  it("keeps the source text when swapping without a result", () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.getState().setText("Hello");
    store.getState().setSourceLang("English");
    store.getState().setTargetLang("Chinese");
    store.getState().swap();
    expect(store.getState().text).toBe("Hello");
    expect(store.getState().sourceLang).toBe("Chinese");
    expect(store.getState().targetLang).toBe("English");
  });

  it("localizes model configuration errors", async () => {
    setLocale("zh-CN");
    const gateway = stubGateway({
      translate: vi.fn(async () => {
        throw new Error("Translation model key is not configured for this scene");
      }),
    });
    const { store } = createStore(gateway);
    store.getState().setText("Hello");
    await store.getState().run();
    expect(store.getState().error).toBe("当前场景尚未配置翻译模型。");
  });

  it("downloads the translation as a text file", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.setState({ editedText: "你好" });

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

  it("clears the source text and result", () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    store.setState({ text: "Hello", result: RESULT, editedText: "你好" });
    store.getState().clear();
    expect(store.getState().text).toBe("");
    expect(store.getState().result).toBeNull();
    expect(store.getState().editedText).toBe("");
  });
});
