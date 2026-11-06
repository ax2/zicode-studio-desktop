import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, afterAll, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDirectory } from "./ManualToolDirectory";
import type { ManualTool, ManualToolApi } from "./manual-tools";

const roots: ReturnType<typeof createRoot>[] = [];
const descriptors = { showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close") };
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});
afterAll(() => {
  for (const key of ["showModal", "close"] as const) {
    if (descriptors[key]) Object.defineProperty(HTMLDialogElement.prototype, key, descriptors[key]);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); });

const tool = (i: number): ManualTool => ({ toolId: `tool-${i}`, accessId: `manual.tool:${i}`, pluginId: "fixture", capabilityId: `text.${i}`, title: `Text ${i}`, applicationName: "Fixture", publisher: "Studio", version: "0.1.0", enabled: true, runtime: "wasi" });
async function fixture() {
  setLocale("en"); vi.useFakeTimers();
  const api: ManualToolApi = {
    searchTools: vi.fn(async () => ({ items: [0, 1, 2].map(tool), total: 3, revision: "r", nextOffset: null })),
    loadTool: vi.fn(async (_scene, selected) => ({ pluginId: "fixture", version: "0.1.0", revision: selected.revision, enabled: true, capability: { id: selected.capabilityId, inputSchema: { type: "object", properties: { text: { type: "string" } } } }, permissions: [] })),
    invoke: vi.fn(),
  };
  const container = document.createElement("main"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => { root.render(<ManualToolDirectory api={api} scope={{ sceneId: "programming", workspaceId: "fixture" }} openApplication={() => undefined} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  const tab = (i: number | null) => container.querySelector<HTMLButtonElement>(`[data-open-tool-id="${i === null ? "" : `tool-${i}`}"]`) as HTMLButtonElement;
  const click = async (element: HTMLElement) => { await act(async () => element.click()); };
  for (const index of [0, 1, 2]) {
    await click(tab(null));
    await click(container.querySelectorAll("article")[index].querySelector("button") as HTMLButtonElement);
    const input = [...container.querySelectorAll<HTMLTextAreaElement>("textarea:not([readonly])")].at(-1) as HTMLTextAreaElement;
    await act(async () => fireEvent.input(input, { target: { value: `draft ${index}` } }));
  }
  const key = async (i: number | null, value: string, extra = {}) => { await act(async () => { tab(i).focus(); fireEvent.keyDown(tab(i), { key: value, ...extra }); }); };
  const close = async (i: number) => {
    await click(container.querySelector(`[aria-label="Close tool: Text ${i}"]`) as HTMLButtonElement);
    await click([...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(b => b.textContent === "Close tool") as HTMLButtonElement);
  };
  const visibleDraft = () => [...container.querySelectorAll<HTMLTextAreaElement>("textarea:not([readonly])")].find(input => !input.closest("[hidden]"))?.value;
  return { container, api, tab, click, key, close, visibleDraft };
}

it("closes the active middle, final and last remaining tabs in place with their neighboring drafts intact", async () => {
  const c = await fixture(); await c.click(c.tab(1)); await c.close(1);
  expect(c.tab(2).getAttribute("aria-pressed")).toBe("true"); expect(document.activeElement).toBe(c.tab(2)); expect(c.visibleDraft()).toBe("draft 2");
  await c.close(2); expect(document.activeElement).toBe(c.tab(0)); expect(c.visibleDraft()).toBe("draft 0");
  await c.close(0); expect(document.activeElement).toBe(c.tab(null)); expect(c.tab(null).getAttribute("aria-pressed")).toBe("true");
  expect(c.api.loadTool).toHaveBeenCalledTimes(3); expect(c.api.invoke).not.toHaveBeenCalled();
});

it("closing a background tab keeps the current tool and its draft active", async () => {
  const c = await fixture(); await c.close(0);
  expect(c.tab(2).getAttribute("aria-pressed")).toBe("true"); expect(document.activeElement).toBe(c.tab(2));
  expect(c.visibleDraft()).toBe("draft 2"); expect(c.api.invoke).not.toHaveBeenCalled();
});

it("cycles selection with arrows and Home/End without reloading tools, editing drafts or consuming composition/modified keys", async () => {
  const c = await fixture();
  await c.key(2, "ArrowRight"); expect(document.activeElement).toBe(c.tab(null));
  await c.key(null, "ArrowLeft"); expect(document.activeElement).toBe(c.tab(2));
  await c.key(2, "Home"); expect(document.activeElement).toBe(c.tab(null));
  await c.key(null, "End"); expect(document.activeElement).toBe(c.tab(2));
  await c.key(2, "ArrowLeft"); expect(document.activeElement).toBe(c.tab(1)); expect(c.visibleDraft()).toBe("draft 1");
  for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    await c.key(1, "Home", modifier); expect(document.activeElement).toBe(c.tab(1)); expect(c.tab(1).getAttribute("aria-pressed")).toBe("true");
  }
  expect(c.api.loadTool).toHaveBeenCalledTimes(3); expect(c.api.invoke).not.toHaveBeenCalled();
});

it("Delete asks before closing, Escape preserves the draft and focus, and confirming keeps the neighboring tool", async () => {
  const c = await fixture(); await c.key(2, "Delete");
  expect(document.querySelector("dialog")?.open).toBe(true); expect(document.activeElement?.textContent).toBe("Cancel");
  await act(async () => document.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true })));
  expect(document.querySelector("dialog")).toBeNull(); expect(document.activeElement).toBe(c.tab(2)); expect(c.visibleDraft()).toBe("draft 2");
  await c.key(2, "Delete");
  await c.click([...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(b => b.textContent === "Close tool") as HTMLButtonElement);
  expect(document.activeElement).toBe(c.tab(1)); expect(c.visibleDraft()).toBe("draft 1"); expect(c.api.invoke).not.toHaveBeenCalled();
});

it("Delete cannot close a running tool or interrupt its result", async () => {
  const c = await fixture(); let finish: (() => void) | undefined;
  vi.mocked(c.api.invoke).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ result: { text: "finished safely" } }); }));
  const form = [...c.container.querySelectorAll("form")].find(e => !e.closest("[hidden]"));
  await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(c.api.invoke).toHaveBeenCalledTimes(1);
  expect((c.container.querySelector('[aria-label="Close tool: Text 2"]') as HTMLButtonElement).disabled).toBe(true);
  await c.key(2, "Delete"); expect(document.querySelector("dialog")).toBeNull(); expect(c.tab(2).isConnected).toBe(true);
  await act(async () => finish?.());
  expect(c.visibleDraft()).toBe("draft 2");
  expect((c.container.querySelector('[aria-label="Close tool: Text 2"]') as HTMLButtonElement).disabled).toBe(false);
  expect((c.container.querySelector('[data-tool-result]') as HTMLTextAreaElement).value).toContain("finished safely");
});
