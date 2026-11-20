import { afterEach, expect, it, vi } from "vitest";
import { MULTI_PROJECT_UI_ENABLED, isWorkspaceApplicationVisible, isWorkspaceEntryVisible, resolveDefaultWorkspacePath } from "./workspace-mode.js";
import { setupWorkspaceSwitcher } from "./workspace-actions.js";
afterEach(() => { delete globalThis.__TAURI__; document.body.replaceChildren(); });
it("hides only the project application while retaining other independent tools", () => {
  expect(MULTI_PROJECT_UI_ENABLED).toBe(false); expect(isWorkspaceApplicationVisible("com.zicode.projects")).toBe(false);
  expect(isWorkspaceEntryVisible("com.zicode.projects:open")).toBe(false); expect(isWorkspaceEntryVisible("com.example.projects:open")).toBe(true); expect(isWorkspaceApplicationVisible("com.zicode.notes")).toBe(true);
});
it("does not populate, open or register a workspace switcher", () => {
  document.body.innerHTML='<div id="workspace-bar"><button id="workspace-switcher-btn"></button><div id="workspace-switcher-menu"></div></div>';
  const invoke=vi.fn(); globalThis.__TAURI__={core:{invoke}};
  expect(setupWorkspaceSwitcher()).toBe(false);document.querySelector("button").click();expect(invoke).not.toHaveBeenCalled();expect(document.querySelector("#workspace-bar").classList.contains("hidden")).toBe(true);
});
it("resolves the native default root internally and safely retains a non-native fallback", async () => {
  expect(await resolveDefaultWorkspacePath("/default")).toBe("/default");
  const invoke=vi.fn(async()=>[{id:"default",path:"D:/fixed/default"}]);globalThis.__TAURI__={core:{invoke}};
  expect(await resolveDefaultWorkspacePath("/fallback")).toBe("D:/fixed/default");expect(invoke).toHaveBeenCalledExactlyOnceWith("list_workspaces");
  invoke.mockResolvedValueOnce([{id:"a",path:"/a"},{id:"b",path:"/b"}]);expect(await resolveDefaultWorkspacePath("/fallback")).toBe("/fallback");
  invoke.mockRejectedValueOnce(Error("not ready"));expect(await resolveDefaultWorkspacePath("/fallback")).toBe("/fallback");
});
