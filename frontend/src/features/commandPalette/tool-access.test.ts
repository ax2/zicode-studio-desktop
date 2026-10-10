import { expect, it, vi } from "vitest";
import { accessCommands, emptyAccess, runWithRecent } from "./tool-access";

it("uses stable identities, preserves favorite order and follows recent order", () => {
  const commands = [{ id: "a", label: "Same" }, { id: "b", label: "Same" }];
  const access = { ...emptyAccess(), favorites: ["removed", "b", "a"], recent: [{ id: "a", usedAt: 2 }, { id: "b", usedAt: 1 }] };
  expect(accessCommands(commands, access, "favorites").map(command => command.id)).toEqual(["b", "a"]);
  expect(access.favorites).toEqual(["removed", "b", "a"]);
  expect(accessCommands(commands, access, "recent").map(command => command.id)).toEqual(["a", "b"]);
});

it("records only successful completed actions in their captured scope", async () => {
  const store = { read: vi.fn(), mutate: vi.fn().mockResolvedValue(emptyAccess()) };
  const scope = { sceneId: "programming", workspaceId: "first" };
  await runWithRecent({ id: "a", action: () => false }, store, scope);
  await runWithRecent({ id: "a", disabled: true, action: vi.fn() }, store, scope);
  await runWithRecent({ id: "a" }, store, scope);
  await expect(runWithRecent({ id: "a", action: () => Promise.reject(new Error("cancel")) }, store, scope)).rejects.toThrow("cancel");
  expect(store.mutate).not.toHaveBeenCalled();
  let complete: () => void = () => {};
  const pending = runWithRecent({ id: "b", action: () => new Promise<void>(resolve => { complete = resolve; }) }, store, scope);
  expect(store.mutate).not.toHaveBeenCalled();
  complete();
  await pending;
  expect(store.mutate).toHaveBeenCalledWith(scope, { kind: "recentRecord", id: "b" });
});

it("distinguishes successful tool execution from a history storage failure", async () => {
  const action = vi.fn().mockResolvedValue(true);
  const store = { read: vi.fn(), mutate: vi.fn().mockRejectedValue(new Error("busy")) };
  await expect(runWithRecent({ id: "a", action }, store, { sceneId: "s", workspaceId: "w" })).rejects.toThrow("Command completed, but recent history could not be saved.");
  expect(action).toHaveBeenCalledTimes(1);
});
