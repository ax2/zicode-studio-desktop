import { describe, expect, it, vi } from "vitest";
import { PluginHostGateway } from "./plugin-host-gateway.js";

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("PluginHostGateway", () => {
  it("loads plugin metadata for one scene", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ plugins: [], diagnostics: [] }));
    const gateway = new PluginHostGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });

    await gateway.list("finance");

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:57620/v2/plugins?sceneId=finance"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("persists enablement through the Host API", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ pluginId: "com.example.plugin", enabled: true }));
    const gateway = new PluginHostGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });

    await gateway.setEnabled("programming", "com.example.plugin", true);

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:57620/v2/plugins/enablement"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sceneId: "programming",
          pluginId: "com.example.plugin",
          enabled: true,
        }),
      }),
    );
  });

  it("surfaces structured Host errors", async () => {
    const gateway = new PluginHostGateway({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          response(
            { error: { code: "enablement_rejected", message: "Required permission denied" } },
            { ok: false, status: 422 },
          ),
        ),
      location: { origin: "http://127.0.0.1:57620" },
    });

    await expect(gateway.setEnabled("programming", "com.example.plugin", true)).rejects.toThrow(
      "Required permission denied",
    );
  });

  it("reloads and uninstalls developer packages through explicit endpoints", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ reloaded: true, diagnostics: [] }))
      .mockResolvedValueOnce(
        response({
          pluginId: "com.example.plugin",
          uninstalled: true,
          dataPreserved: true,
        }),
      );
    const gateway = new PluginHostGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });

    await gateway.reload();
    await gateway.uninstall("com.example.plugin");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      new URL("http://127.0.0.1:57620/v2/plugins/reload"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL("http://127.0.0.1:57620/v2/plugins/uninstall"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pluginId: "com.example.plugin" }),
      }),
    );
  });

  it("loads only a declared developer view for the active scene", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ view: { viewId: "example.main", html: "<main></main>" } }),
    }));
    const gateway = new PluginHostGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });

    await gateway.viewSource("programming", "com.example.view", "example.main");

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        "http://127.0.0.1:57620/v2/plugin-views/source?sceneId=programming&pluginId=com.example.view&viewId=example.main",
      ),
      expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
    );
  });

  it("invokes a plugin command through the Host Worker broker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ result: { message: "done" } }));
    const gateway = new PluginHostGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });

    await gateway.invokeCommand("programming", "example.run", { value: 7 });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:57620/v2/plugin-commands/invoke"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sceneId: "programming",
          commandId: "example.run",
          args: { value: 7 },
        }),
      }),
    );
  });
});
