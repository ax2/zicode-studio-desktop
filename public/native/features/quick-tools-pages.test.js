import { afterEach, expect, it, vi } from "vitest";
import { setupQuickTools } from "./quick-tools.js";

const handles = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.destroy(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const tool = (id, enabled = true) => ({ accessId: `tool:${id}`, toolId: `${id}`, title: `Tool ${id}`, enabled });
const disabled = (offset = 0) => Array.from({ length: 40 }, (_, i) => tool(i + offset, false));
const page = (items, nextOffset = null, extra = {}) => ({ items, nextOffset, revision: "catalog", accessRevision: 12, ...extra });
function setup(searchTools, options = {}) {
  const api = { searchTools: vi.fn(searchTools), invoke: vi.fn() }, invoke = vi.fn(async () => {}), openTool = vi.fn(), onError = vi.fn();
  const handle = setupQuickTools({ api, accessStore: {}, getTarget: () => ({ sceneId: "s", workspaceId: "w" }), invoke, openTool, onError, manage: vi.fn(), ...options });
  handles.push(handle);
  return { api, invoke, openTool, onError, handle };
}

it("fills shortcuts from later pages when the first forty favorites are disabled", async () => {
  const c = setup(async (_scene, options) => options.offset === 0 ? page(disabled(), 40) : page([tool(40), tool(41)]));
  await settle();
  expect(c.invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [{ id: "tool:40", title: "Tool 40" }, { id: "tool:41", title: "Tool 41" }] });
  expect(c.api.searchTools.mock.calls[1]).toEqual(["s", { workspaceId: "w", view: "favorites", query: "", offset: 40, revision: "catalog", accessRevision: 12, includeViewOperations: true }]);
  expect(c.openTool).not.toHaveBeenCalled(); expect(c.api.invoke).not.toHaveBeenCalled();
});

it("stops at eight enabled unique shortcuts without reading unnecessary pages", async () => {
  const first = [tool(1), ...disabled().slice(1)];
  const c = setup(async (_scene, options) => options.offset === 0 ? page(first, 40) : page([tool(1), ...Array.from({ length: 9 }, (_, i) => tool(i + 40))], 50));
  await settle();
  expect(c.api.searchTools).toHaveBeenCalledTimes(2);
  expect(c.invoke.mock.calls.at(-1)[1].shortcuts.map(t => t.id)).toEqual(["tool:1", ...Array.from({ length: 7 }, (_, i) => `tool:${i + 40}`)]);
});

it("revalidates a visible shortcut even when it has moved behind eight other enabled favorites", async () => {
  const c = setup(async () => page([tool(80)])); await settle();
  c.api.searchTools.mockImplementation(async (_scene, options) => options.offset === 0
    ? page(Array.from({ length: 40 }, (_, i) => tool(i)), 40) : page([tool(80)]));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:80" })); await settle();
  expect(c.openTool).toHaveBeenCalledWith(tool(80), "catalog", { sceneId: "s", workspaceId: "w" });
  expect(c.api.invoke).not.toHaveBeenCalled();
});

it("does not combine pages from different catalog or favorite revisions", async () => {
  const c = setup(async (_scene, options) => options.offset === 0 ? page(disabled(), 40) : page([tool(40)], null, { accessRevision: 13 }));
  await settle(); expect(c.onError).toHaveBeenCalledTimes(1);
  expect(c.invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [] });
  c.api.searchTools.mockResolvedValue(page([tool(40)])); await c.handle.refresh();
  expect(c.invoke.mock.calls.at(-1)[1].shortcuts).toEqual([{ id: "tool:40", title: "Tool 40" }]);
});

it.each([0, 513, -1, 1.5])("rejects an invalid next offset %s instead of looping or silently hiding tools", async nextOffset => {
  const c = setup(async () => page(disabled(), nextOffset)); await settle();
  expect(c.api.searchTools).toHaveBeenCalledTimes(1); expect(c.onError).toHaveBeenCalledTimes(1);
  expect(c.invoke.mock.calls.at(-1)[1].shortcuts).toEqual([]);
});

it("abandons a pending page when the workspace changes without reading another old page", async () => {
  let workspaceId = "old", finish;
  const c = setup(() => new Promise(resolve => { finish = resolve; }), { getTarget: () => ({ sceneId: "s", workspaceId }) });
  workspaceId = "new"; finish(page(disabled(), 40)); await settle();
  expect(c.api.searchTools).toHaveBeenCalledTimes(1); expect(c.invoke).not.toHaveBeenCalled();
});

it("can reach the last of 512 favorites within the existing Host bound", async () => {
  const c = setup(async (_scene, options) => {
    const count = Math.min(40, 512 - options.offset);
    return page(Array.from({ length: count }, (_, i) => tool(options.offset + i, options.offset + i === 511)), options.offset + count === 512 ? null : options.offset + count);
  });
  await settle(); expect(c.api.searchTools).toHaveBeenCalledTimes(13);
  expect(c.invoke.mock.calls.at(-1)[1].shortcuts).toEqual([{ id: "tool:511", title: "Tool 511" }]);
});

it("does not open a disabled favorite discovered on a later revalidation page", async () => {
  const c = setup(async () => page([tool(40)])); await settle();
  c.api.searchTools.mockImplementation(async (_scene, options) => options.offset === 0 ? page(disabled(), 40) : page([tool(40, false)]));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:40" })); await settle();
  expect(c.openTool).not.toHaveBeenCalled(); expect(c.invoke.mock.calls.at(-1)[1].shortcuts).toEqual([]);
});

it("abandons old opening metadata if favorites change while a later page is pending", async () => {
  const c = setup(async () => page([tool(40)])); await settle();
  let finish;
  c.api.searchTools.mockImplementation(async (_scene, options) => options.offset === 0 ? page(disabled(), 40) : new Promise(resolve => { finish = resolve; }));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:40" })); await settle();
  c.api.searchTools.mockResolvedValue(page([]));
  window.dispatchEvent(new Event("zicode:tool-access-changed")); await settle();
  finish(page([tool(40)])); await settle(); expect(c.openTool).not.toHaveBeenCalled();
});
