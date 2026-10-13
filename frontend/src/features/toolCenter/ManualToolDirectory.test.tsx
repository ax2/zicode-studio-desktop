import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { translateDocument } from "i18n";
import { ManualToolDirectory } from "./ManualToolDirectory";
import type { ManualTool, ManualToolApi, ToolDetail } from "./manual-tools";
import { emptyAccess, type ToolAccessStore } from "../commandPalette/tool-access";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
// jsdom does not implement the browser's top-layer modal/focus behavior.
const dialogDescriptors = { showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close") };
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});
afterAll(() => {
  for (const key of ["showModal", "close"] as const) {
    const descriptor = dialogDescriptors[key];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); });
const scope = { sceneId: "programming", workspaceId: "workspace" };
const tool = (index: number): ManualTool => ({ toolId: `["fixture","text.${index}"]`, accessId: `manual.tool:${index}`,
  pluginId: "fixture", capabilityId: `text.${index}`, title: `Text ${index}`, applicationName: "Fixture", publisher: "Studio", version: "0.1.0", enabled: true, runtime: "javascript" });
function api() {
  return {
    searchTools: vi.fn<ManualToolApi["searchTools"]>(async () => ({ items: [tool(0), tool(1)], total: 2, revision: "revision", nextOffset: null })),
    loadTool: vi.fn<ManualToolApi["loadTool"]>(async (_scene, selected) => ({ pluginId: "fixture", version: "0.1.0", revision: selected.revision, enabled: true,
      capability: { id: selected.capabilityId, inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }, permissions: [] })),
    invoke: vi.fn(async () => ({ result: { text: "completed" } })),
  } satisfies ManualToolApi;
}
async function mount(gateway: ManualToolApi, accessStore?: ToolAccessStore) {
  setLocale("en"); vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ManualToolDirectory api={gateway} scope={scope} accessStore={accessStore} openApplication={() => undefined} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  return container;
}
async function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(value => value.textContent === label);
  expect(button).toBeTruthy(); await act(async () => button?.click());
}

it("defaults a file launch to resource tools, with metadata-only reversible filtering", async () => {
  const gateway = { ...api(), projectFiles: { entry: vi.fn(async () => "中文 & file.txt") } };
  const container = await mount(gateway);
  expect(gateway.projectFiles.entry).toHaveBeenCalledWith(scope.workspaceId);
  expect(gateway.searchTools.mock.lastCall?.[1].fileName).toBe("中文 & file.txt");
  expect(container.textContent).toContain("Plugin has not declared file types");
  expect(gateway.searchTools).toHaveBeenLastCalledWith(scope.sceneId, expect.objectContaining({ resourceOnly: true, offset: 0, revision: null }));
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(input?.checked).toBe(true);
  await act(async () => { input?.click(); await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools.mock.lastCall?.[1].resourceOnly).toBeUndefined();
  expect(gateway.loadTool).not.toHaveBeenCalled();
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("keeps normal launches unfiltered and lets users opt into file tools", async () => {
  const gateway = { ...api(), projectFiles: { entry: vi.fn(async () => null) } };
  const container = await mount(gateway);
  expect(gateway.searchTools.mock.lastCall?.[1].resourceOnly).toBeUndefined();
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => { input?.click(); await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith(scope.sceneId, expect.objectContaining({ resourceOnly: true, offset: 0 }));
});

it("keeps full opened-tool names and reveals the selected item without executing or reloading it", async () => {
  const gateway = api();
  const container = await mount(gateway);
  await click(container, "Open tool");
  await click(container, "Tool directory");
  await act(async () => (container.querySelectorAll("article")[1].querySelector("button") as HTMLButtonElement).click());
  const strip = container.querySelector<HTMLFieldSetElement>(".tool-open-switcher");
  expect(strip).not.toBeNull();
  const last = strip?.querySelector<HTMLButtonElement>('[title="Text 1"]');
  expect(last?.getAttribute("aria-pressed")).toBe("true");
  const rectangle = (left: number, right: number) => ({ left, right, width: right - left, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON() {} });
  const frame = vi.spyOn(strip as HTMLFieldSetElement, "getBoundingClientRect").mockReturnValue(rectangle(0, 300));
  const item = vi.spyOn(last?.parentElement as HTMLElement, "getBoundingClientRect").mockReturnValue(rectangle(400, 600));
  await click(container, "Text 0");
  await click(container, "Text 1");
  expect(strip?.scrollLeft).toBe(300);
  expect(last?.title).toBe("Text 1");
  const directoryButton = [...(strip?.querySelectorAll("button") ?? [])].find(button => button.textContent === "Tool directory");
  const first = vi.spyOn(directoryButton as HTMLButtonElement, "getBoundingClientRect").mockReturnValue(rectangle(-300, -180));
  await click(container, "Tool directory");
  expect(strip?.scrollLeft).toBe(0);
  expect(gateway.loadTool).toHaveBeenCalledTimes(2);
  expect(gateway.invoke).not.toHaveBeenCalled();
  frame.mockRestore(); item.mockRestore(); first.mockRestore();
});

it("isolates a failed detail, preserves another tool's inputs and only recovers after explicit close/reopen", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const gateway = api();
    const validDetail = gateway.loadTool.getMockImplementation();
    if (!validDetail) throw new Error("Missing test detail implementation");
    gateway.loadTool.mockImplementation(async (scene, selected) => {
      const detail = await validDetail(scene, selected);
      return selected.capabilityId === "text.1"
        ? { ...detail, permissions: null } as unknown as ToolDetail
        : detail;
    });
    const container = await mount(gateway);
    await click(container, "Open tool");
    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, "keep my input");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(container, "Tool directory");
    await act(async () => (container.querySelectorAll("article")[1].querySelector("button") as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Tool view unavailable");
    expect(container.textContent).toContain("Nothing was retried automatically");
    expect(gateway.invoke).not.toHaveBeenCalled();
    await click(container, "Text 0");
    expect(input.value).toBe("keep my input");
    const loads = gateway.loadTool.mock.calls.length;
    await click(container, "Text 1");
    expect(gateway.loadTool).toHaveBeenCalledTimes(loads);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    await act(async () => (container.querySelector('[role="alert"] button') as HTMLButtonElement).click());
    expect((container.querySelector('.manual-tool-directory-list') as HTMLElement).hidden).toBe(false);
    const close = container.querySelector('[aria-label="Close tool: Text 1"]') as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    await act(async () => close.click());
    await click(document.body, "Close tool");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    gateway.loadTool.mockImplementation(validDetail);
    await act(async () => (container.querySelectorAll("article")[1].querySelector("button") as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(gateway.loadTool).toHaveBeenCalledTimes(loads + 1);
    expect(gateway.invoke).not.toHaveBeenCalled();
    await click(container, "Text 0");
    expect(input.value).toBe("keep my input");
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(gateway.invoke).toHaveBeenCalledTimes(1);
    expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement)?.value).toContain("completed");
  } finally { consoleError.mockRestore(); }
});

it("asks inside the app, defaults to cancel and preserves input on cancellation", async () => {
  const gateway = api(), container = await mount(gateway);
  await click(container, "Open tool");
  const input = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, "keep draft"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Close tool: Text 0"]');
  await act(async () => trigger?.click());
  const dialog = document.querySelector("dialog");
  expect(dialog?.open).toBe(true);
  expect(dialog?.textContent).toContain("Text 0");
  expect(document.activeElement?.textContent).toBe("Cancel");
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe("Close tool");
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe("Cancel");
  await click(document.body, "Cancel");
  expect(document.querySelector("dialog")).toBeNull();
  expect(input.value).toBe("keep draft");
  expect(document.activeElement).toBe(trigger);
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("handles modal cancellation without discarding and removes only the confirmed tool", async () => {
  const gateway = api(), container = await mount(gateway);
  await click(container, "Open tool");
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Close tool: Text 0"]');
  await act(async () => trigger?.click());
  await act(async () => document.querySelector("dialog")?.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })));
  expect(document.querySelector("dialog")).toBeNull();
  expect(trigger?.isConnected).toBe(true);
  await act(async () => trigger?.click());
  await click(document.body, "Close tool");
  expect(trigger?.isConnected).toBe(false);
  expect(document.activeElement?.textContent).toBe("Tool directory");
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("cannot close a tool with an execution pending", async () => {
  const gateway = api(); let finish: ((value: { result: { text: string } }) => void) | undefined;
  gateway.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const container = await mount(gateway); await click(container, "Open tool");
  const input = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, "run"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Close tool: Text 0"]');
  expect(trigger?.disabled).toBe(true);
  await act(async () => trigger?.click());
  expect(document.querySelector("dialog")).toBeNull();
  await act(async () => finish?.({ result: { text: "done" } }));
  expect(trigger?.disabled).toBe(false);
});

it("dismisses a pending close confirmation when the workspace changes", async () => {
  const gateway = api(), container = await mount(gateway);
  await click(container, "Open tool");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close tool: Text 0"]')?.click());
  expect(document.querySelector("dialog")).not.toBeNull();
  await act(async () => roots.at(-1)?.render(<ManualToolDirectory api={gateway} scope={{ ...scope, workspaceId: "another" }} openApplication={() => undefined} />));
  expect(document.querySelector("dialog")).toBeNull();
  expect(container.querySelector('[aria-label="Close tool: Text 0"]')).not.toBeNull();
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("loads only selected schemas and executes explicitly with current scope/revision", async () => {
  const gateway = api(); const container = await mount(gateway);
  expect(gateway.loadTool).not.toHaveBeenCalled(); expect(gateway.invoke).not.toHaveBeenCalled();
  await click(container, "Open tool");
  expect(gateway.loadTool).toHaveBeenCalledTimes(1); expect(gateway.invoke).not.toHaveBeenCalled();
  const input = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, "中文\ntext"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(gateway.invoke).toHaveBeenCalledWith("programming", "workspace", "fixture", "text.0", { text: "中文\ntext" }, { catalogRevision: "revision" });
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement)?.value).toContain("completed");
  await click(container, "Tool directory");
  const cards = container.querySelectorAll("article");
  await act(async () => (cards[1].querySelector("button") as HTMLButtonElement).click());
  await click(container, "Text 0");
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("中文\ntext");
  expect(gateway.loadTool).toHaveBeenCalledTimes(2);
});

it("combines categories with source, search and favorites before paging without loading tools", async () => {
  const gateway = api();
  gateway.searchTools.mockResolvedValue({ items: [{ ...tool(0), description: "<img onerror=alert(1)>" }], total: 90, revision: "revision", nextOffset: 40,
    categories: [{ id: "text", count: 90 }, { id: "uncategorized", count: 1 }],
    sources: [{ pluginId: "fixture", title: "Fixture", count: 91, enabled: true }] });
  const store = { read: vi.fn(async () => ({ ...emptyAccess(), revision: 3 })), mutate: vi.fn(async () => emptyAccess()) };
  const container = await mount(gateway, store);
  expect(container.textContent).toContain("<img onerror=alert(1)>"); expect(container.querySelector("img")).toBeNull();
  const category = container.querySelectorAll("select")[1];
  await act(async () => { category.value = "text"; category.dispatchEvent(new Event("change", { bubbles: true })); await vi.advanceTimersByTimeAsync(201); });
  await click(container, "Next"); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", categoryId: "text", offset: 40, revision: "revision" });
  const source = container.querySelectorAll("select")[0];
  await act(async () => { source.value = "fixture"; source.dispatchEvent(new Event("change", { bubbles: true })); await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", categoryId: "text", pluginId: "fixture", offset: 0, revision: null });
  await click(container, "Favorite tools"); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", categoryId: "text", pluginId: "fixture", offset: 0, revision: null, view: "favorites", workspaceId: "workspace" });
  expect(gateway.loadTool).not.toHaveBeenCalled(); expect(gateway.invoke).not.toHaveBeenCalled();
});

it("keeps filtered totals and facet counts current when the shell translates again", async () => {
  const gateway = api();
  gateway.searchTools.mockResolvedValue({ items: [tool(0)], total: 1000, revision: "r", nextOffset: 40,
    sources: [{ pluginId: "fixture", title: "Fixture", count: 1000, enabled: true }], categories: [{ id: "text", count: 1000 }] });
  const container = await mount(gateway);
  translateDocument(container);
  gateway.searchTools.mockResolvedValue({ items: [tool(0)], total: 1, revision: "r", nextOffset: null,
    sources: [{ pluginId: "fixture", title: "Fixture", count: 1, enabled: true }], categories: [{ id: "text", count: 1 }] });
  const category = container.querySelectorAll("select")[1];
  await act(async () => { category.value = "text"; category.dispatchEvent(new Event("change", { bubbles: true })); await vi.advanceTimersByTimeAsync(201); });
  translateDocument(container);
  expect(container.textContent).toContain("1 tools");
  expect(container.textContent).not.toContain("1000");
  expect(container.querySelectorAll("select")[0].textContent).toContain("Fixture · 1");
  expect(category.textContent).toContain("Text tools · 1");
});

it("requests favorites across the whole directory with scoped pagination rather than filtering the visible page", async () => {
  const gateway = api();
  const store = { read: vi.fn(async () => ({ ...emptyAccess(), revision: 3, favorites: [tool(204).accessId] })),
    mutate: vi.fn(async () => ({ ...emptyAccess(), revision: 4 })) };
  const container = await mount(gateway, store);
  gateway.searchTools.mockResolvedValue({ items: [tool(204)], total: 55, revision: "revision", accessRevision: 3, nextOffset: 40 });
  await click(container, "Favorite tools");
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 0, revision: null, view: "favorites", workspaceId: "workspace" });
  expect(container.textContent).toContain("Text 204");
  expect(gateway.loadTool).not.toHaveBeenCalled(); expect(gateway.invoke).not.toHaveBeenCalled();
  await click(container, "Next");
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 40, revision: "revision", accessRevision: 3, view: "favorites", workspaceId: "workspace" });
  await click(container, "Recently used tools");
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 0, revision: null, view: "recent", workspaceId: "workspace" });
});

it("removing a favorite restarts its personalized page", async () => {
  const gateway = api();
  const store = { read: vi.fn(async () => ({ ...emptyAccess(), revision: 3, favorites: [tool(0).accessId] })),
    mutate: vi.fn(async () => ({ ...emptyAccess(), revision: 4 })) };
  const container = await mount(gateway, store);
  await click(container, "Favorite tools"); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  const favorite = container.querySelector('[aria-label="Favorite: Text 0"]') as HTMLButtonElement;
  gateway.searchTools.mockResolvedValue({ items: [], total: 0, revision: "revision", accessRevision: 4, nextOffset: null });
  await act(async () => favorite.click()); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(store.mutate).toHaveBeenCalledWith(scope, { kind: "favoriteSet", id: tool(0).accessId, enabled: false });
  expect(container.textContent).toContain("No matching tools");
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 0, revision: null, view: "favorites", workspaceId: "workspace" });
});

it("keeps browsing available when access metadata fails and offers a retry", async () => {
  const gateway = api();
  const store = { read: vi.fn<ToolAccessStore["read"]>(async () => { throw new Error("unavailable"); }), mutate: vi.fn(async () => emptyAccess()) };
  const container = await mount(gateway, store);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Tool history could not be loaded or saved");
  expect(container.textContent).toContain("Text 0");
  store.read.mockImplementation(async () => emptyAccess());
  await click(container, "Retry");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("preserves the changed favorite label during shell translation", async () => {
  const gateway = api();
  const store = { read: vi.fn(async () => emptyAccess()),
    mutate: vi.fn(async () => ({ ...emptyAccess(), revision: 1, favorites: [tool(0).accessId] })) };
  const container = await mount(gateway, store);
  translateDocument(container);
  const favorite = container.querySelector('[aria-label="Favorite: Text 0"]') as HTMLButtonElement;
  await act(async () => favorite.click());
  expect(favorite.textContent).toBe("Remove favorite");
  translateDocument(container);
  expect(favorite.textContent).toBe("Remove favorite");
});

it("keeps unsupported tools discoverable and never substitutes a JSON execute form", async () => {
  const gateway = api(); gateway.loadTool.mockImplementation(async (_scene, selected) => ({ pluginId: "fixture", version: "0.1.0", revision: selected.revision, enabled: true,
    capability: { id: selected.capabilityId, inputSchema: { type: "object", properties: { file: { type: "object" } } } }, permissions: [] }));
  const container = await mount(gateway); await click(container, "Open tool");
  expect(container.textContent).toContain("generic form cannot run it");
  expect(container.querySelector("form")).toBeNull(); expect(gateway.invoke).not.toHaveBeenCalled();
});

it("binds the next page to its revision and returns to the directory start", async () => {
  const gateway = api(); gateway.searchTools.mockResolvedValue({ items: [tool(0)], total: 205, revision: "revision", nextOffset: 40 });
  const container = await mount(gateway); const scroll = vi.fn();
  (container.querySelector(".manual-tool-directory") as HTMLElement).scrollIntoView = scroll;
  await click(container, "Next");
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 40, revision: "revision" });
  expect(gateway.loadTool).not.toHaveBeenCalled(); expect(gateway.invoke).not.toHaveBeenCalled();
});

it("refreshes a retained directory after the plugin catalog changes without closing opened tools", async () => {
  const gateway = api();
  gateway.searchTools.mockResolvedValue({ items: [tool(0)], total: 205, revision: "old", nextOffset: 40 });
  const container = await mount(gateway);
  await click(container, "Open tool");
  await click(container, "Tool directory");
  await click(container, "Next");
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 40, revision: "old" });

  gateway.searchTools.mockResolvedValue({ items: [tool(1)], total: 1, revision: "new", nextOffset: null });
  await act(async () => roots.at(-1)?.render(<ManualToolDirectory api={gateway} scope={scope} catalogRevision={1} openApplication={() => undefined} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 0, revision: null });
  expect(container.textContent).toContain("1 tools");
  expect(container.textContent).toContain("Text 1");
  expect(container.querySelectorAll(".tool-open-item")).toHaveLength(1);
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("filters by the whole catalog source and resets pagination without loading tools", async () => {
  const gateway = api();
  gateway.searchTools.mockResolvedValue({ items: [tool(0)], total: 205, revision: "revision", nextOffset: 40,
    sources: [{ pluginId: "fixture", title: "Fixture", count: 205, enabled: true }, { pluginId: "other", title: "Other", count: 90, enabled: false }] });
  const container = await mount(gateway);
  expect(container.textContent).toContain("Fixture · 205");
  expect(container.textContent).toContain("Other · 90 · Plugin is disabled");
  await click(container, "Next"); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  const select = container.querySelector("select") as HTMLSelectElement;
  await act(async () => { select.value = "other"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 0, revision: null, pluginId: "other" });
  expect(gateway.loadTool).not.toHaveBeenCalled(); expect(gateway.invoke).not.toHaveBeenCalled();
});

it("combines a source with favorites and lets an unavailable source be cleared", async () => {
  const gateway = api();
  gateway.searchTools.mockResolvedValue({ items: [tool(0)], total: 2, revision: "revision", nextOffset: null,
    sources: [{ pluginId: "fixture", title: "Fixture", count: 2, enabled: true }] });
  const store = { read: vi.fn(async () => emptyAccess()), mutate: vi.fn(async () => emptyAccess()) };
  const container = await mount(gateway, store);
  const select = container.querySelector("select") as HTMLSelectElement;
  await act(async () => { select.value = "fixture"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  gateway.searchTools.mockResolvedValue({ items: [], total: 0, revision: "revision", nextOffset: null, sources: [] });
  await click(container, "Favorite tools"); await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools).toHaveBeenLastCalledWith("programming", { query: "", offset: 0, revision: null, pluginId: "fixture", view: "favorites", workspaceId: "workspace" });
  expect(container.textContent).toContain("Source unavailable in this list");
  await act(async () => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(gateway.searchTools.mock.lastCall?.[1].pluginId).toBeUndefined();
});
