import { afterEach, describe, expect, it, vi } from "vitest";
import { setupCommandPalette } from "./index";

function mount() {
  const button = document.createElement("button");
  button.id = "command-btn";
  const palette = document.createElement("div");
  palette.id = "command-palette";
  palette.className = "hidden";
  const overlay = document.createElement("div");
  overlay.id = "command-palette-overlay";
  overlay.className = "hidden";
  const list = document.createElement("div");
  list.id = "command-list";
  palette.append(list);
  document.body.append(button, overlay, palette);
  return { button, palette, overlay, list };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("command palette (React)", () => {
  it("opens actions from the command button and runs the selected command", () => {
    const { button, palette, overlay, list } = mount();
    const action = vi.fn();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [
        { icon: "⚙️", label: "Settings", desc: "Open settings", action },
      ],
    });

    button.click();

    expect(palette.classList.contains("hidden")).toBe(false);
    expect(list.textContent).toContain("Settings");

    (list.querySelector(".command-item") as HTMLElement)?.click();

    expect(action).toHaveBeenCalledTimes(1);
    expect(palette.classList.contains("hidden")).toBe(true);
  });

  it("restores focus to the trigger on Escape", () => {
    const { button, palette, overlay, list } = mount();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [{ label: "First", action() {} }],
    });

    button.click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );

    expect(palette.classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("restores focus to the previously focused element when opened by shortcut", () => {
    const { button, palette, overlay, list } = mount();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [{ label: "First", action() {} }],
    });

    // The app opens the palette from a keyboard shortcut by clicking the
    // trigger; programmatic .click() does not move focus, so the composer
    // input stays focused and must be restored on close.
    button.click();
    expect(palette.classList.contains("hidden")).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );

    expect(palette.classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("filters commands as the user types and runs the selected one with Enter", () => {
    const { button, palette, overlay, list } = mount();
    const openNotes = vi.fn();
    const openTasks = vi.fn();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [
        { label: "Notes", desc: "Open notes", action: openNotes },
        { label: "Tasks", desc: "Open tasks", action: openTasks },
      ],
    });

    button.click();
    expect(list.querySelectorAll(".command-item")).toHaveLength(2);

    const input = list.querySelector(".command-palette-search") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "task");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(list.querySelectorAll(".command-item")).toHaveLength(1);
    expect(list.textContent).toContain("Tasks");
    expect(list.textContent).not.toContain("Notes");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(openTasks).toHaveBeenCalledTimes(1);
    expect(openNotes).not.toHaveBeenCalled();
  });

  it("does not run a command while an IME composition is in progress", () => {
    const { button, palette, overlay, list } = mount();
    const run = vi.fn();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [{ label: "Notes", desc: "Open notes", action: run }],
    });

    button.click();
    const input = list.querySelector(
      ".command-palette-search",
    ) as HTMLInputElement;
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("exposes the command list with listbox and option roles", () => {
    const { button, palette, overlay, list } = mount();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [{ label: "Notes", desc: "Open notes", action: vi.fn() }],
    });

    button.click();
    expect(
      list.querySelector(".command-palette-results")?.getAttribute("role"),
    ).toBe("listbox");
    expect(
      list.querySelector(".command-palette-search")?.getAttribute("role"),
    ).toBe("combobox");
    expect(
      list.querySelector(".command-item")?.getAttribute("role"),
    ).toBe("option");
    expect(
      list.querySelector(".command-item")?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("shows the global keyboard shortcut hint in a footer", () => {
    const { button, palette, overlay, list } = mount();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [{ label: "First", action() {} }],
    });

    button.click();

    const footer = list.querySelector(".command-palette-footer");
    expect(footer?.textContent).toContain("Ctrl+1-9");
    expect(footer?.textContent).toContain("Esc");
  });
});
