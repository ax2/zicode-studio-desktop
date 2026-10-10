import { describe, expect, it, vi } from "vitest";
import { setupPluginBroker } from "./plugin-broker";
import { createCatalogClient } from "./plugin-catalog-client";
import { MAX_PLUGIN_BYTES, type PluginToolSnapshot, pluginToolId, readPluginTools } from "./plugin-tool-snapshot";

const revision = "a".repeat(64);
const binding = { origin: "http://127.0.0.1:57620", token: "fixture-token", runtimeId: "runtime-a", sessionId: "session-a" };
const tool = (index = 0): PluginToolSnapshot => ({ pluginId: "com.fixture", capability: `text.${index}`,
  name: `fixture_${index}`, title: "Text tool", description: "Local fixture", inputSchema: { type: "object" } });
const environment = { PI_DESKTOP_PLUGIN_HOST_ORIGIN: binding.origin, PI_DESKTOP_PLUGIN_BROKER_TOKEN: binding.token,
  PI_DESKTOP_PLUGIN_RUNTIME_ID: binding.runtimeId, PI_DESKTOP_PLUGIN_SESSION_ID: binding.sessionId,
  PI_DESKTOP_PLUGIN_TOOLS: "[]", PI_DESKTOP_PLUGIN_CATALOG: "1" };

function fakePi() {
  const registered = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  const active = new Set(["read", "bash"]);
  return { registered, active, registerTool: vi.fn(value => registered.set(value.name, value)),
    getAllTools: () => [{ name: "read" }, { name: "bash" }, { name: "dormant" }, ...[...registered.keys()].map(name => ({ name }))],
    getActiveTools: () => [...active], setActiveTools: vi.fn((names: string[]) => { active.clear(); for (const name of names) active.add(name); }) };
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); }

describe("plugin catalog consumer", () => {
  it("registers discovery during actual SDK initialization without reading unbound runtime tools", () => {
    const pi = fakePi();
    pi.getAllTools = () => { throw new Error("Extension runtime not initialized"); };
    setupPluginBroker(pi as never, environment);
    expect([...pi.registered.keys()]).toEqual(["studio_plugin_search", "studio_plugin_load"]);
  });
  it("enforces aggregate metadata bytes before registering another tool", async () => {
    const pi = fakePi();
    let index = 0;
    const request = vi.fn(async () => {
      const candidate = tool(index++);
      candidate.inputSchema.description = "x".repeat(140_000);
      return response({ schemaVersion: 1, revision, toolId: pluginToolId(candidate), tool: candidate });
    });
    setupPluginBroker(pi as never, environment, request as never);
    const load = pi.registered.get("studio_plugin_load")?.execute;
    if (!load) throw new Error("Load tool missing");
    await load("first", { toolId: pluginToolId(tool(0)), revision }, new AbortController().signal);
    await expect(load("second", { toolId: pluginToolId(tool(1)), revision }, new AbortController().signal)).rejects.toThrow("plugin_tool_budget_exceeded");
    expect(pi.registered.has("fixture_1")).toBe(false);
    expect([...pi.active]).toEqual(["read", "bash", "fixture_0"]);
  });
  it("loads once under concurrent requests, preserves active native tools, and binds invocation to identity/revision", async () => {
    const pi = fakePi();
    const candidate = tool();
    const request = vi.fn(async (url: string) => url.endsWith("/load")
      ? response({ schemaVersion: 1, revision, toolId: pluginToolId(candidate), tool: candidate })
      : response({ result: { text: "result" } }));
    setupPluginBroker(pi as never, environment, request as never);
    expect(pi.registered.size).toBe(2);
    const load = pi.registered.get("studio_plugin_load")?.execute;
    if (!load) throw new Error("Load tool missing");
    const input = { toolId: pluginToolId(candidate), revision };
    await Promise.all([load("load-a", input, new AbortController().signal), load("load-b", input, new AbortController().signal)]);
    expect(pi.registerTool.mock.calls.filter(([value]) => value.name === candidate.name)).toHaveLength(1);
    expect([...pi.active]).toEqual(["read", "bash", candidate.name]);
    const execute = pi.registered.get(candidate.name)?.execute;
    if (!execute) throw new Error("Plugin tool missing");
    await execute("invoke-a", { text: "hello" }, new AbortController().signal);
    const call = request.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(call[0]).toBe(`${binding.origin}/v2/plugin-tools/invoke`);
    expect(JSON.parse(call[1].body as string)).toMatchObject({ runtimeId: binding.runtimeId, sessionId: binding.sessionId,
      toolCallId: "invoke-a", toolId: pluginToolId(candidate), catalogRevision: revision, toolName: candidate.name });
  });

  it("refuses tool-count exhaustion, foreign name collision, cancellation and mismatched load identity", async () => {
    for (const mode of ["count", "collision", "cancel", "mismatch"] as const) {
      const pi = fakePi();
      const initial = mode === "count" ? Array.from({ length: 128 }, (_, i) => tool(i)) : [];
      const candidate = tool(129);
      if (mode === "collision") candidate.name = "read";
      const request = vi.fn(async () => response({ schemaVersion: 1, revision,
        toolId: mode === "mismatch" ? "wrong" : pluginToolId(candidate), tool: candidate }));
      setupPluginBroker(pi as never, { ...environment, PI_DESKTOP_PLUGIN_TOOLS: JSON.stringify(initial) }, request as never);
      const before = pi.registered.size;
      const controller = new AbortController();
      if (mode === "cancel") controller.abort();
      await expect(pi.registered.get("studio_plugin_load")?.execute("load", { toolId: pluginToolId(candidate), revision }, controller.signal)).rejects.toThrow();
      expect(pi.registered.size).toBe(before);
      expect([...pi.active]).toEqual(["read", "bash"]);
    }
  });

  it("rejects malformed and oversized responses and sends only the bound runtime identity", async () => {
    for (const payload of [{ schemaVersion: 2 }, { schemaVersion: 1, revision, items: Array(21).fill({}), nextCursor: null, total: 21 }, { text: "x".repeat(33 * 1024) }]) {
      const request = vi.fn(async () => response(payload));
      const client = createCatalogClient(binding, request as never);
      await expect(client.search("json", undefined)).rejects.toThrow();
      const [, options] = request.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(options.body as string)).toEqual({ query: "json", schemaVersion: 1, runtimeId: binding.runtimeId, sessionId: binding.sessionId });
    }
  });

  it("warns explicitly for legacy overflow and preserves exact snapshot byte boundaries", async () => {
    const candidate = tool();
    const base = Buffer.byteLength(JSON.stringify([candidate]), "utf8");
    candidate.description += "x".repeat(MAX_PLUGIN_BYTES - base);
    const exact = JSON.stringify([candidate]);
    expect(Buffer.byteLength(exact)).toBe(MAX_PLUGIN_BYTES);
    expect(readPluginTools(exact).status).toBe("ready");
    candidate.description += "x";
    expect(readPluginTools(JSON.stringify([candidate])).status).toBe("oversized");
    expect(readPluginTools(JSON.stringify(Array.from({ length: 129 }, (_, i) => tool(i)))).status).toBe("oversized");
    const on = vi.fn();
    setupPluginBroker({ registerTool: vi.fn(), on } as never, { ...environment, PI_DESKTOP_PLUGIN_CATALOG: undefined,
      PI_DESKTOP_PLUGIN_TOOLS: JSON.stringify(Array.from({ length: 129 }, (_, i) => tool(i))) });
    const notify = vi.fn();
    await on.mock.calls[0][1]({}, { ui: { notify } });
    expect(notify.mock.calls[0][0]).toContain("plugin_snapshot_oversized");
  });
});
