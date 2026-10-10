import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranslationMain } from "./TranslationApp";
import { createTranslationStore, type TranslationGateway } from "./translationStore";

function stubGateway(
  overrides: Partial<TranslationGateway> = {},
): TranslationGateway {
  return {
    translate: vi.fn(async () => ({
      translated: "你好",
      model: "deepseek-v4-flash",
      targetLang: "中文",
      charCount: 2,
    })),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("translate composer", () => {
  it("shows the first-run guide until dismissed", () => {
    localStorage.clear();
    const store = createTranslationStore({
      gateway: stubGateway(),
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    store.getState().setModelSelection({ sceneId: "programming", provider: "local", model: "example" });
    const { container } = render(<TranslationMain store={store} />);
    expect(container.querySelector("[data-first-run-guide]")).toBeTruthy();
    expect(container.textContent).toContain("开始翻译");
  });

  it("runs translation with Ctrl+Enter", async () => {
    const gateway = stubGateway();
    const store = createTranslationStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    store.getState().setModelSelection({ sceneId: "programming", provider: "local", model: "example" });
    const { container } = render(<TranslationMain store={store} />);

    const textarea = container.querySelector(
      ".translate-textarea",
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "hello");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await waitFor(() => expect(gateway.translate).toHaveBeenCalled());
  });
});
