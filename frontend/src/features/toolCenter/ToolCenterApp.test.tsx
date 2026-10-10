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
