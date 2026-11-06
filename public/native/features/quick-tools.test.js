import { afterEach, expect, it, vi } from "vitest";
import { setupQuickTools } from "./quick-tools.js";

const handles = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.destroy(); });
function setup(options = {}) {
  const tool = { accessId: "tool:one", toolId: "one", title: "Base64", enabled: true };
  const api = { searchTools: vi.fn(async () => ({ items: [tool], revision: "r1" })), invoke: vi.fn() };
  const openTool = vi.fn(), manage = vi.fn(), invoke = vi.fn(async () => {}), onError = vi.fn();
  const getTarget = () => ({ sceneId: "programming", workspaceId: "project" });
  const handle = setupQuickTools({ api, accessStore: {}, getTarget, openTool, manage, invoke, onError, ...options });
  handles.push(handle);
  return { handle, api, tool, openTool, manage, invoke, onError };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it("projects persisted favorites to the menu and opens fresh metadata only after a click", async () => {
  const { api, openTool, invoke } = setup();
  await settle();
  expect(invoke).toHaveBeenCalledWith("set_desktop_tool_shortcuts", { shortcuts: [{ id: "tool:one", title: "Base64" }] });
  expect(openTool).not.toHaveBeenCalled();
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" }));
  await settle();
  expect(openTool).toHaveBeenCalledWith(expect.objectContaining({ accessId: "tool:one" }), "r1", { sceneId: "programming", workspaceId: "project" });
  expect(api.searchTools).toHaveBeenCalledTimes(2);
  expect(api.invoke).not.toHaveBeenCalled();
});

it("ignores arbitrary IDs and tools unfavorited since the menu was drawn", async () => {
  const { api, openTool } = setup(); await settle();
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "untrusted" })); await settle();
  expect(api.searchTools).toHaveBeenCalledTimes(1);
  api.searchTools.mockResolvedValue({ items: [], revision: "r2" });
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" })); await settle();
  expect(openTool).not.toHaveBeenCalled();
});

it("does not carry an in-flight shortcut into a different workspace", async () => {
  let workspaceId = "one", resolve;
  const { api, openTool } = setup({ getTarget: () => ({ sceneId: "programming", workspaceId }) }); await settle();
  api.searchTools.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" }));
  workspaceId = "two";
  resolve({ items: [{ accessId: "tool:one", enabled: true }], revision: "r2" }); await settle();
  expect(openTool).not.toHaveBeenCalled();
});

it("bounds the menu, excludes disabled tools, and refreshes after favorite changes", async () => {
  const { api, invoke } = setup(); await settle();
  api.searchTools.mockResolvedValue({ items: Array.from({ length: 12 }, (_, i) => ({ accessId: `tool:${i}`, title: `Tool ${i}`, enabled: i !== 0 })), revision: "r2" });
  window.dispatchEvent(new Event("zicode:tool-access-changed")); await settle();
  const shortcuts = invoke.mock.calls.at(-1)[1].shortcuts;
  expect(shortcuts).toHaveLength(8);
  expect(shortcuts[0].id).toBe("tool:1");
});

it("keeps valid shortcuts usable when native menu projection fails", async () => {
  const { openTool, onError } = setup({ invoke: vi.fn(async () => { throw Error("native menu unavailable"); }) }); await settle();
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" })); await settle();
  expect(openTool).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledTimes(1);
});

it("clears native shortcuts when the directory cannot be read and recovers without changing favorites", async () => {
  const { api, invoke, handle, onError } = setup(); await settle();
  api.searchTools.mockRejectedValueOnce(Error("temporary directory failure"));
  await handle.refresh();
  expect(invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [] });
  await handle.refresh();
  expect(invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [{ id: "tool:one", title: "Base64" }] });
  expect(onError).toHaveBeenCalledTimes(1);
});

it("does not open a tool after its controller is destroyed", async () => {
  let finish;
  const { api, handle, openTool } = setup(); await settle();
  api.searchTools.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" }));
  handle.destroy();
  finish({ items: [{ accessId: "tool:one", enabled: true }], revision: "r2" }); await settle();
  expect(openTool).not.toHaveBeenCalled();
});

it("keeps the last requested shortcut selected when directory responses arrive out of order", async () => {
  const { api, handle, openTool } = setup(); await settle();
  const tools = [{ accessId: "tool:one", enabled: true, title: "One" }, { accessId: "tool:two", enabled: true, title: "Two" }];
  api.searchTools.mockResolvedValue({ items: tools, revision: "r2" }); await handle.refresh();
  let first, second;
  api.searchTools.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" }));
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:two" }));
  second({ items: tools, revision: "r2" }); await settle();
  first({ items: tools, revision: "r2" }); await settle();
  expect(openTool).toHaveBeenCalledTimes(1);
  expect(openTool).toHaveBeenCalledWith(tools[1], "r2", expect.any(Object));
});


it("clears the previous workspace immediately while the next directory is pending", async () => {
  let workspaceId = "one", finish;
  const { api, invoke, openTool } = setup({ getTarget: () => ({ sceneId: "programming", workspaceId }) }); await settle();
  api.searchTools.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  workspaceId = "two";
  window.dispatchEvent(new Event("zicode:tool-target-changed")); await settle();
  expect(invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [] });
  window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" }));
  expect(api.searchTools).toHaveBeenCalledTimes(2);
  expect(openTool).not.toHaveBeenCalled();
  finish({ items: [], revision: "r2" }); await settle();
});

it("serializes native updates so an old write cannot overwrite recovery", async () => {
  let finish;
  const invoke = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(undefined);
  const { api, handle } = setup({ invoke }); await settle();
  api.searchTools.mockRejectedValueOnce(Error("temporary failure"));
  const failed = handle.refresh(); await settle();
  api.searchTools.mockResolvedValue({ items: [{ accessId: "tool:recovered", title: "Recovered", enabled: true }], revision: "r3" });
  const recovered = handle.refresh(); await settle();
  expect(invoke).toHaveBeenCalledTimes(1);
  finish(); await Promise.all([failed, recovered]);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [{ id: "tool:recovered", title: "Recovered" }] });
});

it("reports management navigation errors without an unhandled rejection", async () => {
  const error = Error("navigation unavailable");
  const { onError } = setup({ manage: vi.fn(async () => { throw error; }) }); await settle();
  window.dispatchEvent(new Event("zicode:manage-quick-tools")); await settle();
  expect(onError).toHaveBeenCalledWith(error);
});


it("shows a recoverable unavailable state if opening cannot revalidate the directory", async () => {
  const { api, invoke, openTool } = setup(); await settle();
  const snapshots = [];
  const changed = event => snapshots.push(event.detail);
  window.addEventListener("zicode:quick-tools-changed", changed);
  try {
    api.searchTools.mockRejectedValueOnce(Error("opening directory unavailable"));
    window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: "tool:one" })); await settle();
    expect(openTool).not.toHaveBeenCalled();
    expect(snapshots.at(-1)).toMatchObject({ items: [], error: true });
    expect(invoke).toHaveBeenLastCalledWith("set_desktop_tool_shortcuts", { shortcuts: [] });
    window.dispatchEvent(new Event("zicode:quick-tools-retry")); await settle();
    expect(snapshots.at(-1)).toMatchObject({ items: [{ id: "tool:one", title: "Base64" }], error: false });
  } finally { window.removeEventListener("zicode:quick-tools-changed", changed); }
});

