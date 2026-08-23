import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionInApp,
  findFinanceSession,
  setupNewSessionButton,
  setupWorkspaceSwitcher,
} from "./workspace-actions.js";

function installTauriInvoke(invoke) {
  globalThis.__TAURI__ = { core: { invoke } };
}

describe("workspace actions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    delete globalThis.__TAURI__;
    vi.restoreAllMocks();
  });

  it("starts a new session from Command+N", async () => {
    document.body.innerHTML = '<button id="new-session-btn">New Session</button>';
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauriInvoke(invoke);
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { path: "/tmp/picot" } }),
    };

    setupNewSessionButton({ data, workspaceId: "workspace-a" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    expect(data.workspaceInfo).toHaveBeenCalledWith("workspace-a");
    expect(invoke).toHaveBeenCalledWith("open_new_session_in_workspace", {
      projectPath: "/tmp/picot",
      sceneId: "programming",
    });
  });

  it("uses host API to create session when Tauri is unavailable", async () => {
    document.body.innerHTML = '<button id="new-session-btn">New Session</button>';
    // No Tauri installed — LAN/remote client
    delete globalThis.__TAURI__;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspaceId: "workspace-a",
          sessionId: "temporary-abc123",
          instanceId: "instance-xyz",
        }),
    });
    globalThis.fetch = fetchMock;

    const originalLocation = globalThis.window?.location;
    Object.defineProperty(globalThis, "location", {
      value: { href: "" },
      writable: true,
      configurable: true,
    });

    setupNewSessionButton({ data: {}, workspaceId: "workspace-a" });
    document.getElementById("new-session-btn").click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/v2/new-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "workspace-a", sceneId: "programming" }),
    });
    await vi.waitFor(() =>
      expect(globalThis.location.href).toBe(
        "/app/workspaces/workspace-a/sessions/temporary-abc123",
      ),
    );

    if (originalLocation !== undefined) {
      Object.defineProperty(globalThis, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
    delete globalThis.fetch;
  });

  it("does not hijack Command+N while typing", async () => {
    document.body.innerHTML = `
      <button id="new-session-btn">New Session</button>
      <textarea id="composer"></textarea>
    `;
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauriInvoke(invoke);
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { path: "/tmp/picot" } }),
    };

    setupNewSessionButton({ data, workspaceId: "workspace-a" });
    document
      .getElementById("composer")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }));

    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("finds the finance session a user should be taken back to", () => {
    const sessions = [
      { id: "current", target: { sceneId: "programming" }, isCurrentWorkspace: true },
      { id: "finance-1", target: { sceneId: "finance" }, isCurrentWorkspace: true },
      { id: "finance-other", target: { sceneId: "finance" }, isCurrentWorkspace: false },
    ];
    expect(findFinanceSession(sessions, "current")?.id).toBe("finance-1");
    expect(findFinanceSession(sessions, "finance-1")).toBeNull();
    expect(findFinanceSession([], "current")).toBeNull();
    expect(
      findFinanceSession(
        [{ id: "other", target: { sceneId: "finance" }, isCurrentWorkspace: false }],
        "current",
      ),
    ).toBeNull();
    expect(
      findFinanceSession(
        [
          {
            id: "finance-old",
            target: { sceneId: "finance" },
            isCurrentWorkspace: true,
            modifiedAtMs: 1000,
          },
          {
            id: "finance-new",
            target: { sceneId: "finance" },
            isCurrentWorkspace: true,
            modifiedAtMs: 2000,
          },
        ],
        "current",
      )?.id,
    ).toBe("finance-new");
  });

  it("opens a new session in a requested plugin", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    installTauriInvoke(invoke);
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { path: "/tmp/picot" } }),
    };

    await createSessionInApp({
      data,
      workspaceId: "workspace-a",
      sceneId: "finance",
      pluginId: "com.zicode.finance",
    });

    expect(invoke).toHaveBeenCalledWith("open_new_session_in_workspace", {
      projectPath: "/tmp/picot",
      sceneId: "finance",
      pluginId: "com.zicode.finance",
    });
  });

  it("switches the window to another workspace while keeping the active app", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    document.body.dataset.activePlugin = "com.zicode.notes";
    const invoke = vi.fn().mockImplementation((command) => {
      if (command === "list_workspaces") {
        return Promise.resolve([
          { id: "ws-1", path: "/home/user/work" },
          { id: "ws-global", path: "/home/user/.zicode" },
        ]);
      }
      return Promise.resolve(undefined);
    });
    installTauriInvoke(invoke);

    setupWorkspaceSwitcher({ onError: vi.fn() });
    document.getElementById("workspace-switcher-btn").click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".workspace-switcher-item").length).toBe(3),
    );

    const items = [...document.querySelectorAll(".workspace-switcher-item")];
    expect(items[0].textContent).toContain(".zicode");
    items[1].click();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("switch_window_workspace", {
        projectPath: "/home/user/work",
        pluginId: "com.zicode.notes",
      }),
    );
  });

  it("deletes a non-protected workspace to the recycle bin after confirmation", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    const invoke = vi.fn((command) => {
      if (command === "list_workspaces") {
        return Promise.resolve([
          { id: "ws-global", path: "/home/user/.zicode" },
          { id: "ws-1", path: "/home/user/work" },
          { id: "ws-2", path: "/home/user/other" },
        ]);
      }
      if (command === "delete_workspace") {
        return Promise.resolve("/tmp/zicode-trash/work-123");
      }
      return Promise.resolve(undefined);
    });
    installTauriInvoke(invoke);
    const notify = vi.fn();
    const openPath = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    setupWorkspaceSwitcher({ onError: vi.fn(), notify, openPath });
    document.getElementById("workspace-switcher-btn").click();

    await vi.waitFor(() =>
      expect(document.querySelectorAll(".workspace-switcher-delete").length).toBe(2),
    );
    const deletes = [...document.querySelectorAll(".workspace-switcher-delete")];
    deletes[0].click();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_workspace", {
        workspaceId: "ws-1",
      }),
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0][0]).toMatch(
      /kept for 30 days|保留 30 天/,
    );
    expect(confirmSpy.mock.calls[0][0]).toMatch(
      /never deleted|不会被删除/,
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Project moved to trash|项目已移入回收站/),
        action: expect.objectContaining({
          label: expect.stringMatching(/Open trash folder|打开回收站目录/),
        }),
      }),
    );
    const notification = notify.mock.calls[0][0];
    notification.action.run();
    expect(openPath).toHaveBeenCalledWith("/tmp/zicode-trash/work-123");
    confirmSpy.mockRestore();
  });

  it("lists the recycle bin and restores a deleted workspace", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    const nowSecs = Math.floor(Date.now() / 1000);
    const invoke = vi.fn((command) => {
      if (command === "list_workspaces") {
        return Promise.resolve([{ id: "ws-global", path: "/home/user/.zicode" }]);
      }
      if (command === "list_workspace_trash") {
        return Promise.resolve([
          {
            dir: "/tmp/zicode-trash/work-123",
            name: "work-123",
            original_root: "/home/user/work",
            deleted_at: nowSecs - 86400,
          },
        ]);
      }
      if (command === "restore_workspace") {
        return Promise.resolve("ws-1");
      }
      return Promise.resolve(undefined);
    });
    installTauriInvoke(invoke);
    const notify = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    setupWorkspaceSwitcher({ onError: vi.fn(), notify });
    document.getElementById("workspace-switcher-btn").click();

    await vi.waitFor(() =>
      expect(document.querySelector(".workspace-switcher-trash-heading")).toBeTruthy(),
    );
    expect(document.querySelector(".workspace-switcher-trash-heading")?.textContent).toMatch(
      /Kept for 30 days|保留 30 天/,
    );
    expect(
      document.querySelector(".workspace-switcher-trash-expiry")?.textContent,
    ).toMatch(/Auto-purges in 29 days|29 天后自动清除/);
    const restore = document.querySelector(".workspace-switcher-restore");
    expect(restore?.getAttribute("aria-label")).toContain("work-123");
    restore.click();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("restore_workspace", {
        trashDir: "/tmp/zicode-trash/work-123",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Project restored|项目已恢复/),
      }),
    );
    confirmSpy.mockRestore();
  });

  it("permanently deletes a recycle bin entry after confirmation", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    const nowSecs = Math.floor(Date.now() / 1000);
    const invoke = vi.fn((command) => {
      if (command === "list_workspaces") {
        return Promise.resolve([{ id: "ws-global", path: "/home/user/.zicode" }]);
      }
      if (command === "list_workspace_trash") {
        return Promise.resolve([
          {
            dir: "/tmp/zicode-trash/work-123",
            name: "work-123",
            original_root: "/home/user/work",
            deleted_at: nowSecs - 86400,
          },
        ]);
      }
      if (command === "delete_workspace_trash_entry") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
    installTauriInvoke(invoke);
    const notify = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    setupWorkspaceSwitcher({ onError: vi.fn(), notify });
    document.getElementById("workspace-switcher-btn").click();

    await vi.waitFor(() =>
      expect(document.querySelector(".workspace-switcher-trash-delete")).toBeTruthy(),
    );
    const deleteEntry = document.querySelector(".workspace-switcher-trash-delete");
    expect(deleteEntry?.getAttribute("aria-label")).toContain("work-123");
    deleteEntry.click();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_workspace_trash_entry", {
        trashDir: "/tmp/zicode-trash/work-123",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Trash entry permanently deleted|回收站条目已彻底删除/),
      }),
    );
    confirmSpy.mockRestore();
  });

  it("empties the recycle bin after confirmation", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    const invoke = vi.fn((command) => {
      if (command === "list_workspaces") {
        return Promise.resolve([{ id: "ws-global", path: "/home/user/.zicode" }]);
      }
      if (command === "list_workspace_trash") {
        return Promise.resolve([
          {
            dir: "/tmp/zicode-trash/work-123",
            name: "work-123",
            original_root: "/home/user/work",
            deleted_at: 123,
          },
          {
            dir: "/tmp/zicode-trash/work-456",
            name: "work-456",
            original_root: "/home/user/work2",
            deleted_at: 456,
          },
        ]);
      }
      if (command === "empty_workspace_trash") {
        return Promise.resolve(2);
      }
      return Promise.resolve(undefined);
    });
    installTauriInvoke(invoke);
    const notify = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    setupWorkspaceSwitcher({ onError: vi.fn(), notify });
    document.getElementById("workspace-switcher-btn").click();

    await vi.waitFor(() =>
      expect(document.querySelector(".workspace-switcher-empty-trash")).toBeTruthy(),
    );
    expect(
      document.querySelector(".workspace-switcher-trash-heading")?.textContent,
    ).toMatch(/Kept for 30 days|保留 30 天/);
    document.querySelector(".workspace-switcher-empty-trash").click();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("empty_workspace_trash"),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Recycle bin emptied|回收站已清空/),
      }),
    );
    confirmSpy.mockRestore();
  });

  it("keeps the workspace name as a passive label instead of an open-folder button", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    document.body.dataset.activePlugin = "core.chat";
    const invoke = vi.fn().mockResolvedValue([
      { id: "ws-global", path: "/home/user/.zicode" },
    ]);
    installTauriInvoke(invoke);

    setupWorkspaceSwitcher({ onError: vi.fn() });

    expect(document.getElementById("workspace-bar-project")).toBeNull();
    expect(document.getElementById("workspace-bar-label")).not.toBeNull();
    expect(document.getElementById("workspace-bar-label").tagName).toBe("DIV");
  });

  it("keeps the workspace label visible on clients without Tauri invoke", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    const workspaceBar = setupWorkspaceSwitcher({
      onError: vi.fn(),
      resolveWorkspacePath: (workspaceId) =>
        workspaceId === "ws-remote" ? "/home/user/agent-inbox" : null,
    });

    // The switcher button needs Tauri; the passive label must stay visible
    // and resolve the current workspace from the caller-provided path.
    expect(document.getElementById("workspace-switcher-btn").style.display).toBe("none");
    expect(document.getElementById("workspace-bar-label").style.display).not.toBe("none");

    window.history.replaceState(
      {},
      "",
      "/app/workspaces/ws-remote/sessions/s-1",
    );
    await workspaceBar.refreshWorkspaceLabel();
    expect(document.getElementById("workspace-bar-name").textContent).toBe("agent-inbox");
    expect(document.getElementById("workspace-bar-path").textContent).toBe(
      "/home/user/agent-inbox",
    );
    expect(document.getElementById("workspace-bar-label").title).toBe(
      "/home/user/agent-inbox",
    );
  });

  it("opens the native folder picker from the switcher menu", async () => {
    document.body.innerHTML = `
      <div class="workspace-bar" id="workspace-bar">
        <div id="workspace-bar-label">
          <strong id="workspace-bar-name"></strong>
          <span id="workspace-bar-path"></span>
        </div>
        <button id="workspace-switcher-btn"></button>
        <div class="workspace-switcher-menu hidden" id="workspace-switcher-menu"></div>
      </div>
    `;
    document.body.dataset.activePlugin = "com.zicode.tasks";
    const invoke = vi.fn().mockImplementation((command) => {
      if (command === "list_workspaces") {
        return Promise.resolve([{ id: "ws-1", path: "/home/user/work" }]);
      }
      return Promise.resolve(undefined);
    });
    installTauriInvoke(invoke);

    setupWorkspaceSwitcher({ onError: vi.fn() });
    document.getElementById("workspace-switcher-btn").click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".workspace-switcher-item").length).toBe(2),
    );

    const openFolder = document.querySelector(".workspace-switcher-open-folder");
    expect(openFolder).not.toBeNull();
    expect(openFolder.textContent).toBe("将文件夹作为工作区打开");
    openFolder.click();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_folder_as_workspace", {
        pluginId: "com.zicode.tasks",
      }),
    );
  });
});
