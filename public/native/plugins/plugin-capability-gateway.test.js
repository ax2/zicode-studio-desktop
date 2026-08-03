import { describe, expect, it, vi } from "vitest";
import { PluginCapabilityGateway } from "./plugin-capability-gateway.js";

describe("PluginCapabilityGateway", () => {
  it("lists capabilities for the active scene", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ capabilities: [] }),
    }));
    const gateway = new PluginCapabilityGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    await gateway.list("programming");
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:57620/v2/plugin-capabilities?sceneId=programming",
    );
  });

  it("invokes a capability through the Host boundary", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { matches: [] } }),
    }));
    const gateway = new PluginCapabilityGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const response = await gateway.invoke("programming", "com.zicode.notes", "notes.search", {
      query: "roadmap",
    });
    expect(response.result).toEqual({ matches: [] });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      sceneId: "programming",
      pluginId: "com.zicode.notes",
      capabilityId: "notes.search",
      input: { query: "roadmap" },
    });
  });
});
