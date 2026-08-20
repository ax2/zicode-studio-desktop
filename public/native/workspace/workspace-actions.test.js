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
