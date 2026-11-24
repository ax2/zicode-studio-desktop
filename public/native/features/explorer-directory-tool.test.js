import { expect, it, vi } from "vitest";
import { openExplorerDirectoryTool } from "./explorer-directory-tool.js";

const scope = { workspaceId: "workspace", sceneId: "programming" };
const tool = { pluginId: "com.zicode.devtools.disk-inspector", capabilityId: "devtools.disk-inspector.scan", enabled: true };

function fixture() {
  let target = { ...scope, runtimeMode: "tools", instanceId: "instance", sessionId: "tools-first" };
  const api = { searchTools: vi.fn(async () => ({ items: [tool], revision: "catalog" })) };
  const openTool = vi.fn();
  const entryMode = vi.fn(async () => "directoryUsage");
  return { api, openTool, entryMode, getTarget: () => target,
    changeSession: () => { target = { ...target, sessionId: "tools-second" }; } };
}

it("opens only the catalog-bound Disk Inspector when Windows supplies a folder entry", async () => {
  const f = fixture();
  await expect(openExplorerDirectoryTool(f)).resolves.toBe(true);
  expect(f.api.searchTools).toHaveBeenCalledWith("programming", { pluginId: tool.pluginId, directoryOnly: true });
  expect(f.openTool).toHaveBeenCalledWith(tool, "catalog", scope);
});

it("leaves ordinary tool and Notes widget starts unchanged", async () => {
  const f = fixture();
  f.entryMode.mockResolvedValue("notesWidget");
  await expect(openExplorerDirectoryTool(f)).resolves.toBe(false);
  expect(f.api.searchTools).not.toHaveBeenCalled();
  expect(f.openTool).not.toHaveBeenCalled();
});

it("discards a stale catalog response when the original tool session changes", async () => {
  const f = fixture();
  f.api.searchTools.mockImplementation(async () => {
    f.changeSession();
    return { items: [tool], revision: "catalog" };
  });
  await expect(openExplorerDirectoryTool(f)).resolves.toBe(true);
  expect(f.openTool).not.toHaveBeenCalled();
});

it("describes the missing candidate instead of opening another provider", async () => {
  const f = fixture();
  f.api.searchTools.mockResolvedValue({ items: [{ ...tool, enabled: false }, { ...tool, pluginId: "another" }], revision: "catalog" });
  await expect(openExplorerDirectoryTool(f)).rejects.toThrow();
  expect(f.openTool).not.toHaveBeenCalled();
});
