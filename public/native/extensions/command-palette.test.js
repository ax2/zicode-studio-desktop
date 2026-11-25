import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupCommandPalette } from "../react/command-palette.js";

describe("command palette", () => {
  let dom;
  let button;
  let palette;
  let overlay;
  let list;

  beforeEach(() => {
    dom = new JSDOM(`
      <button id="command-btn" type="button"></button>
      <div id="command-palette-overlay" class="hidden"></div>
      <div id="command-palette" class="hidden"><div id="command-list"></div></div>
    `);
    globalThis.document = dom.window.document;
    globalThis.KeyboardEvent = dom.window.KeyboardEvent;
    button = document.getElementById("command-btn");
    palette = document.getElementById("command-palette");
    overlay = document.getElementById("command-palette-overlay");
    list = document.getElementById("command-list");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
    delete globalThis.document;
    delete globalThis.KeyboardEvent;
  });

  it("returns to visible compact navigation when the original launcher is hidden", () => {
    const more = document.createElement("button");
    more.setAttribute("data-mobile-activity-more", "");
    document.body.append(more);
    button.style.display = "none";
    setupCommandPalette({ button, palette, overlay, list,
      commands: [{ label: "First", action() {} }],
    });
    button.click();
    expect(palette.classList.contains("hidden")).toBe(false);
    document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(palette.classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(more);
  });
  it("opens command actions from the command button", () => {
    const action = vi.fn();
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [{ icon: "⚙️", label: "Settings", desc: "Open settings", action }],
    });

    button.click();

    expect(palette.classList.contains("hidden")).toBe(false);
    expect(list.textContent).toContain("Settings");

    list.querySelector(".command-item").click();

    expect(action).toHaveBeenCalledTimes(1);
    expect(palette.classList.contains("hidden")).toBe(true);
  });

  it("traps keyboard focus and restores the trigger on Escape", () => {
    setupCommandPalette({
      button,
      palette,
      overlay,
      list,
      commands: [
        { label: "First", action() {} },
        { label: "Last", action() {} },
      ],
      toolApi: { searchTools: vi.fn() },
      getScope: () => ({ sceneId: "fixture", workspaceId: "workspace" }),
      onOpenTool: vi.fn(),
    });

    button.click();
    const search = list.querySelector(".command-palette-search");
    const commands = list.querySelector(".command-palette-tabs button");
    expect(list.querySelector('[role="listbox"][tabindex="-1"]')).not.toBeNull();
    expect(list.querySelectorAll('[role="option"][tabindex="-1"]')).toHaveLength(2);

    search.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(commands);

    commands.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(search);

    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
    expect(document.activeElement).toBe(button);
  });
});
