export const MAX_PLUGIN_TOOLS = 128;
export const MAX_PLUGIN_BYTES = 256 * 1024;

export type PluginToolSnapshot = {
  pluginId: string;
  name: string;
  title: string;
  description: string;
  capability: string;
  inputSchema: Record<string, unknown>;
};

export function isPluginToolSnapshot(value: unknown): value is PluginToolSnapshot {
  if (!value || typeof value !== "object") return false;
  const tool = value as Record<string, unknown>;
  return typeof tool.pluginId === "string" && typeof tool.name === "string" &&
    /^[a-z0-9_]{1,64}$/.test(tool.name) && typeof tool.title === "string" &&
    typeof tool.description === "string" && typeof tool.capability === "string" &&
    !!tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema) &&
    (tool.inputSchema as Record<string, unknown>).type === "object";
}

export function readPluginTools(value: string | undefined): {
  status: "ready" | "empty" | "oversized" | "invalid";
  tools: PluginToolSnapshot[];
} {
  if (!value) return { status: "empty", tools: [] };
  if (Buffer.byteLength(value, "utf8") > MAX_PLUGIN_BYTES) return { status: "oversized", tools: [] };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return { status: "invalid", tools: [] };
    if (parsed.length > MAX_PLUGIN_TOOLS) return { status: "oversized", tools: [] };
    if (!parsed.every(isPluginToolSnapshot) || new Set(parsed.map(tool => tool.name)).size !== parsed.length) {
      return { status: "invalid", tools: [] };
    }
    return { status: parsed.length ? "ready" : "empty", tools: parsed };
  } catch { return { status: "invalid", tools: [] }; }
}

export function pluginToolId(tool: PluginToolSnapshot): string {
  return JSON.stringify([tool.pluginId, tool.capability]);
}
