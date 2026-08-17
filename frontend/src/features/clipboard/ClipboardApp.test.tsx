import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ClipboardMain } from "./ClipboardApp";
import { createClipboardStore, type ClipboardGateway } from "./clipboardStore";

function stubGateway(overrides: Partial<ClipboardGateway> = {}): ClipboardGateway {
  return {
    list: vi.fn(async () => ({ items: [] })),
    add: vi.fn(async () => ({
      item: {
        id: "id-1",
        text: "hello",
        kind: "text",
        source: "manual",
        createdAt: "",
      },
    })),
    remove: vi.fn(async () => ({ removed: true })),
    clear: vi.fn(async () => ({ removed: 0 })),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("clipboard composer", () => {
  it("adds text to the inbox with Ctrl+Enter", async () => {
    const gateway = stubGateway();
    const store = createClipboardStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const { container } = render(<ClipboardMain store={store} />);
    await waitFor(() => expect(store.getState().busy).toBe(false));

    const textarea = container.querySelector(
      ".clipboard-textarea",
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

    await waitFor(() => expect(gateway.add).toHaveBeenCalled());
  });
});
