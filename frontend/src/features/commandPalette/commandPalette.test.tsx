import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupCommandPalette as setupPalette, type CommandPaletteHandle } from "./index";
import { setLocale } from "../../shared/i18n";

const handles: CommandPaletteHandle[] = [];
function setupCommandPalette(...args: Parameters<typeof setupPalette>) {
  const handle = setupPalette(...args); handles.push(handle); return handle;
}
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

afterEach(async () => {
  await act(async () => { for (const handle of handles.splice(0)) handle.close({restoreFocus:false}); });
  document.body.innerHTML = "";
});

describe("command palette (React)", () => {
  it("closes a stale palette when its scene or workspace changes", async () => {
    const elements = mount();
    const current = { sceneId: "programming", workspaceId: "first" };
    setupCommandPalette({ ...elements, commands: [{ label: "Settings" }], getScope: () => current });
    await act(async () => elements.button.click());
    await act(async () => window.dispatchEvent(new Event("zicode:tool-target-changed")));
    expect(elements.palette.classList.contains("hidden")).toBe(false);
    current.workspaceId = "second";
    await act(async () => window.dispatchEvent(new Event("zicode:tool-target-changed")));
    expect(elements.palette.classList.contains("hidden")).toBe(true);
    await act(async () => elements.button.click());
    current.sceneId = "finance";
    await act(async () => window.dispatchEvent(new Event("zicode:tool-target-changed")));
    expect(elements.palette.classList.contains("hidden")).toBe(true);
  });
  it("searches concrete tools only on demand and opens without recording execution history", async () => {
    setLocale("en");
    const elements = mount(); const onOpenTool = vi.fn();
    const tool = {toolId:"tool-1",accessId:"manual.tool:1",pluginId:"fixture",capabilityId:"text",title:"Fixture text",applicationName:"Fixture",publisher:"Studio",version:"0.1.0",enabled:true,runtime:"wasi"};
    const toolApi = {searchTools:vi.fn(async()=>({items:[tool],total:1,revision:"rev",nextOffset:null})),loadTool:vi.fn(),invoke:vi.fn()};
    const scope = {sceneId:"programming",workspaceId:"fixture"};
    const accessStore = {read:vi.fn(async()=>({schemaVersion:1 as const,revision:0,favorites:[],recent:[]})),mutate:vi.fn()};
    setupCommandPalette({...elements,commands:[{label:"Settings"}],toolApi,onOpenTool,getScope:()=>scope,accessStore});
    await act(async()=>elements.button.click());
    expect(toolApi.searchTools).not.toHaveBeenCalled();
    await act(async()=>[...elements.list.querySelectorAll("button")].find(button=>button.textContent === "Individual tools")?.click());
    await vi.waitFor(()=>expect(elements.list.textContent).toContain("Fixture text"));
    await act(async()=>elements.list.querySelector('[role="option"]')?.dispatchEvent(new MouseEvent("click",{bubbles:true})));
    expect(onOpenTool).toHaveBeenCalledWith(tool,"rev",scope);
    expect(elements.palette.classList.contains("hidden")).toBe(true);
    expect(accessStore.mutate).not.toHaveBeenCalled(); expect(toolApi.invoke).not.toHaveBeenCalled();
  });
  it("reports tool navigation failures through the tool error handler", async () => {
    setLocale("en");
    const elements = mount();
    const failure = { code: "catalog_changed", message: "private provider detail" };
    const onToolError = vi.fn();
    const onError = vi.fn();
    const tool = {toolId:"tool-1",accessId:"manual.tool:1",pluginId:"fixture",capabilityId:"text",title:"Fixture text",applicationName:"Fixture",publisher:"Studio",version:"0.1.0",enabled:true,runtime:"wasi"};
    const toolApi = {searchTools:vi.fn(async()=>({items:[tool],total:1,revision:"rev",nextOffset:null})),loadTool:vi.fn(),invoke:vi.fn()};
    setupCommandPalette({
      ...elements, commands:[], toolApi,
      getScope:()=>({sceneId:"programming",workspaceId:"fixture"}),
      onOpenTool:()=>Promise.reject(failure), onToolError, onError,
    });
    await act(async()=>elements.button.click());
    await act(async()=>[...elements.list.querySelectorAll("button")].find(button=>button.textContent === "Individual tools")?.click());
    await vi.waitFor(()=>expect(elements.list.textContent).toContain("Fixture text"));
    await act(async()=>elements.list.querySelector('[role="option"]')?.dispatchEvent(new MouseEvent("click",{bubbles:true})));
    await vi.waitFor(()=>expect(onToolError).toHaveBeenCalledWith(failure));
    expect(onError).not.toHaveBeenCalled();
    expect(elements.palette.classList.contains("hidden")).toBe(true);
    expect(toolApi.invoke).not.toHaveBeenCalled();
  });
  it("pages, jumps to boundaries, announces results and preserves ordinary Home caret navigation", () => {
    const elements = mount();
    const action = vi.fn();
    setupCommandPalette({ ...elements, commands: Array.from({ length: 30 }, (_, index) => ({
      id: `tool-${index}`, label: `Tool ${index}`, disabled: index % 2 === 0, action,
    })) });
    elements.button.click();
    const input = elements.list.querySelector("input") as HTMLInputElement;
    const press = (key: string, ctrlKey = false) => act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true }));
    });
    const selected = () => elements.list.querySelector('[aria-selected="true"]')?.textContent;
    expect(elements.list.querySelector('[role="status"]')?.textContent).toContain("30 / 30");
    press("PageDown");
    expect(selected()).toContain("Tool 21");
    press("End", true);
    expect(selected()).toContain("Tool 29");
    press("Home");
    expect(selected()).toContain("Tool 29");
    press("Home", true);
    expect(selected()).toContain("Tool 1");
    press("PageUp");
    expect(selected()).toContain("Tool 1");
    expect(action).not.toHaveBeenCalled();
  });
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
