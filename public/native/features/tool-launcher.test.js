import { describe, expect, it, vi } from "vitest";
import { createToolLauncher } from "./tool-launcher.js";

function fixture() {
  const scope = { sceneId: "scene-a", workspaceId: "workspace-a" };
  const enabled = { accessId: "tool:enabled", enabled: true };
  const disabled = { accessId: "tool:disabled", enabled: false };
  const items = [enabled, disabled];
  const searchTools = vi.fn(async () => ({ items, revision: "r", accessRevision: 2 }));
  const mutate = vi.fn(async () => {});
  const openTool = vi.fn(async () => true);
  const openApp = vi.fn(async () => true);
  let generation = 1, appEnabled = true;
  const launcher = createToolLauncher({
    api: { searchTools },
    accessStore: { read: async () => ({ favorites: [enabled.accessId], recent: [{ id: "app:open" }] }), mutate },
    applications: () => [{ id: "app:open", disabled: !appEnabled, action: openApp }],
    scope: () => scope, current: owner => owner === scope, openTool, generation: () => generation,
  });
  const search = (controller = new AbortController()) => launcher.search("all", "query",
    { offset: 0, revision: null }, controller.signal);
  return { launcher, enabled, disabled, search, searchTools, scope, mutate, openTool, openApp,
    invalidate: () => { generation++; }, disableApp: () => { appEnabled = false; } };
}

describe("native tool launcher bridge", () => {
  it("opens the exact enabled directory identity with its scoped revision; never opens disabled or fabricated items", async () => {
    const f = fixture();
    const result = await f.search();
    expect(f.searchTools).toHaveBeenCalledWith("scene-a", {
      workspaceId: "workspace-a", query: "query", view: "all", includeViewOperations: true, offset: 0, revision: null,
    }, expect.any(AbortSignal));
    expect(result.favoriteIds).toEqual([f.enabled.accessId]);
    expect(result.recentIds).toEqual(["app:open"]);
    await expect(f.launcher.open(f.disabled, result)).rejects.toMatchObject({ code: "catalog_changed" });
    await expect(f.launcher.open({ ...f.enabled }, result)).rejects.toMatchObject({ code: "catalog_changed" });
    await expect(f.launcher.open(f.enabled, result)).resolves.toBe(true);
    expect(f.openTool).toHaveBeenCalledExactlyOnceWith(f.enabled, "r", f.scope);
  });

  it("rejects stale catalog opens and pins after invalidation; respects cancellation even if Host responds", async () => {
    const f = fixture();
    const result = await f.search();
    await f.launcher.setFavorite(f.enabled.accessId, false, result);
    expect(f.mutate).toHaveBeenCalledExactlyOnceWith(f.scope, { kind: "favoriteSet", id: f.enabled.accessId, enabled: false });
    f.invalidate();
    await expect(f.launcher.setFavorite(f.enabled.accessId, true, result)).rejects.toMatchObject({ code: "catalog_changed" });
    await expect(f.launcher.open(f.enabled, result)).rejects.toMatchObject({ code: "catalog_changed" });
    const controller = new AbortController();
    const pending = f.search(controller);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(f.openTool).not.toHaveBeenCalled();
    expect(f.mutate).toHaveBeenCalledOnce();
  });

  it("refreshes application availability before opening and records recent only after a successful open", async () => {
    const f = fixture();
    await f.launcher.openApplication("app:open");
    expect(f.mutate).toHaveBeenCalledExactlyOnceWith(f.scope, { kind: "recentRecord", id: "app:open" });
    f.disableApp();
    await expect(f.launcher.openApplication("app:open")).rejects.toMatchObject({ code: "catalog_changed" });
    expect(f.openApp).toHaveBeenCalledOnce();
  });
});
