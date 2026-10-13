import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type BrokerBinding, type CatalogLoaded, createCatalogClient } from "./plugin-catalog-client";
import { createPluginInvokeClient } from "./plugin-invoke-client";
import { MAX_PLUGIN_BYTES, MAX_PLUGIN_TOOLS, type PluginToolSnapshot, pluginToolId } from "./plugin-tool-snapshot";

const SEARCH = "studio_plugin_search";
const LOAD = "studio_plugin_load";
const CALL = "studio_plugin_call";
const MAX_GENERIC_TOOL_IDS = 2048;
const result = (details: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });

export function setupPluginCatalog(pi: ExtensionAPI, binding: BrokerBinding, request: typeof fetch,
  initial: PluginToolSnapshot[], register: (loaded: CatalogLoaded) => void): void {
  const client = createCatalogClient(binding, request);
  const invoke = createPluginInvokeClient(binding, request);
  const owned = new Map(initial.map(tool => [pluginToolId(tool), { tool, revision: "" }]));
  const generic = new Map<string, { name: string; revision: string }>();
  // Pi's tool inspection APIs are unavailable during extension initialization.
  // Inspect collisions at load execution, after the real runtime is bound.
  pi.registerTool({ name: SEARCH, label: "Search installed plugin tools",
    description: "Search authorized local plugin tools. Returns summaries and a revision; use studio_plugin_load with a selected toolId and that revision before executing it. Continue pages with the same query and nextCursor.",
    parameters: Type.Object({ query: Type.String({ maxLength: 256 }), cursor: Type.Optional(Type.String({ maxLength: 1024 })) }),
    async execute(_id, input, signal) { return result(await client.search(input.query, input.cursor, signal)); },
  });
  pi.registerTool({ name: CALL, label: "Call a loaded plugin tool",
    description: "Execute a tool only after studio_plugin_load returns mode generic. Use its toolId, revision and inputSchema to prepare input. The Host checks current authorization and validates input again.",
    parameters: Type.Object({ toolId: Type.String({ maxLength: 1024 }),
      revision: Type.String({ minLength: 64, maxLength: 64 }),
      input: Type.Record(Type.String(), Type.Unknown()) }),
    async execute(toolCallId, input, signal) {
      const admitted = generic.get(input.toolId);
      if (!admitted || admitted.revision !== input.revision)
        throw new Error("[plugin_tool_not_loaded] Load this tool again before calling it");
      const current = await client.load(input.toolId, input.revision, signal);
      if (current.tool.name !== admitted.name)
        throw new Error("[plugin_tool_changed] Load the changed tool again before calling it");
      return result(await invoke({ toolCallId, toolName: current.tool.name,
        toolId: current.toolId, catalogRevision: current.revision, input: input.input }, signal));
    },
  });
  let pending: Promise<void> = Promise.resolve();
  pi.registerTool({ name: LOAD, label: "Load a plugin tool",
    description: "Load one tool selected from studio_plugin_search. Normally activates its typed tool. If the session tool budget is full, returns mode generic with inputSchema for studio_plugin_call. Loading does not grant permissions.",
    parameters: Type.Object({ toolId: Type.String({ maxLength: 1024 }), revision: Type.String({ minLength: 64, maxLength: 64 }) }),
    async execute(_id, input, signal) {
      const loaded = await client.load(input.toolId, input.revision, signal);
      // Loads can arrive concurrently; serialize registration and budget mutations without holding network requests.
      let resolve!: () => void;
      const previous = pending;
      pending = new Promise<void>(done => { resolve = done; });
      try {
        await previous;
        signal?.throwIfAborted();
        const existing = owned.get(loaded.toolId);
        if (existing && existing.tool.name !== loaded.tool.name) throw new Error("[plugin_tool_changed] Restart this session to replace a renamed plugin tool");
        if (loaded.tool.name === SEARCH || loaded.tool.name === LOAD || loaded.tool.name === CALL ||
          pi.getAllTools().some(tool => tool.name === loaded.tool.name && existing?.tool.name !== tool.name)) {
          throw new Error("[plugin_tool_name_collision] The plugin tool name belongs to another tool");
        }
        if ([...generic].some(([id, item]) => id !== loaded.toolId && item.name === loaded.tool.name))
          throw new Error("[plugin_tool_name_collision] The plugin tool name belongs to another tool");
        const next = new Map(owned);
        next.set(loaded.toolId, { tool: loaded.tool, revision: loaded.revision });
        const bytes = Buffer.byteLength(JSON.stringify([...next.values()].map(item => item.tool)), "utf8");
        if (next.size > MAX_PLUGIN_TOOLS || bytes > MAX_PLUGIN_BYTES) {
          if (generic.size >= MAX_GENERIC_TOOL_IDS && !generic.has(loaded.toolId))
            throw new Error("[plugin_tool_budget_exceeded] End this task or use a new session with a smaller plugin tool set");
          generic.set(loaded.toolId, { name: loaded.tool.name, revision: loaded.revision });
          return result({ loaded: false, mode: "generic", toolId: loaded.toolId, name: loaded.tool.name,
            revision: loaded.revision, inputSchema: loaded.tool.inputSchema, callTool: CALL });
        }
        const active = pi.getActiveTools();
        if (!existing || existing.revision !== loaded.revision) register(loaded);
        pi.setActiveTools([...new Set([...active, loaded.tool.name])]);
        owned.set(loaded.toolId, { tool: loaded.tool, revision: loaded.revision });
        generic.delete(loaded.toolId);
        return result({ loaded: true, toolId: loaded.toolId, name: loaded.tool.name, revision: loaded.revision });
      } finally { resolve(); }
    },
  });
}
