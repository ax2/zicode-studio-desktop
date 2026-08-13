import { describe, expect, it, vi } from "vitest";
import { BuiltinPluginRegistry } from "./plugin-registry.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => data.get(key) ?? null),
    setItem: vi.fn((key, value) => data.set(key, value)),
  };
}

describe("BuiltinPluginRegistry", () => {
  it("keeps Chat enabled and exposes the planned built-in plugins", async () => {
    const registry = new BuiltinPluginRegistry({ storage: memoryStorage() });

    expect(registry.get("core.chat")).toMatchObject({ core: true, enabled: true });
    expect(registry.list().map((plugin) => plugin.id)).toEqual([
      "core.chat",
      "com.zicode.projects",
      "com.zicode.tasks",
      "com.zicode.notes",
      "com.zicode.automation",
      "com.zicode.finance",
      "com.zicode.graph",
      "com.zicode.habits",
      "com.zicode.idphoto",
      "com.zicode.imagetools",
      "com.zicode.clipboard",
      "com.zicode.documents",
      "com.zicode.artifacts",
    ]);
    await expect(registry.setEnabled("core.chat", false)).rejects.toThrow("required core plugin");
  });

  it("persists enablement without changing the immutable plugin catalog", async () => {
    const storage = memoryStorage();
    const registry = new BuiltinPluginRegistry({ storage });
    const listener = vi.fn();
    registry.subscribe(listener);

    await registry.setEnabled("com.zicode.notes", false);

    expect(registry.isEnabled("com.zicode.notes")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      "zicode.application-plugins.v1",
      expect.stringContaining('"com.zicode.notes":false'),
    );
  });

  it("recovers from malformed persisted state", () => {
    const registry = new BuiltinPluginRegistry({
      storage: memoryStorage({ "zicode.application-plugins.v1": "not-json" }),
    });

    expect(registry.get("com.zicode.notes")).toMatchObject({ enabled: true });
  });

  it("hydrates scene state from the Rust Host and sends mutations back", async () => {
    const hostGateway = {
      list: vi.fn().mockResolvedValue({
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
            id: "com.example.local",
            name: "Local",
            description: "Developer plugin",
            version: "0.1.0",
            publisher: "example",
            core: false,
            enabled: false,
            origin: "developer",
            contributes: {
              commands: [{ id: "example.run", title: "Run" }],
            },
            permissions: {
              required: [{ name: "storage.plugin", reason: "Save state" }],
              optional: [],
            },
            permissionGrants: { "storage.plugin": false },
          },
        ],
        diagnostics: [],
      }),
      setEnabled: vi.fn().mockResolvedValue({ enabled: true }),
    };
    const registry = new BuiltinPluginRegistry({ storage: memoryStorage(), hostGateway });

    await registry.setScene("research");
    expect(registry.get("com.example.local")).toMatchObject({
      origin: "developer",
      enabled: false,
      hasActivity: false,
    });
    expect(registry.get("com.example.local").commands).toEqual([
      { id: "example.run", label: "Run", icon: "command" },
    ]);

    await registry.setEnabled("com.example.local", true);
    expect(hostGateway.setEnabled).toHaveBeenCalledWith(
      "research",
      "com.example.local",
      true,
    );
    expect(registry.isEnabled("com.example.local")).toBe(true);
  });

  it("reloads and uninstalls developer plugins without exposing those actions for built-ins", async () => {
    const plugins = [
          {
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
            id: "com.example.local",
            name: "Local",
            description: "Developer plugin",
            version: "0.1.0",
            publisher: "example",
            core: false,
            enabled: false,
            origin: "developer",
            contributes: {},
            permissions: { required: [], optional: [] },
            permissionGrants: {},
          },
        ];
    const list = vi
      .fn()
      .mockResolvedValueOnce({ plugins, diagnostics: [] })
      .mockResolvedValueOnce({ plugins, diagnostics: [] })
      .mockResolvedValueOnce({ plugins: [plugins[0]], diagnostics: [] });
    const hostGateway = {
      list,
      reload: vi.fn().mockResolvedValue({ reloaded: true }),
      uninstall: vi.fn().mockResolvedValue({ uninstalled: true }),
    };
    const registry = new BuiltinPluginRegistry({ storage: memoryStorage(), hostGateway });
    await registry.setScene("programming");

    await expect(registry.uninstall("core.chat")).rejects.toThrow(
      "Built-in plugins cannot be uninstalled",
    );
    await registry.reload();
    expect(hostGateway.reload).toHaveBeenCalledTimes(1);
    await registry.uninstall("com.example.local");
    expect(hostGateway.uninstall).toHaveBeenCalledWith("com.example.local");
    expect(registry.get("com.example.local")).toBeNull();
  });
});
