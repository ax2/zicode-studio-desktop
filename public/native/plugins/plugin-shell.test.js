import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { BuiltinPluginRegistry } from "./plugin-registry.js";
import { setupPluginShell } from "./plugin-shell.js";

function renderShell() {
  document.body.innerHTML = `
    <div class="app-layout">
      <div id="sidebar" class="sidebar">
        <div class="sidebar-header">Chat header</div>
        <div id="session-list">Sessions</div>
        <div class="sidebar-footer">Chat footer</div>
      </div>
      <div class="main">
        <div class="header"><div class="header-left"></div><div class="header-right"><button id="file-sidebar-toggle"></button></div></div>
        <aside id="finance-workbench" class="hidden">Finance panel</aside>
        <div id="messages">Messages</div>
        <div class="input-area">Composer</div>
      </div>
      <div id="super-agent-runtime"></div>
      <div id="file-sidebar"></div>
    </div>
  `;
}

function registry() {
  return new BuiltinPluginRegistry({
    storage: { getItem: () => null, setItem: () => {} },
  });
}

const originalMatchMedia = globalThis.matchMedia;

it("opens a scoped concrete tool without remounting its existing draft or executing", async () => {
  const target = {sceneId:"programming",workspaceId:"fixture"};
  const gateway = {
    searchTools: vi.fn(async()=>({items:[],total:0,revision:"rev",nextOffset:null})),
    loadTool: vi.fn(async(_scene, selected)=>({pluginId:"fixture",version:"0.1.0",revision:selected.revision,enabled:true,capability:{id:selected.capabilityId,inputSchema:{type:"object",properties:{text:{type:"string"}}}},permissions:[]})),
    invoke: vi.fn(),
  };
  const shell = setupPluginShell({registry:registry(),getTarget:()=>target,capabilityGateway:gateway});
  const tool = {toolId:"tool-1",accessId:"manual.tool:1",pluginId:"fixture",capabilityId:"text",title:"Fixture text",applicationName:"Fixture",publisher:"Studio",version:"0.1.0",enabled:true,runtime:"wasi"};
  await shell.openManualTool(tool,"rev",target);
  await vi.waitFor(()=>expect(document.querySelector("textarea")).toBeTruthy());
  const input = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"retained shell draft");
  input.dispatchEvent(new Event("input",{bubbles:true}));
  await shell.openManualTool(tool,"rev",target);
  await vi.waitFor(()=>expect(document.querySelector("textarea").value).toBe("retained shell draft"));
  expect(gateway.loadTool).toHaveBeenCalledTimes(1); expect(gateway.invoke).not.toHaveBeenCalled();
  await shell.activate("com.zicode.notes");
  await shell.openManualTool(tool,"rev",target);
  await vi.waitFor(()=>expect(document.querySelector("textarea").value).toBe("retained shell draft"));
  expect(gateway.loadTool).toHaveBeenCalledTimes(1);
  await expect(shell.openManualTool(tool,"rev",{...target,workspaceId:"other"})).rejects.toThrow();
  shell.destroy();
});

beforeEach(() => {
  setLocale("en");
  sessionStorage.clear();
  history.replaceState(null, "", "/app/workspaces/workspace-a/sessions/session-a");
  renderShell();
});

afterEach(() => {
  globalThis.matchMedia = originalMatchMedia;
});

describe("setupPluginShell", () => {
  it("renders application activities while preserving Chat as the default surface", async () => {
    const shell = setupPluginShell({ registry: registry() });

    expect(shell.getActivePluginId()).toBe("core.chat");
    expect(document.body.dataset.activePlugin).toBe("core.chat");
    expect(document.getElementById("messages").classList.contains("hidden")).toBe(false);
    expect(document.querySelector('[data-plugin-id="com.zicode.notes"]')).not.toBeNull();
    expect(
      document.querySelector(".plugin-main-view").classList.contains("plugin-surface-hidden"),
    ).toBe(true);
    expect(document.getElementById("finance-workbench").classList.contains("hidden")).toBe(true);
    expect(document.querySelector(".plugin-activity-bar")?.tagName).toBe("NAV");
    expect(document.querySelector("[data-plugin-activities]")?.getAttribute("role")).toBeNull();
    for (const button of document.querySelectorAll("[data-plugin-id]")) {
      expect(button.getAttribute("role")).toBeNull();
      expect(button.getAttribute("aria-selected")).toBeNull();
    }
    expect(document.querySelector('[data-plugin-id="core.chat"]')?.getAttribute("aria-current"))
      .toBe("page");
    expect(
      document.querySelector('[data-plugin-id="core.chat"]')?.classList.contains("active"),
    ).toBe(true);
    expect(
      document.querySelector('[data-plugin-id="com.zicode.notes"]')?.getAttribute("aria-current"),
    ).toBeNull();
  });

  it("reopens the active application after an in-place workspace switch (?app=)", async () => {
    history.replaceState(
      null,
      "",
      "/app/workspaces/workspace-b/sessions/session-b?app=com.zicode.notes",
    );
    const shell = setupPluginShell({ registry: registry() });

    await vi.waitFor(() =>
      expect(shell.getActivePluginId()).toBe("com.zicode.notes"),
    );
    expect(document.body.dataset.activePlugin).toBe("com.zicode.notes");
  });

  it("falls back to Chat when the ?app= plugin is unknown or disabled", async () => {
    history.replaceState(
      null,
      "",
      "/app/workspaces/workspace-b/sessions/session-b?app=com.zicode.does-not-exist",
    );
    const shell = setupPluginShell({ registry: registry() });
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("core.chat"));
  });

  it("explains why a disabled plugin deep link fell back to Chat", async () => {
    history.replaceState(
        null,
        "",
        "/app/workspaces/workspace-b/sessions/session-b?app=com.zicode.graph",
      );
    const notify = vi.fn();
    const shell = setupPluginShell({ registry: registry(), notify });

    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("core.chat"));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        title: "Plugin not enabled",
      }),
      );
      const message = notify.mock.calls[0][0].message;
      expect(message).toContain("Graph");
      expect(message).toContain("Plugin Manager");
  });

  it("waits for host hydration before resolving the initial deep link", async () => {
    const hostGateway = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        sceneId: "programming",
        plugins: [
          {
            schemaVersion: 1,
            id: "core.chat",
            name: "Chat",
            description: "Chat",
            version: "1.0.0",
            publisher: "zicode",
            core: true,
            enabled: true,
            origin: "builtIn",
            contributes: {},
            permissions: { required: [], optional: [] },
            permissionGrants: {},
          },
          {
            schemaVersion: 1,
            id: "com.zicode.tasks",
            name: "Tasks",
            description: "Task center",
            version: "0.1.0",
            publisher: "zicode",
            core: false,
            enabled: true,
            origin: "builtIn",
            contributes: {
              activities: [{ id: "tasks", title: "Tasks", order: 75 }],
              views: [],
              commands: [],
            },
            permissions: { required: [], optional: [] },
            permissionGrants: {},
          },
        ],
        diagnostics: [],
      }),
      setEnabled: vi.fn(),
    };
    const testRegistry = new BuiltinPluginRegistry({
      storage: { getItem: () => null, setItem: () => {} },
      hostGateway,
    });
    history.replaceState(
      null,
      "",
      "/app/workspaces/workspace-b/sessions/session-b?app=com.zicode.tasks",
    );
    const shell = setupPluginShell({ registry: testRegistry });
    // The deep link must resolve after the host reports Tasks enabled even
    // though the local catalog default is disabled.
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("com.zicode.tasks"));
    expect(hostGateway.list).toHaveBeenCalledWith("programming");
  });

  it("does not resolve the deep link early when setTarget repeats during hydration", async () => {
    let resolveList;
    const hostGateway = {
      list: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveList = resolve;
        }),
      ),
      setEnabled: vi.fn(),
    };
    const testRegistry = new BuiltinPluginRegistry({
      storage: { getItem: () => null, setItem: () => {} },
      hostGateway,
    });
    history.replaceState(
      null,
      "",
      "/app/workspaces/workspace-b/sessions/session-b?app=com.zicode.tasks",
    );
    const shell = setupPluginShell({ registry: testRegistry });
    // The app bootstrap calls setTarget again with the same target while the
    // initial host hydration is still pending. The deep link must not be
    // resolved against catalog defaults (Tasks disabled) in that window.
    shell.setTarget({ sceneId: "programming", workspaceId: "w", sessionId: "s" });
    expect(shell.getActivePluginId()).toBe("core.chat");
    resolveList({
      schemaVersion: 1,
      sceneId: "programming",
      plugins: [
        {
          schemaVersion: 1,
          id: "core.chat",
          name: "Chat",
          description: "Chat",
          version: "1.0.0",
          publisher: "zicode",
          core: true,
          enabled: true,
          origin: "builtIn",
          contributes: {},
          permissions: { required: [], optional: [] },
          permissionGrants: {},
        },
        {
          schemaVersion: 1,
          id: "com.zicode.tasks",
          name: "Tasks",
          description: "Task center",
          version: "0.1.0",
          publisher: "zicode",
          core: false,
          enabled: true,
          origin: "builtIn",
          contributes: {
            activities: [{ id: "tasks", title: "Tasks", order: 75 }],
            views: [],
            commands: [],
          },
          permissions: { required: [], optional: [] },
          permissionGrants: {},
        },
      ],
      diagnostics: [],
    });
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("com.zicode.tasks"));
  });

  it("switches to an exclusive plugin main view and makes Chat inert", async () => {
    const shell = setupPluginShell({ registry: registry() });

    await shell.activate("com.zicode.notes", { focus: false });

    expect(shell.getActivePluginId()).toBe("com.zicode.notes");
    expect(
      document.querySelector('[data-plugin-id="com.zicode.notes"]')?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      document.querySelector('[data-plugin-id="com.zicode.notes"]')?.classList.contains("active"),
    ).toBe(true);
    expect(
      document.querySelector('[data-plugin-id="core.chat"]')?.classList.contains("active"),
    ).toBe(false);
    expect(
      document.querySelector('[data-plugin-id="core.chat"]')?.getAttribute("aria-current"),
    ).toBeNull();
    expect(document.getElementById("messages").classList.contains("plugin-surface-hidden")).toBe(
      true,
    );
    expect(document.getElementById("messages").hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".plugin-main-view").textContent).toContain("Local-first");
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain("Notebooks");
    expect(document.querySelector(".plugin-toolbar")).toBeNull();
    expect(shell.getCommandPaletteEntries().map((command) => command.label)).toContain(
      "Notes: Capture URL",
    );
  });

  it("keeps the Files activity button Chat-only so other apps stay put", async () => {
    const shell = setupPluginShell({ registry: registry() });

    await shell.activate("com.zicode.notes", { focus: false });
    expect(shell.getActivePluginId()).toBe("com.zicode.notes");
    expect(document.querySelector('[data-plugin-id="core.files"]')).toBeNull();

    await shell.activate("core.chat", { focus: false });
    expect(document.querySelector('[data-plugin-id="core.files"]')).not.toBeNull();
  });

  it("renders string sidebar view items with readable labels", async () => {
    const shell = setupPluginShell({ registry: registry() });
    await shell.activate("com.zicode.notes", { focus: false });

    const buttons = [
      ...document.querySelectorAll(".plugin-sidebar-surface .plugin-sidebar-items button"),
    ];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows background activity on Chat and clears it when Chat is reopened", async () => {
    const shell = setupPluginShell({ registry: registry() });
    await shell.activate("com.zicode.notes", { focus: false });
    shell.setActivityBadge("core.chat", { count: 2, tone: "warning" });
    expect(document.querySelector('[data-plugin-id="core.chat"] .plugin-activity-badge').textContent).toBe("2");
    await shell.activate("core.chat", { focus: false });
    expect(document.querySelector('[data-plugin-id="core.chat"] .plugin-activity-badge')).toBeNull();
  });

  it("requests the mobile function area when an application is selected", async () => {
    const requested = vi.fn();
    document.addEventListener("zicode:function-area-request", requested, { once: true });
    setupPluginShell({ registry: registry() });

    document.querySelector('[data-plugin-id="com.zicode.notes"]').click();

    await vi.waitFor(() => expect(requested).toHaveBeenCalled());
    expect(requested).toHaveBeenCalledOnce();
    expect(requested.mock.calls[0][0].detail).toEqual({ open: true });
  });

  it("restores the previous application when browser Back reveals its history state", async () => {
    const shell = setupPluginShell({ registry: registry() });
    document.querySelector('[data-plugin-id="com.zicode.notes"]').click();
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("com.zicode.notes"));
    expect(shell.getActivePluginId()).toBe("com.zicode.notes");
    expect(history.state?.zicodePluginId).toBe("com.zicode.notes");

    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { zicodePluginId: "core.chat" } }),
    );
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("core.chat"));
    expect(shell.getActivePluginId()).toBe("core.chat");
  });

  it("keeps primary mobile destinations visible and moves secondary activities into More", async () => {
    const testRegistry = registry();
    const shell = setupPluginShell({ registry: testRegistry });
    const historyBack = vi.spyOn(history, "back");
    const more = document.querySelector("[data-mobile-activity-more]");
    const menu = document.querySelector("[data-mobile-activity-menu]");
    const menuLabels = [...menu.querySelectorAll("[data-mobile-plugin-id] span")].map(
      (item) => item.textContent,
    );

    expect(document.querySelector('[data-plugin-id="core.chat"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-id="com.zicode.projects"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-id="com.zicode.notes"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-id="core.files"]')).not.toBeNull();
    expect(menuLabels).toEqual(
      expect.arrayContaining([
        "Tasks",
        "Automation",
        "Notes",
        "Commands",
        "Settings",
        "Help",
      ]),
    );
    expect(menuLabels).not.toEqual(expect.arrayContaining(["Chat", "Projects", "Tools", "Finance", "Artifacts"]));

    more.click();
    expect(menu.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const tasks = menu.querySelector('[data-mobile-plugin-id="com.zicode.tasks"]');
    tasks.click();
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("com.zicode.tasks"));
    expect(shell.getActivePluginId()).toBe("com.zicode.tasks");
    expect(historyBack).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(menu.hidden).toBe(true));
    expect(more.classList.contains("active")).toBe(true);
    expect(more.getAttribute("aria-current")).toBe("page");
    expect(more.getAttribute("aria-label")).toBe("More: Tasks");
    expect(
      menu
        .querySelector('[data-mobile-plugin-id="com.zicode.tasks"]')
        .classList.contains("active"),
    ).toBe(true);
    expect(
      menu
        .querySelector('[data-mobile-plugin-id="com.zicode.tasks"]')
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      menu
        .querySelector('[data-mobile-plugin-id="core.settings"]')
        .hasAttribute("aria-current"),
    ).toBe(false);

    document.querySelector('[data-plugin-id="core.chat"]').click();
    await vi.waitFor(() => expect(more.hasAttribute("aria-current")).toBe(false));
    expect(more.hasAttribute("aria-current")).toBe(false);
    expect(more.getAttribute("aria-label")).toBe("More");
    historyBack.mockRestore();
  });

  it("traps focus inside the mobile More panel and restores it on Escape", async () => {
    setupPluginShell({ registry: registry() });
    const more = document.querySelector("[data-mobile-activity-more]");
    const menu = document.querySelector("[data-mobile-activity-menu]");
    more.click();
    const controls = [...menu.querySelectorAll("button:not([disabled])")];
    const first = controls[0];
    const last = controls.at(-1);

    last.focus();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.focus();
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(last);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(more);
  });

  it("closes the mobile More panel before browser Back leaves the current application", async () => {
    setupPluginShell({ registry: registry() });
    const more = document.querySelector("[data-mobile-activity-more]");
    const menu = document.querySelector("[data-mobile-activity-menu]");
    more.click();
    expect(menu.hidden).toBe(false);
    expect(history.state?.zicodeMobileLayer).toBe("application-menu");

    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { zicodePluginId: "core.chat" } }),
    );
    expect(menu.hidden).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes More when leaving the mobile breakpoint", async () => {
    let changeListener = null;
    const media = {
      matches: true,
      addEventListener: vi.fn((_type, listener) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    globalThis.matchMedia = vi.fn(() => media);
    const shell = setupPluginShell({ registry: registry() });
    const more = document.querySelector("[data-mobile-activity-more]");
    const menu = document.querySelector("[data-mobile-activity-menu]");
    more.click();
    expect(menu.hidden).toBe(false);

    media.matches = false;
    changeListener(new Event("change"));

    expect(menu.hidden).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    shell.destroy();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", changeListener);
  });

  it("uses instant navigation scrolling when reduced motion is requested", async () => {
    const mobileMedia = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const reducedMotionMedia = { matches: true };
    globalThis.matchMedia = vi.fn((query) =>
      query === "(prefers-reduced-motion: reduce)" ? reducedMotionMedia : mobileMedia,
    );
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const shell = setupPluginShell({ registry: registry() });

    await shell.activate("com.zicode.notes", { focus: false });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
    shell.destroy();
    if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    else delete HTMLElement.prototype.scrollIntoView;
  });

  it("lets Plugin Manager disable a built-in and removes its activity", async () => {
    const shell = setupPluginShell({ registry: registry() });
    await shell.activate("core.pluginManager", { focus: false });
    const notesCard = [...document.querySelectorAll(".plugin-manager-card")].find((card) =>
      card.textContent.includes("com.zicode.notes"),
    );

    const toggle = [...notesCard.querySelectorAll("button")].find((button) =>
      /Enabled|Disabled|启用|禁用/.test(button.textContent),
    );
    toggle?.click();

    expect(shell.registry.isEnabled("com.zicode.notes")).toBe(false);
    expect(document.querySelector('[data-plugin-id="com.zicode.notes"]')).toBeNull();
    expect(document.querySelector(".plugin-main-view").textContent).toContain("Plugin Manager");
  });

  it("routes Finance commands into the Finance application and configuration", async () => {
    const openFinanceWorkbench = vi.fn();
    const openSettings = vi.fn();
    const shell = setupPluginShell({
      registry: registry(),
      openFinanceWorkbench,
      openSettings,
    });
    shell
      .getCommandPaletteEntries()
      .find((command) => command.label === "Finance: Open workbench")
      .action();

    expect(openFinanceWorkbench).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("com.zicode.finance"));
    expect(shell.getActivePluginId()).toBe("com.zicode.finance");

    shell
      .getCommandPaletteEntries()
      .find((command) => command.label === "Finance: Configuration")
      .action();
    expect(openSettings).toHaveBeenCalledWith("configuration");
  });

  it("renders Finance through the shared function area and main view", async () => {
    const financeApp = {
      renderNavigation: vi.fn((container) => {
        container.append(
          Object.assign(document.createElement("button"), { textContent: "Market snapshots" }),
        );
      }),
      renderContent: vi.fn((container) => {
        container.append(
          Object.assign(document.createElement("section"), { textContent: "Finance overview" }),
        );
      }),
      selectView: vi.fn(),
      setTarget: vi.fn(),
    };
    const shell = setupPluginShell({ registry: registry(), financeApp });

    await shell.activate("com.zicode.finance", { focus: false });

    expect(shell.getActivePluginId()).toBe("com.zicode.finance");
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain(
      "Market snapshots",
    );
    expect(document.querySelector(".plugin-main-view").textContent).toContain("Finance overview");
    shell
      .getCommandPaletteEntries()
      .find((command) => command.label === "Finance: Open workbench")
      .action();
    expect(financeApp.selectView).toHaveBeenCalledWith("overview");
  });

  it("does not leak app-specific main view classes into other apps", async () => {
    const financeApp = {
      renderNavigation: vi.fn(),
      renderContent: vi.fn((container) => {
        container.classList.add("finance-plugin-main");
        container.append(
          Object.assign(document.createElement("section"), { textContent: "Finance overview" }),
        );
      }),
      selectView: vi.fn(),
      setTarget: vi.fn(),
    };
    const shell = setupPluginShell({ registry: registry(), financeApp });

    await shell.activate("com.zicode.finance", { focus: false });
    expect(
      document.querySelector(".plugin-main-view").classList.contains("finance-plugin-main"),
    ).toBe(true);

    await shell.activate("com.zicode.notes", { focus: false });
    expect(
      document.querySelector(".plugin-main-view").classList.contains("finance-plugin-main"),
    ).toBe(false);
    expect(document.querySelector(".plugin-main-view").classList.contains("plugin-main-view")).toBe(
      true,
    );
  });

  it("renders Artifacts through the shared regions and exports from its command", async () => {
    const artifactApp = {
      renderNavigation: vi.fn((container) => {
        container.append(
          Object.assign(document.createElement("button"), { textContent: "Recent reports" }),
        );
      }),
      renderContent: vi.fn((container) => {
        container.append(
          Object.assign(document.createElement("section"), { textContent: "Artifact library" }),
        );
      }),
      exportSelected: vi.fn(),
      setTarget: vi.fn(),
    };
    const shell = setupPluginShell({ registry: registry(), artifactApp });

    await shell.activate("com.zicode.artifacts", { focus: false });
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain(
      "Recent reports",
    );
    expect(document.querySelector(".plugin-main-view").textContent).toContain("Artifact library");

    shell
      .getCommandPaletteEntries()
      .find((command) => command.label === "Artifacts: Export")
      .action();
    expect(artifactApp.exportSelected).toHaveBeenCalledOnce();
    expect(shell.getActivePluginId()).toBe("com.zicode.artifacts");
  });

  it("routes enabled Developer contributions through the isolated View Host", async () => {
    const developerRegistry = new BuiltinPluginRegistry({
      storage: { getItem: () => null, setItem: () => {} },
      hostGateway: {
        list: vi.fn(async () => ({
          diagnostics: [],
          plugins: [
            {
              schemaVersion: 1,
              id: "com.example.view",
              name: "Example View",
              description: "Sandboxed developer interface",
              version: "1.0.0",
              publisher: "example",
              origin: "developer",
              enabled: true,
              core: false,
              permissionGrants: {},
              permissions: { required: [], optional: [] },
              contributes: {
                activities: [{ id: "example", title: "Example", order: 10 }],
                views: [
                  {
                    id: "example.sidebar",
                    location: "sidebar",
                    title: "Example tools",
                    entry: "views/sidebar.html",
                  },
                  {
                    id: "example.main",
                    location: "main",
                    title: "Example",
                    entry: "views/main.html",
                  },
                ],
              },
            },
          ],
        })),
      },
    });
    const pluginViewHost = {
      renderNavigation: vi.fn(),
      renderContent: vi.fn(),
      canDeactivate: vi.fn(() => false),
      deactivate: vi.fn(),
      setTarget: vi.fn(),
    };
    const shell = setupPluginShell({
      registry: developerRegistry,
      pluginViewHost,
      getTarget: () => ({ sceneId: "programming" }),
    });
    await vi.waitFor(() =>
      expect(shell.getCommandPaletteEntries().some(entry => entry.id === "com.example.view:open")).toBe(true),
    );
    expect(document.querySelector('[data-plugin-id="com.example.view"]')).toBeNull();

    await shell.activate("com.example.view", { focus: false });
    expect(pluginViewHost.renderNavigation).toHaveBeenCalledWith(
      expect.any(Element),
      expect.objectContaining({ id: "com.example.view", origin: "developer" }),
    );
    expect(pluginViewHost.renderContent).toHaveBeenCalledWith(
      expect.any(Element),
      expect.objectContaining({ id: "com.example.view", origin: "developer" }),
    );

    await shell.activate("core.chat", { focus: false });
    expect(shell.getActivePluginId()).toBe("com.example.view");
    expect(pluginViewHost.canDeactivate).toHaveBeenCalledWith("com.example.view");
  });

  it("executes a command-only Developer contribution through the Worker gateway", async () => {
    const developerRegistry = new BuiltinPluginRegistry({
      storage: { getItem: () => null, setItem: () => {} },
      hostGateway: {
        list: vi.fn(async () => ({
          diagnostics: [],
          plugins: [
            {
              schemaVersion: 1,
              id: "com.example.command",
              name: "Command Demo",
              description: "Command-only plugin",
              version: "1.0.0",
              publisher: "example",
              origin: "developer",
              enabled: true,
              core: false,
              permissionGrants: {},
              permissions: { required: [], optional: [] },
              contributes: {
                commands: [{ id: "example.run", title: "Run command" }],
              },
            },
          ],
        })),
      },
    });
    const commandGateway = {
      invokeCommand: vi.fn(async () => ({ result: { message: "Worker completed" } })),
    };
    const notify = vi.fn();
    const shell = setupPluginShell({
      registry: developerRegistry,
      commandGateway,
      notify,
      getTarget: () => ({ sceneId: "programming" }),
    });
    await vi.waitFor(() =>
      expect(shell.getCommandPaletteEntries().some((entry) => entry.label.includes("Run command"))).toBe(
        true,
      ),
    );

    await shell.executeCommand("example.run", { value: 7 });

    expect(commandGateway.invokeCommand).toHaveBeenCalledWith("programming", "example.run", {
      value: 7,
    });
    expect(notify).toHaveBeenCalledWith("Worker completed");
  });

  it("preserves the Plugin Manager filter when switching through Chat", async () => {
    const shell = setupPluginShell({ registry: registry() });
    await shell.activate("core.pluginManager", { focus: false });
    document.querySelector('[data-plugin-filter="disabled"]').click();
    await shell.activate("core.chat", { focus: false });
    await shell.activate("core.pluginManager", { focus: false });

    expect(
      document.querySelector('[data-plugin-filter="disabled"]').getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps the Command Palette reachable outside Chat", async () => {
    const openCommandPalette = vi.fn();
    const shell = setupPluginShell({
      registry: registry(),
      openCommandPalette,
    });
    await shell.activate("com.zicode.notes", { focus: false });

    document.querySelector('[data-plugin-id="core.commands"]').click();

    expect(openCommandPalette).toHaveBeenCalledOnce();
    expect(shell.getActivePluginId()).toBe("com.zicode.notes");
  });

  it("moves file management access into navigation when the top bar is hidden", async () => {
    const openFiles = vi.fn();
    document.getElementById("file-sidebar-toggle").addEventListener("click", openFiles);
    setupPluginShell({ registry: registry() });

    document.querySelector('[data-plugin-id="core.files"]').click();

    expect(openFiles).toHaveBeenCalledOnce();
  });

  it("renders Settings and Help as ordinary three-region applications", async () => {
    let openSettings;
    let openHelp;
    const settingsApp = {
      setOpenHandler(handler) {
        openSettings = handler;
      },
      openSettings(tab) {
        this.tab = tab;
        openSettings(tab);
      },
      renderNavigation(container) {
        container.append(
          Object.assign(document.createElement("button"), { textContent: "General" }),
        );
      },
      renderContent(container) {
        container.append(
          Object.assign(document.createElement("section"), {
            textContent: `Settings content: ${this.tab}`,
          }),
        );
      },
      deactivate: vi.fn(),
    };
    const helpApp = {
      setOpenHandler(handler) {
        openHelp = handler;
      },
      open(pageId = "getting-started") {
        this.pageId = pageId;
        openHelp(pageId);
      },
      renderNavigation(container) {
        container.append(
          Object.assign(document.createElement("button"), { textContent: "Quick start" }),
        );
      },
      renderContent(container) {
        container.append(
          Object.assign(document.createElement("article"), {
            textContent: `Help content: ${this.pageId}`,
          }),
        );
      },
    };
    const shell = setupPluginShell({ registry: registry(), settingsApp, helpApp });

    document.querySelector('[data-plugin-id="core.settings"]').click();
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("core.settings"));
    expect(shell.getActivePluginId()).toBe("core.settings");
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain("General");
    expect(document.querySelector(".plugin-main-view").textContent).toContain(
      "Settings content: general",
    );

    document.querySelector('[data-plugin-id="core.help"]').click();
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe("core.help"));
    expect(settingsApp.deactivate).toHaveBeenCalledOnce();
    expect(shell.getActivePluginId()).toBe("core.help");
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain("Quick start");
    expect(document.querySelector(".plugin-main-view").textContent).toContain(
      "Help content: getting-started",
    );
  });
});
