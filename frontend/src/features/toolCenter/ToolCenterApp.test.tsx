import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { emptyAccess, type ToolAccessMutation } from "../commandPalette/tool-access";
import { ToolCenterApp } from "./ToolCenterApp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });

it("bounds 1000 rendered cards, searches metadata and opens only on explicit action", async () => {
  setLocale("en");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const onOpen = vi.fn();
  const entries = Array.from({ length: 1000 }, (_, index) => ({ id: `fixture.${index}:open`, label: `Application ${index}`,
    desc: "Description", category: "Other applications", source: "Fixture", keywords: [`unique-${index}`] }));
  await act(async () => root.render(<ToolCenterApp entries={entries} onOpen={onOpen} onManage={vi.fn()} onCommands={vi.fn()} />));
  expect(container.querySelectorAll("article")).toHaveLength(40);
  const input = container.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "unique-999");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => (container.querySelector("article button") as HTMLButtonElement).click());
  expect(onOpen).toHaveBeenCalledWith(entries[999]);
});

it("routes a selected capability to the application's tool-location callback", async () => {
  setLocale("en");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const onOpenToolApplication = vi.fn();
  const tool = { toolId: '["fixture","format.json"]', accessId: "manual.tool:fixture", pluginId: "fixture",
    capabilityId: "format.json", title: "Format JSON", applicationName: "Fixture", publisher: "Fixture",
    version: "0.1.0", enabled: true, runtime: "javascript" };
  const toolApi = { searchTools: vi.fn(async () => ({ items: [tool], total: 1, revision: "revision", nextOffset: null })),
    loadTool: vi.fn(async () => ({ pluginId: "fixture", version: "0.1.0", revision: "revision", enabled: true,
      capability: { id: "format.json", inputSchema: { type: "object", properties: {} } }, permissions: [] })),
    invoke: vi.fn() };
  await act(async () => root.render(<ToolCenterApp
    entries={[{ id: "fixture:open", label: "Fixture", category: "Data and formats", source: "Fixture" }]}
    toolApi={toolApi} scope={{ sceneId: "programming", workspaceId: "fixture" }}
    onOpen={vi.fn()} onOpenToolApplication={onOpenToolApplication} onManage={vi.fn()} onCommands={vi.fn()} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); });
  expect(container.textContent).toContain("Format JSON");
  await act(async () => ([...container.querySelectorAll("button")].find(button => button.textContent === "Open tool") as HTMLButtonElement).click());
  await act(async () => ([...container.querySelectorAll("button")].find(button => button.textContent === "Open application") as HTMLButtonElement).click());
  expect(onOpenToolApplication).toHaveBeenCalledWith("fixture", "format.json", "0.1.0", expect.objectContaining({ id: "fixture:open" }));
  expect(toolApi.invoke).not.toHaveBeenCalled();
});

it("shows all applications when a tray favorite view arrives without saved access", async () => {
  setLocale("en");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ToolCenterApp entries={[{ id: "app:open", label: "App", category: "Other applications", source: "Fixture" }]}
    onOpen={vi.fn()} onManage={vi.fn()} onCommands={vi.fn()} />));
  await act(async () => window.dispatchEvent(new CustomEvent("zicode:tool-view", { detail: "favorites" })));
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(container.querySelector('[aria-label="Application views"] button[aria-pressed="true"]')?.textContent).toBe("All applications");
});

it("keeps a disabled application discoverable and routes only to plugin management", async () => {
  setLocale("en");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const onOpen = vi.fn(); const onManage = vi.fn();
  await act(async () => root.render(<ToolCenterApp entries={[{ id: "disabled:open", label: "Installed application",
    category: "System tools", source: "Fixture", disabled: true }]}
    onOpen={onOpen} onManage={onManage} onCommands={vi.fn()} />));
  const card = container.querySelector("article") as HTMLElement;
  expect(card.textContent).toContain("Disabled");
  expect([...card.querySelectorAll("button")].some(button => button.textContent === "Open")).toBe(false);
  await act(async () => (card.querySelector("button") as HTMLButtonElement).click());
  expect(onManage).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
});

it("keeps applications visible when saved access fails and restores the requested view after retry", async () => {
  setLocale("en");
  const store = { read: vi.fn().mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({ ...emptyAccess(), favorites: ["app:open"] }), mutate: vi.fn() };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ToolCenterApp entries={[{ id: "app:open", label: "App", category: "Other applications", source: "Fixture" }]}
    accessStore={store} scope={{ sceneId: "programming", workspaceId: "fixture" }}
    onOpen={vi.fn()} onManage={vi.fn()} onCommands={vi.fn()} />));
  await act(async () => window.dispatchEvent(new CustomEvent("zicode:tool-view", { detail: "favorites" })));
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(container.querySelector('[aria-label="Application views"] button[aria-pressed="true"]')?.textContent).toBe("All applications");
  expect([...container.querySelectorAll("button")].find(button => button.textContent === "Favorite applications")?.disabled).toBe(true);
  await act(async () => ([...container.querySelectorAll("button")].find(button => button.textContent === "Retry") as HTMLButtonElement).click());
  expect(container.querySelector('[aria-label="Application views"] button[aria-pressed="true"]')?.textContent).toBe("Favorite applications");
  expect(container.querySelectorAll("article")).toHaveLength(1);
});

it("shares favorite IDs with the command palette and keeps missing app favorites removable", async () => {
  setLocale("en");
  const state = { ...emptyAccess(), favorites: ["gone:open", "command:unrelated"] };
  const store = { read: vi.fn(async () => state), mutate: vi.fn(async (_scope, mutation: ToolAccessMutation) => {
    if (mutation.kind === "favoriteSet") state.favorites = mutation.enabled ? [...state.favorites, mutation.id] : state.favorites.filter(id => id !== mutation.id);
    return { ...state };
  }) };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ToolCenterApp entries={[{ id: "app:open", label: "App", category: "Other applications", source: "Fixture" }]}
    accessStore={store} scope={{ sceneId: "programming", workspaceId: "fixture" }} onOpen={vi.fn()} onManage={vi.fn()} onCommands={vi.fn()} />));
  await act(async () => (container.querySelector('[aria-label="Favorite: App"]') as HTMLButtonElement).click());
  expect(store.mutate).toHaveBeenCalledWith({ sceneId: "programming", workspaceId: "fixture" }, { kind: "favoriteSet", id: "app:open", enabled: true });
  await act(async () => ([...container.querySelectorAll("button")].find(button => button.textContent === "Favorite applications") as HTMLButtonElement).click());
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(container.querySelector("details")?.textContent).toContain("gone:open");
  expect(container.querySelector("details")?.textContent).not.toContain("command:unrelated");
});
