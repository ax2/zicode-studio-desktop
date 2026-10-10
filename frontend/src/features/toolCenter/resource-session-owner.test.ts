import { expect, it, vi } from "vitest";
import { ResourceSessionOwner } from "./resource-session-owner";

it("keeps the same controller and DOM when fallback commits before detail cleanup", async () => {
  const busy = vi.fn(), destroy = vi.fn(), create = vi.fn(() => ({ destroy }));
  const owner = new ResourceSessionOwner(busy);
  const view = document.createElement("div"), fallback = document.createElement("div");
  const element = owner.mount(view, create); element.textContent = "result retained"; owner.reportBusy(true);
  owner.showFallback(fallback); owner.release(element); await Promise.resolve();
  expect(fallback.firstChild).toBe(element); expect(element.textContent).toBe("result retained");
  expect(create).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(true);
  owner.destroy(); expect(destroy).toHaveBeenCalledTimes(1); expect(fallback.children.length).toBe(0);
});

it("destroys a normally detached detail instead of retaining unused resource access", async () => {
  const destroy = vi.fn(), owner = new ResourceSessionOwner(vi.fn());
  const element = owner.mount(document.createElement("div"), () => ({ destroy }));
  owner.release(element); await Promise.resolve(); expect(destroy).toHaveBeenCalledTimes(1);
});

it("does not let an old deferred release destroy a replacement controller", async () => {
  const oldDestroy = vi.fn(), nextDestroy = vi.fn(), owner = new ResourceSessionOwner(vi.fn());
  const view = document.createElement("div");
  const old = owner.mount(view, () => ({ destroy: oldDestroy })); owner.release(old);
  const next = owner.mount(view, () => ({ destroy: nextDestroy })); await Promise.resolve();
  expect(oldDestroy).toHaveBeenCalledTimes(1); expect(nextDestroy).not.toHaveBeenCalled(); expect(view.firstChild).toBe(next);
  owner.destroy(); expect(nextDestroy).toHaveBeenCalledTimes(1);
});

it("removes a failed mount and permits a clean later mount", () => {
  const owner = new ResourceSessionOwner(vi.fn()), view = document.createElement("div");
  expect(() => owner.mount(view, () => { throw new Error("failed"); })).toThrow("failed");
  expect(view.children.length).toBe(0);
  const destroy = vi.fn(); owner.mount(view, () => ({ destroy })); owner.destroy(); owner.destroy();
  expect(destroy).toHaveBeenCalledTimes(1);
});
