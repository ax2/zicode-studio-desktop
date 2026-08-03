import { describe, expect, it, vi } from "vitest";
import { parsePluginTools, setupPluginBroker } from "./plugin-broker";

const snapshot = JSON.stringify([
  {
    pluginId: "com.zicode.notes",
    name: "notes_search",
    title: "Search notes",
    description: "Search local notes",
    capability: "notes.search",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
]);

describe("plugin broker", () => {
  it("fails closed for malformed or unsafe snapshots", () => {
    expect(parsePluginTools("{broken")).toEqual([]);
    expect(
      parsePluginTools(
        JSON.stringify([
          {
            pluginId: "bad",
            name: "Not Safe",
            title: "",
            description: "",
            capability: "x",
            inputSchema: { type: "object" },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("registers the filtered snapshot and invokes Host with runtime identity", async () => {
    const registered: Array<Record<string, unknown>> = [];
    const pi = {
      registerTool(tool: Record<string, unknown>) {
        registered.push(tool);
      },
    };
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { matches: [] } }),
    }));
    setupPluginBroker(
      pi as never,
      {
        PI_DESKTOP_PLUGIN_HOST_ORIGIN: "http://127.0.0.1:57620",
        PI_DESKTOP_PLUGIN_BROKER_TOKEN: "secret-runtime-token",
        PI_DESKTOP_PLUGIN_RUNTIME_ID: "instance-1",
        PI_DESKTOP_PLUGIN_SESSION_ID: "session-1",
        PI_DESKTOP_PLUGIN_TOOLS: snapshot,
      },
      request as never,
    );
    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("notes_search");
    const execute = registered[0].execute as (
      id: string,
      input: unknown,
      signal: AbortSignal,
    ) => Promise<unknown>;
    const result = await execute("tool-call-1", { query: "roadmap" }, new AbortController().signal);
    expect(result).toMatchObject({ details: { matches: [] } });
    const [, options] = request.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer secret-runtime-token");
    expect(JSON.parse(options.body)).toMatchObject({
      runtimeId: "instance-1",
      sessionId: "session-1",
      toolCallId: "tool-call-1",
      toolName: "notes_search",
      input: { query: "roadmap" },
    });
  });
});
