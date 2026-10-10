import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWatchApp, WatchMain } from "./WatchApp";
import { createWatchStore, type WatchGateway } from "./watchStore";

function stubGateway(overrides: Partial<WatchGateway> = {}): WatchGateway {
  return {
    list: vi.fn(async () => ({ items: [] })),
    add: vi.fn(async () => ({
      item: {
        id: "w1",
        name: "Example",
        url: "https://example.com/",
        changeCount: 0,
        createdAt: "",
      },
    })),
    update: vi.fn(async () => ({
      item: {
        id: "w1",
        name: "Example",
        url: "https://example.com/",
        changeCount: 0,
        createdAt: "",
      },
    })),
    check: vi.fn(async () => ({
      id: "w1",
      changed: true,
      hash: "abc",
      contentLength: 10,
      checkedAt: "x",
    })),
    remove: vi.fn(async () => ({ removed: true })),
    ...overrides,
  };
}

it("keeps inactive scope changes local and loads when the app is opened", async () => {
  const gateway = stubGateway();
  const app = createWatchApp({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "isolated" }),
    notify: vi.fn(),
  });
  await app.setTarget();
  expect(gateway.list).not.toHaveBeenCalled();
  const container = document.createElement("div");
  document.body.append(container);
  act(() => app.renderContent(container));
  await waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(1));
  await act(async () => {
    app.deactivate();
    await app.setTarget();
  });
  expect(gateway.list).toHaveBeenCalledTimes(1);
  act(() => app.destroy());
});

it("rejects a late list response after a scope reset", async () => {
  let complete: (value: Awaited<ReturnType<WatchGateway["list"]>>) => void = () => {};
  const gateway = stubGateway({
    list: vi.fn(
      () =>
        new Promise<Awaited<ReturnType<WatchGateway["list"]>>>((resolve) => {
          complete = resolve;
        }),
    ),
  });
  const store = createWatchStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "isolated" }),
    notify: vi.fn(),
  });
  const pending = store.getState().load();
  store.getState().resetScope();
  complete({
    items: [
      {
        id: "old",
        name: "Old workspace",
        url: "https://example.com/",
        changeCount: 0,
        createdAt: "",
      },
    ],
  });
  await pending;
  expect(store.getState().busy).toBe(false);
  expect(store.getState().items).toEqual([]);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("watch composer", () => {
  it("adds a watcher when the composer form is submitted", async () => {
    const gateway = stubGateway();
    const store = createWatchStore({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const { container } = render(<WatchMain store={store} />);
    await waitFor(() => expect(store.getState().busy).toBe(false));

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    const nameInput = container.querySelector(".watch-name-input") as HTMLInputElement;
    setter?.call(nameInput, "Example");
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    const urlInput = container.querySelector(".watch-url-input") as HTMLInputElement;
    setter?.call(urlInput, "https://example.com/");
    urlInput.dispatchEvent(new Event("input", { bubbles: true }));

    const form = container.querySelector(".watch-composer-row") as HTMLFormElement;
    form.requestSubmit();

    await waitFor(() => expect(gateway.add).toHaveBeenCalled());
  });
});
