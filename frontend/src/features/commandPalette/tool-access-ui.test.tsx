import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { CommandPaletteApp } from "./CommandPaletteApp";
import { emptyAccess } from "./tool-access";

afterEach(cleanup);
it("loads saved favorites, keeps unavailable IDs removable and saves an explicit mutation", async () => {
  const initial = { ...emptyAccess(), favorites: ["removed"] };
  const store = { read: vi.fn().mockResolvedValue(initial), mutate: vi.fn().mockResolvedValue({ ...initial, favorites: ["removed", "tool"] }) };
  render(<CommandPaletteApp commands={[{ id: "tool", label: "Text", action() {} }]}
    scope={{ sceneId: "s", workspaceId: "w" }} accessStore={store} onRun={vi.fn()} />);
  const favorite = screen.getByRole("button", { name: t("Favorite selected command") });
  await waitFor(() => expect(favorite.hasAttribute("disabled")).toBe(false));
  fireEvent.click(favorite);
  await waitFor(() => expect(store.mutate).toHaveBeenCalledWith({ sceneId: "s", workspaceId: "w" }, { kind: "favoriteSet", id: "tool", enabled: true }));
  fireEvent.click(screen.getByRole("button", { name: t("Favorite commands") }));
  expect(screen.getByRole("option").textContent).toContain("Text");
  expect(screen.getByText("removed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `${t("Remove favorite")}: removed` }));
  await waitFor(() => expect(store.mutate).toHaveBeenLastCalledWith({ sceneId: "s", workspaceId: "w" }, { kind: "favoriteSet", id: "removed", enabled: false }));
});

it("shows storage failure without disabling ordinary tools and retries the read", async () => {
  const onRun = vi.fn();
  const store = { read: vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(emptyAccess()), mutate: vi.fn() };
  render(<CommandPaletteApp commands={[{ id: "tool", label: "Text", action() {} }]}
    scope={{ sceneId: "s", workspaceId: "w" }} accessStore={store} onRun={onRun} />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  fireEvent.click(screen.getByRole("option"));
  expect(onRun).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: t("Retry") }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(store.read).toHaveBeenCalledTimes(2);
});

it("recovers a startup Host connection failure without asking for a manual retry", async () => {
  const store = { read: vi.fn().mockRejectedValueOnce(new Error("ZiCode Studio Desktop Host runtime is disconnected"))
    .mockResolvedValue(emptyAccess()), mutate: vi.fn() };
  render(<CommandPaletteApp commands={[{ id: "tool", label: "Text", action() {} }]}
    scope={{ sceneId: "s", workspaceId: "w" }} accessStore={store} onRun={vi.fn()} />);
  await waitFor(() => expect(store.read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: t("Favorite selected command") }).hasAttribute("disabled")).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
});
