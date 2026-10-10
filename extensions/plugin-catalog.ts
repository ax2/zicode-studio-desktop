import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type BrokerBinding, type CatalogLoaded, createCatalogClient } from "./plugin-catalog-client";
import { MAX_PLUGIN_BYTES, MAX_PLUGIN_TOOLS, type PluginToolSnapshot, pluginToolId } from "./plugin-tool-snapshot";

const SEARCH = "studio_plugin_search";
const LOAD = "studio_plugin_load";
const result = (details: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });

export function setupPluginCatalog(pi: ExtensionAPI, binding: BrokerBinding, request: typeof fetch,
  initial: PluginToolSnapshot[], register: (loaded: CatalogLoaded) => void): void {
  const client = createCatalogClient(binding, request);
  const owned = new Map(initial.map(tool => [pluginToolId(tool), { tool, revision: "" }]));
  // Pi's tool inspection APIs are unavailable during extension initialization.
  // Inspect collisions at load execution, after the real runtime is bound.
  pi.registerTool({ name: SEARCH, label: "Search installed plugin tools",
    description: "Search authorized local plugin tools. Returns summaries and a revision; use studio_plugin_load with a selected toolId and that revision before executing it. Continue pages with the same query and nextCursor.",
    parameters: Type.Object({ query: Type.String({ maxLength: 256 }), cursor: Type.Optional(Type.String({ maxLength: 1024 })) }),
    async execute(_id, input, signal) { return result(await client.search(input.query, input.cursor, signal)); },
  });
  let pending: Promise<void> = Promise.resolve();
  pi.registerTool({ name: LOAD, label: "Load a plugin tool",
    description: "Load one tool selected from studio_plugin_search. Preserves existing active tools. Catalog changes require a fresh search. Loading does not grant new permissions.",
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
        if (loaded.tool.name === SEARCH || loaded.tool.name === LOAD ||
          pi.getAllTools().some(tool => tool.name === loaded.tool.name && existing?.tool.name !== tool.name)) {
          throw new Error("[plugin_tool_name_collision] The plugin tool name belongs to another tool");
        }
        const next = new Map(owned);
        next.set(loaded.toolId, { tool: loaded.tool, revision: loaded.revision });
        const bytes = Buffer.byteLength(JSON.stringify([...next.values()].map(item => item.tool)), "utf8");
        if (next.size > MAX_PLUGIN_TOOLS || bytes > MAX_PLUGIN_BYTES) throw new Error("[plugin_tool_budget_exceeded] End this task or use a new session with a smaller plugin tool set");
        const active = pi.getActiveTools();
        if (!existing || existing.revision !== loaded.revision) register(loaded);
        pi.setActiveTools([...new Set([...active, loaded.tool.name])]);
        owned.set(loaded.toolId, { tool: loaded.tool, revision: loaded.revision });
        return result({ loaded: true, toolId: loaded.toolId, name: loaded.tool.name, revision: loaded.revision });
      } finally { resolve(); }
    },
  });
}
