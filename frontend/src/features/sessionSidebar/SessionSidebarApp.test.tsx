import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import {
  SessionSidebarApp,
  type SessionSidebarController,
} from "./SessionSidebarApp";
import type { SessionSummary } from "./sessionSidebarLogic";
import { createSidebarStore } from "./sessionSidebarStore";

function makeController(
  overrides: Partial<SessionSidebarController> = {},
): SessionSidebarController {
  return {
    isSidebarItemVisible: () => true,
    selectSession: vi.fn(),
    toggleFavourite: vi.fn(),
    toggleArchived: vi.fn(),
    requestDeleteAllArchived: vi.fn(),
    cancelDeleteAll: vi.fn(),
    confirmDeleteAll: vi.fn(),
    startRename: vi.fn(),
    commitRename: vi.fn(),
    cancelRename: vi.fn(),
    toggleArchivedCollapsed: vi.fn(),
    toggleProjectCollapsed: vi.fn(),
    showMore: vi.fn(),
    showLess: vi.fn(),
    showContextMenu: vi.fn(),
    showSessionMenuFromButton: vi.fn(),
    showProjectContextMenu: vi.fn(),
    showProjectMenuFromButton: vi.fn(),
    closeContextMenu: vi.fn(),
    retryLoad: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("session sidebar delete-all confirmation", () => {
  it("focuses the cancel action and cancels on Escape", async () => {
    const store = createSidebarStore({ activeSessionId: null });
    const cancelDeleteAll = vi.fn();
    const controller = makeController({ cancelDeleteAll });
    const container = document.createElement("div");
    document.body.append(container);
    const session: SessionSummary = {
      id: "s1",
      name: "Test session",
      projectPath: "/ws",
      isCurrentWorkspace: true,
    };
    store.setState({
      sessions: [session],
      phase: "ready",
      confirmDeleteCount: 2,
    });

    render(
      <SessionSidebarApp
        controller={controller}
        store={store}
        container={container}
      />,
    );

    await waitFor(() =>
      expect(document.activeElement?.matches(".sidebar-confirm-no")).toBe(true),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(cancelDeleteAll).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus within the confirmation dialog", async () => {
    const store = createSidebarStore({ activeSessionId: null });
    const controller = makeController();
    const container = document.createElement("div");
    document.body.append(container);
    const session: SessionSummary = {
      id: "s1",
      name: "Test session",
      projectPath: "/ws",
      isCurrentWorkspace: true,
    };
    store.setState({
      sessions: [session],
      phase: "ready",
      confirmDeleteCount: 2,
    });

    render(
      <SessionSidebarApp
        controller={controller}
        store={store}
        container={container}
      />,
    );

    await waitFor(() =>
      expect(document.activeElement?.matches(".sidebar-confirm-no")).toBe(true),
    );

    const deleteButton = document.querySelector(
      ".sidebar-confirm-yes",
    ) as HTMLButtonElement;
    deleteButton.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement?.matches(".sidebar-confirm-no")).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement?.matches(".sidebar-confirm-yes")).toBe(true);
  });
});
