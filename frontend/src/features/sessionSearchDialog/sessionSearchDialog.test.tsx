import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setupSessionSearchDialog,
  type SessionSearchDialogHandle,
  type SessionSearchDialogOptions,
} from "./index";
import { isSearchShortcut, shortcutHintLabel } from "./sessionSearchDialogLogic";

let activeHandle: SessionSearchDialogHandle | null = null;

function mountDialog(options: Partial<SessionSearchDialogOptions> = {}) {
  document.body.innerHTML = `
    <input id="session-search-input" />
    <button id="session-search-clear" class="hidden"></button>
    <div id="session-search-dialog-root"></div>
  `;
  const triggerInput = document.getElementById(
    "session-search-input",
  ) as HTMLInputElement;
  const triggerClear = document.getElementById(
    "session-search-clear",
  ) as HTMLButtonElement;
  const handle = setupSessionSearchDialog({
    triggerInput,
    triggerClear,
    ...options,
  });
  activeHandle = handle;
  return { triggerInput, triggerClear, handle };
}

afterEach(() => {
  activeHandle?.dispose();
  activeHandle = null;
  document.body.innerHTML = "";
});

describe("session search dialog", () => {
  it("shows a Cmd/Ctrl+K hint in the sidebar search placeholder", () => {
    const { triggerInput } = mountDialog({ getSessions: () => [] });
    expect(triggerInput.placeholder).toMatch(/Ctrl\+K|⌘K/);
  });

  it("computes the shortcut hint for the current platform", () => {
    expect(shortcutHintLabel()).toMatch(/^(\u2318K|Ctrl\+K)$/);
    expect(
      isSearchShortcut({ key: "k", metaKey: true, ctrlKey: false }),
    ).toBe(true);
    expect(isSearchShortcut({ key: "k", metaKey: true, shiftKey: true })).toBe(false);
  });

  it("opens the dialog with the Cmd/Ctrl+K shortcut from anywhere", () => {
    mountDialog({
      getSessions: () => [{ id: "s1", name: "Fix pinyin submit" }],
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true }),
    );

    expect(document.querySelector(".session-search-dialog")).not.toBeNull();
    expect(document.querySelector(".session-search-overlay")).not.toBeNull();
  });

  it("opens from the sidebar search and lists recent sessions", () => {
    const { triggerInput } = mountDialog({
      getSessions: () => [
        { id: "s1", name: "Fix pinyin submit", projectName: "pi-web-ui" },
      ],
    });

    triggerInput.focus();

    const dialog = document.querySelector(".session-search-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Fix pinyin submit");
  });

  it("filters tasks while typing in the dialog input", () => {
    const onQueryChange = vi.fn();
    const { triggerInput, handle } = mountDialog({
      getSessions: () => [
        { id: "s1", name: "Fix pinyin submit", projectName: "pi-web-ui" },
        { id: "s2", name: "Release smoke", projectName: "pi-web-ui" },
      ],
      onQueryChange,
    });

    triggerInput.focus();
    const input = document.querySelector(
      ".session-search-dialog-input",
    ) as HTMLInputElement;
    input.value = "pinyin";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onQueryChange).toHaveBeenCalledWith("pinyin");
    const rows = document.querySelectorAll(".session-search-result");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Fix pinyin submit");
    handle.dispose();
  });

  it("selects the active result with enter and keeps the query", () => {
    const onSelect = vi.fn();
    const { triggerInput, handle } = mountDialog({
      getSessions: () => [
        { id: "s1", name: "Alpha" },
        { id: "s2", name: "Beta" },
      ],
      onSelect,
    });

    triggerInput.value = "beta";
    triggerInput.focus();
    const input = document.querySelector(
      ".session-search-dialog-input",
    ) as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(onSelect).toHaveBeenCalledWith(
      { id: "s2", name: "Beta" },
      { query: "beta" },
    );
    expect(triggerInput.value).toBe("beta");
    expect(document.querySelector(".session-search-dialog")).toBeNull();
    handle.dispose();
  });

  it("clears the query with the in-dialog clear button", async () => {
    const { triggerInput, handle } = mountDialog({
      getSessions: () => [{ id: "s1", name: "Alpha" }],
    });

    triggerInput.focus();
    const input = document.querySelector(
      ".session-search-dialog-input",
    ) as HTMLInputElement;
    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const clear = document.querySelector(
      ".session-search-clear",
    ) as HTMLButtonElement;
    expect(clear).toBeTruthy();
    clear.click();

    expect(input.value).toBe("");
    expect(document.querySelector(".session-search-clear")).toBeNull();
    handle.dispose();
  });

  it("does not select a result while an IME composition is in progress", () => {
    const onSelect = vi.fn();
    const { triggerInput, handle } = mountDialog({
      getSessions: () => [{ id: "s1", name: "Alpha" }],
      onSelect,
    });

    triggerInput.value = "alpha";
    triggerInput.focus();
    const input = document.querySelector(
      ".session-search-dialog-input",
    ) as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onSelect).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("closes on document escape without clearing the search input", () => {
    const { triggerInput } = mountDialog({
      getSessions: () => [{ id: "s1", name: "AI task" }],
    });

    triggerInput.value = "AI";
    triggerInput.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector(".session-search-dialog")).toBeNull();
    expect(document.querySelector(".session-search-overlay")).toBeNull();
    expect(triggerInput.value).toBe("AI");
  });

  it("clears search without opening the dialog when the clear button is clicked", () => {
    const onQueryChange = vi.fn();
    const { triggerInput, triggerClear } = mountDialog({
      getSessions: () => [{ id: "s1", name: "AI task" }],
      onQueryChange,
    });

    triggerInput.value = "AI";
    triggerClear.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    triggerInput.focus();
    triggerClear.click();

    expect(triggerInput.value).toBe("");
    expect(document.querySelector(".session-search-dialog")).toBeNull();
    expect(document.querySelector(".session-search-overlay")).toBeNull();
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("keeps Tab focus inside the dialog and restores the trigger on Escape", () => {
    const { triggerInput, handle } = mountDialog({
      getSessions: () => [{ id: "s1", name: "Mobile QA" }],
    });

    triggerInput.focus();
    const input = document.querySelector(
      ".session-search-dialog-input",
    ) as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(
      document.querySelector(".session-search-result"),
    );

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(triggerInput);
    handle.dispose();
  });
});
