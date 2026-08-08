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
  it("renders application activities while preserving Chat as the default surface", () => {
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

  it("switches to an exclusive plugin main view and makes Chat inert", () => {
    const shell = setupPluginShell({ registry: registry() });

    shell.activate("com.zicode.notes", { focus: false });

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

  it("shows background activity on Chat and clears it when Chat is reopened", () => {
    const shell = setupPluginShell({ registry: registry() });
    shell.activate("com.zicode.notes", { focus: false });
    shell.setActivityBadge("core.chat", { count: 2, tone: "warning" });
    expect(document.querySelector('[data-plugin-id="core.chat"] .plugin-activity-badge').textContent).toBe("2");
    shell.activate("core.chat", { focus: false });
    expect(document.querySelector('[data-plugin-id="core.chat"] .plugin-activity-badge')).toBeNull();
  });

  it("requests the mobile function area when an application is selected", () => {
    const requested = vi.fn();
    document.addEventListener("zicode:function-area-request", requested, { once: true });
    setupPluginShell({ registry: registry() });

    document.querySelector('[data-plugin-id="com.zicode.notes"]').click();

    expect(requested).toHaveBeenCalledOnce();
    expect(requested.mock.calls[0][0].detail).toEqual({ open: true });
  });

  it("restores the previous application when browser Back reveals its history state", () => {
    const shell = setupPluginShell({ registry: registry() });
    document.querySelector('[data-plugin-id="com.zicode.notes"]').click();
    expect(shell.getActivePluginId()).toBe("com.zicode.notes");
    expect(history.state?.zicodePluginId).toBe("com.zicode.notes");

    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { zicodePluginId: "core.chat" } }),
    );
    expect(shell.getActivePluginId()).toBe("core.chat");
  });

  it("keeps primary mobile destinations visible and moves secondary activities into More", () => {
    const shell = setupPluginShell({ registry: registry() });
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
        "Finance",
        "Artifacts",
        "Commands",
        "Manage plugins",
        "Settings",
        "Help",
      ]),
    );
    expect(menuLabels).not.toEqual(expect.arrayContaining(["Chat", "Projects", "Notes", "Files"]));

    more.click();
    expect(menu.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const tasks = menu.querySelector('[data-mobile-plugin-id="com.zicode.tasks"]');
    tasks.click();
    expect(shell.getActivePluginId()).toBe("com.zicode.tasks");
    expect(historyBack).not.toHaveBeenCalled();
    expect(menu.hidden).toBe(true);
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
    expect(more.hasAttribute("aria-current")).toBe(false);
    expect(more.getAttribute("aria-label")).toBe("More");
    historyBack.mockRestore();
  });

  it("traps focus inside the mobile More panel and restores it on Escape", () => {
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

  it("closes the mobile More panel before browser Back leaves the current application", () => {
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

  it("closes More when leaving the mobile breakpoint", () => {
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

  it("uses instant navigation scrolling when reduced motion is requested", () => {
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

    shell.activate("com.zicode.notes", { focus: false });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "nearest",
      inline: "center",
    });
    shell.destroy();
    if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    else delete HTMLElement.prototype.scrollIntoView;
  });

  it("lets Plugin Manager disable a built-in and removes its activity", () => {
    const shell = setupPluginShell({ registry: registry() });
    shell.activate("core.pluginManager", { focus: false });
    const notesCard = [...document.querySelectorAll(".plugin-manager-card")].find((card) =>
      card.textContent.includes("com.zicode.notes"),
    );

    notesCard.querySelector("button").click();

    expect(shell.registry.isEnabled("com.zicode.notes")).toBe(false);
    expect(document.querySelector('[data-plugin-id="com.zicode.notes"]')).toBeNull();
    expect(document.querySelector(".plugin-main-view").textContent).toContain("Plugin Manager");
  });

  it("routes Finance commands into the Finance application and configuration", () => {
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
    expect(shell.getActivePluginId()).toBe("com.zicode.finance");

    shell
      .getCommandPaletteEntries()
      .find((command) => command.label === "Finance: Configuration")
      .action();
    expect(openSettings).toHaveBeenCalledWith("configuration");
  });

  it("renders Finance through the shared function area and main view", () => {
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

    shell.activate("com.zicode.finance", { focus: false });

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

  it("renders Artifacts through the shared regions and exports from its command", () => {
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

    shell.activate("com.zicode.artifacts", { focus: false });
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
      expect(document.querySelector('[data-plugin-id="com.example.view"]')).toBeTruthy(),
    );

    shell.activate("com.example.view", { focus: false });
    expect(pluginViewHost.renderNavigation).toHaveBeenCalledWith(
      expect.any(Element),
      expect.objectContaining({ id: "com.example.view", origin: "developer" }),
    );
    expect(pluginViewHost.renderContent).toHaveBeenCalledWith(
      expect.any(Element),
      expect.objectContaining({ id: "com.example.view", origin: "developer" }),
    );

    shell.activate("core.chat", { focus: false });
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

  it("preserves the Plugin Manager filter when switching through Chat", () => {
    const shell = setupPluginShell({ registry: registry() });
    shell.activate("core.pluginManager", { focus: false });
    document.querySelector('[data-plugin-filter="disabled"]').click();
    shell.activate("core.chat", { focus: false });
    shell.activate("core.pluginManager", { focus: false });

    expect(
      document.querySelector('[data-plugin-filter="disabled"]').getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps the Command Palette reachable outside Chat", () => {
    const openCommandPalette = vi.fn();
    const shell = setupPluginShell({
      registry: registry(),
      openCommandPalette,
    });
    shell.activate("com.zicode.notes", { focus: false });

    document.querySelector('[data-plugin-id="core.commands"]').click();

    expect(openCommandPalette).toHaveBeenCalledOnce();
    expect(shell.getActivePluginId()).toBe("com.zicode.notes");
  });

  it("moves file management access into navigation when the top bar is hidden", () => {
    const openFiles = vi.fn();
    document.getElementById("file-sidebar-toggle").addEventListener("click", openFiles);
    setupPluginShell({ registry: registry() });

    document.querySelector('[data-plugin-id="core.files"]').click();

    expect(openFiles).toHaveBeenCalledOnce();
  });

  it("renders Settings and Help as ordinary three-region applications", () => {
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
    expect(shell.getActivePluginId()).toBe("core.settings");
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain("General");
    expect(document.querySelector(".plugin-main-view").textContent).toContain(
      "Settings content: general",
    );

    document.querySelector('[data-plugin-id="core.help"]').click();
    expect(settingsApp.deactivate).toHaveBeenCalledOnce();
    expect(shell.getActivePluginId()).toBe("core.help");
    expect(document.querySelector(".plugin-sidebar-surface").textContent).toContain("Quick start");
    expect(document.querySelector(".plugin-main-view").textContent).toContain(
      "Help content: getting-started",
    );
  });
});
