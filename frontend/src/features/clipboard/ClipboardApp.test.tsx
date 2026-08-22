import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
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

  it("sends an inbox item into the chat composer", async () => {
    const gateway = stubGateway({
      list: vi.fn(async () => ({
        items: [
          {
            id: "item-1",
            text: "captured link https://example.com",
            kind: "url",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
      })),
    });
    const onUseInChat = vi.fn();
    const notify = vi.fn();
    const store = createClipboardStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify,
      onUseInChat,
    });
    render(<ClipboardMain store={store} />);
    await waitFor(() =>
      expect(store.getState().items.some((item) => item.id === "item-1")).toBe(true),
    );
    const button = Array.from(document.querySelectorAll("button"))
      .find(
        (node) =>
          (node.textContent || "").includes("Add to chat") ||
          (node.textContent || "").includes("添加到对话"),
      );
    expect(button).toBeTruthy();
    button?.click();
    expect(onUseInChat).toHaveBeenCalledWith("captured link https://example.com");
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Added to chat|已添加到对话/));
  });

  it("offers an open-link action for URL items", async () => {
    const gateway = stubGateway({
      list: vi.fn(async () => ({
        items: [
          {
            id: "url-1",
            text: "https://example.com",
            kind: "url",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
          {
            id: "txt-1",
            text: "just a note",
            kind: "text",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
      })),
    });
    const openSpy = vi.spyOn(globalThis, "open").mockImplementation(() => null);
    const store = createClipboardStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    render(<ClipboardMain store={store} />);
    await waitFor(() =>
      expect(store.getState().items.some((item) => item.id === "url-1")).toBe(true),
    );
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter(
        (node) =>
          (node.textContent || "").includes("Open link") ||
          (node.textContent || "").includes("打开链接"),
      );
    expect(buttons.length).toBe(1);
    buttons[0].click();
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("removes multiple selected items through the bulk bar", async () => {
    const gateway = stubGateway({
      list: vi.fn(async () => ({
        items: [
          {
            id: "a",
            text: "first",
            kind: "text",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
          {
            id: "b",
            text: "second",
            kind: "text",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
      })),
    });
    const store = createClipboardStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    render(<ClipboardMain store={store} />);
    await waitFor(() => expect(store.getState().items).toHaveLength(2));

    const selectButton = Array.from(document.querySelectorAll("button")).find(
      (node) => (node.textContent || "").includes("多选"),
    );
    expect(selectButton).toBeTruthy();
    fireEvent.click(selectButton as HTMLButtonElement);

    const checkboxes = Array.from(
      document.querySelectorAll(".clipboard-item-select"),
    ) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) fireEvent.click(checkbox);

    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const removeButton = Array.from(document.querySelectorAll("button")).find(
      (node) => (node.textContent || "").includes("删除选中"),
    );
    expect(removeButton).toBeTruthy();
    fireEvent.click(removeButton as HTMLButtonElement);

    await waitFor(() =>
      expect((gateway.remove as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2),
    );
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("sends multiple selected items to notes and clears the selection", async () => {
    const saveToNote = vi.fn(async () => {});
    const gateway = stubGateway({
      list: vi.fn(async () => ({
        items: [
          {
            id: "a",
            text: "one",
            kind: "text",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
          {
            id: "b",
            text: "two",
            kind: "text",
            source: "manual",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
      })),
    });
    const store = createClipboardStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
      saveToNote,
    });
    render(<ClipboardMain store={store} />);
    await waitFor(() => expect(store.getState().items).toHaveLength(2));

    const selectButton = Array.from(document.querySelectorAll("button")).find(
      (node) => (node.textContent || "").includes("多选"),
    );
    fireEvent.click(selectButton as HTMLButtonElement);
    const checkboxes = Array.from(
      document.querySelectorAll(".clipboard-item-select"),
    ) as HTMLInputElement[];
    for (const checkbox of checkboxes) fireEvent.click(checkbox);

    const sendButton = Array.from(document.querySelectorAll("button")).find(
      (node) =>
        (node.textContent || "").includes("发送到笔记") &&
        (node.textContent || "").includes("(2)"),
    );
    expect(sendButton).toBeTruthy();
    fireEvent.click(sendButton as HTMLButtonElement);

    await waitFor(() => expect(saveToNote).toHaveBeenCalledTimes(2));
    expect(saveToNote).toHaveBeenCalledWith("one");
    expect(saveToNote).toHaveBeenCalledWith("two");
    await waitFor(() =>
      expect(document.querySelector(".clipboard-bulk-bar")).toBeNull(),
    );
  });
});
