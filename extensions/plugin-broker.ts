import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_TOOLS = 128;

export type PluginToolSnapshot = {
  pluginId: string;
  name: string;
  title: string;
  description: string;
  capability: string;
  inputSchema: Record<string, unknown>;
};

export function parsePluginTools(value: string | undefined): PluginToolSnapshot[] {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_SNAPSHOT_BYTES) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > MAX_TOOLS) return [];
    return parsed.filter(isPluginToolSnapshot);
  } catch {
    return [];
  }
}

function isPluginToolSnapshot(value: unknown): value is PluginToolSnapshot {
  if (!value || typeof value !== "object") return false;
  const tool = value as Record<string, unknown>;
  return (
    typeof tool.pluginId === "string" &&
    typeof tool.name === "string" &&
    /^[a-z0-9_]{1,64}$/.test(tool.name) &&
    typeof tool.title === "string" &&
    typeof tool.description === "string" &&
    typeof tool.capability === "string" &&
    !!tool.inputSchema &&
    typeof tool.inputSchema === "object" &&
    !Array.isArray(tool.inputSchema) &&
    (tool.inputSchema as Record<string, unknown>).type === "object"
  );
}

export function setupPluginBroker(
  pi: ExtensionAPI,
  environment: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): void {
  const origin = environment.PI_DESKTOP_PLUGIN_HOST_ORIGIN?.trim();
  const token = environment.PI_DESKTOP_PLUGIN_BROKER_TOKEN?.trim();
  const runtimeId = environment.PI_DESKTOP_PLUGIN_RUNTIME_ID?.trim();
  const sessionId = environment.PI_DESKTOP_PLUGIN_SESSION_ID?.trim();
  const tools = parsePluginTools(environment.PI_DESKTOP_PLUGIN_TOOLS);
  if (!origin || !token || !runtimeId || !sessionId || tools.length === 0) return;

  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.title || tool.name,
      description: tool.description,
      parameters: Type.Unsafe(tool.inputSchema),
      async execute(toolCallId, input, signal) {
        const response = await request(`${origin}/v2/plugin-tools/invoke`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            runtimeId,
            sessionId,
            toolCallId,
            toolName: tool.name,
            input,
          }),
          signal,
        });
        const payload = (await response.json().catch(() => null)) as {
          result?: unknown;
          error?: { code?: string; message?: string };
        } | null;
        if (!response.ok || !payload || !("result" in payload)) {
          const code = payload?.error?.code || `http_${response.status}`;
          const message = payload?.error?.message || "Plugin capability call failed";
          throw new Error(`[${code}] ${message}`);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload.result) }],
          details: payload.result,
        };
      },
    });
  }
}

export default function pluginBroker(pi: ExtensionAPI): void {
  setupPluginBroker(pi);
}
