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
});
