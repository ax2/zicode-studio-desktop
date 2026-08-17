import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
  it("runs translation with Ctrl+Enter", async () => {
    const gateway = stubGateway();
    const store = createTranslationStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
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
