import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { renderPluginManagerView } from "../react/plugin-manager-view.js";

const BUILTIN = {
  id: "core.chat",
  name: "Chat",
  description: "Conversations",
  icon: "chat",
  origin: "builtIn",
  core: true,
  enabled: true,
  permissions: {},
  permissionDetails: { required: [], optional: [] },
};

const DEVELOPER = {
  id: "com.example.local",
  name: "Local tools",
  description: "Example developer plugin",
  icon: "plugins",
  origin: "developer",
  core: false,
  enabled: false,
  permissions: { "storage.plugin": false },
  permissionDetails: {
    required: [{ name: "storage.plugin", reason: "Save state" }],
    optional: [],
  },
};

function button(label) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
}

function setup(overrides = {}) {
  const registry = {
    list: vi.fn(() => [BUILTIN, DEVELOPER]),
    diagnostics: vi.fn(() => []),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    setPermission: vi.fn().mockResolvedValue(undefined),
    setScene: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    ...overrides.registry,
  };
  const installDeveloperPlugin =
    overrides.installDeveloperPlugin ?? vi.fn().mockResolvedValue("com.example.local");
  const selectSignedPlugin = overrides.selectSignedPlugin ?? null;
  const installSignedPlugin = overrides.installSignedPlugin ?? null;
  renderPluginManagerView({
    container: document.getElementById("root"),
    registry,
    getTarget: () => ({ sceneId: "research" }),
    notify: overrides.notify ?? vi.fn(),
    renderIcon: () => document.createElement("span"),
    installDeveloperPlugin,
    selectSignedPlugin,
    installSignedPlugin,
    rollbackSignedPlugin: overrides.rollbackSignedPlugin,
    revokePublisher: overrides.revokePublisher,
    confirmPublisher: overrides.confirmPublisher ?? (() => true),
    initialFilter: overrides.initialFilter,
    onFilterChange: overrides.onFilterChange,
    confirmUninstall: overrides.confirmUninstall ?? (() => true),
    openHelp: overrides.openHelp,
  });
  return { registry, installDeveloperPlugin };
}

describe("renderPluginManagerView", () => {
  beforeEach(() => {
    setLocale("en");
    document.body.innerHTML = '<main id="root"></main>';
  });

  it("filters installed plugins by origin and enablement", () => {
    setup();
    expect(document.querySelectorAll(".plugin-manager-card")).toHaveLength(2);

    button("Developer").click();
    expect(document.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
    expect(document.querySelector(".plugin-manager-card code").textContent).toBe(
      "com.example.local",
    );

    button("Disabled").click();
    expect(document.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
    expect(document.querySelector(".plugin-manager-card code").textContent).toBe(
      "com.example.local",
    );
  });

  it("restores the last filter when the manager rerenders", () => {
    const onFilterChange = vi.fn();
    setup({ initialFilter: "developer", onFilterChange });
    expect(document.querySelectorAll(".plugin-manager-card")).toHaveLength(1);
    expect(document.querySelector(".plugin-manager-card code").textContent).toBe(
      "com.example.local",
    );

    button("Installed").click();
    expect(onFilterChange).toHaveBeenCalledWith("installed");
  });

  it("installs through the native picker callback and reloads the active scene", async () => {
    const { registry, installDeveloperPlugin } = setup();

    button("Install local plugin").click();

    await vi.waitFor(() => {
      expect(installDeveloperPlugin).toHaveBeenCalledTimes(1);
      expect(registry.setScene).toHaveBeenCalledWith("research");
    });
  });

  it("confirms an unknown publisher fingerprint before installing a signed package", async () => {
    const selectSignedPlugin = vi.fn().mockResolvedValue({
      packagePath: "C:/plugins/example.zicode-plugin",
      pluginId: "com.example.signed",
      publisher: "Example Publisher",
      publisherKeyId: "ab".repeat(32),
      permissions: ["storage.plugin"],
      trusted: false,
    });
    const installSignedPlugin = vi.fn().mockResolvedValue("com.example.signed");
    const confirmPublisher = vi.fn(() => true);
    const { registry } = setup({
      selectSignedPlugin,
      installSignedPlugin,
      confirmPublisher,
    });

    button("Install signed package").click();

    await vi.waitFor(() => {
      expect(confirmPublisher).toHaveBeenCalledWith(expect.stringContaining("ab".repeat(32)));
      expect(installSignedPlugin).toHaveBeenCalledWith("C:/plugins/example.zicode-plugin", true);
      expect(registry.setScene).toHaveBeenCalledWith("research");
    });
  });

  it("refreshes the Host registry and uninstalls only after confirmation", async () => {
    const confirmUninstall = vi.fn(() => true);
    const { registry } = setup({ confirmUninstall });

    button("Refresh").click();
    button("Uninstall").click();

    await vi.waitFor(() => {
      expect(registry.reload).toHaveBeenCalledTimes(1);
      expect(registry.uninstall).toHaveBeenCalledWith("com.example.local");
    });
    expect(confirmUninstall).toHaveBeenCalledWith(
      expect.stringMatching(/data will be preserved|数据会保留/),
    );
  });

  it("does not uninstall when confirmation is rejected", () => {
    const { registry } = setup({ confirmUninstall: () => false });

    button("Uninstall").click();

    expect(registry.uninstall).not.toHaveBeenCalled();
  });

  it("offers retained-version rollback and publisher revocation for signed plugins", async () => {
    const signed = {
      ...DEVELOPER,
      id: "com.example.signed",
      name: "Signed tools",
      origin: "signed",
      publisher: "Example Publisher",
      publisherKeyId: "cd".repeat(32),
      retainedVersions: ["1.0.0"],
    };
    const rollbackSignedPlugin = vi.fn().mockResolvedValue(undefined);
    const revokePublisher = vi.fn().mockResolvedValue(undefined);
    setup({
      registry: { list: vi.fn(() => [signed]) },
      rollbackSignedPlugin,
      revokePublisher,
      confirmPublisher: () => true,
    });

    button("Rollback 1.0.0").click();
    button("Revoke publisher").click();

    await vi.waitFor(() => {
      expect(rollbackSignedPlugin).toHaveBeenCalledWith("com.example.signed", "1.0.0");
      expect(revokePublisher).toHaveBeenCalledWith("cd".repeat(32));
    });
  });

  it("renders manager controls in the selected interface language", () => {
    setLocale("zh-CN");
    setup();

    expect(document.querySelector(".plugin-main-hero").textContent).toContain("插件管理");
    expect(button("安装本地插件")).toBeTruthy();
    expect(button("开发者")).toBeTruthy();
  });

  it("opens the matching help page from a built-in plugin's usage guide", () => {
    setLocale("zh-CN");
    const openHelp = vi.fn();
    setup({
      registry: {
        list: vi.fn(() => [
          { ...BUILTIN, id: "com.zicode.notes", name: "Notes", origin: "builtIn" },
          { ...BUILTIN, id: "com.zicode.habits", name: "Habits", origin: "builtIn" },
        ]),
      },
      openHelp,
    });
    const guideButtons = [...document.querySelectorAll("button")].filter(
      (candidate) => candidate.textContent === "使用指南",
    );
    expect(guideButtons.length).toBe(2);
    for (const button of guideButtons) button.click();
    expect(openHelp).toHaveBeenCalledWith("notes");
    expect(openHelp).toHaveBeenCalledWith("habits");
  });
});
