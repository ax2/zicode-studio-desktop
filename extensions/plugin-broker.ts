import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { setupPluginCatalog } from "./plugin-catalog";
import { createPluginInvokeEnvelopeClient } from "./plugin-invoke-client";
import { type PluginToolSnapshot, readPluginTools } from "./plugin-tool-snapshot";
import { pluginToolResult } from "./plugin-tool-result";

export type { PluginToolSnapshot } from "./plugin-tool-snapshot";

export function parsePluginTools(value: string | undefined): PluginToolSnapshot[] {
  return readPluginTools(value).tools;
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
  const snapshot = readPluginTools(environment.PI_DESKTOP_PLUGIN_TOOLS);
  const tools = snapshot.tools;
  if (!origin || !token || !runtimeId || !sessionId) return;
  const invoke = createPluginInvokeEnvelopeClient({ origin, token, runtimeId, sessionId }, request);

  const register = (tool: PluginToolSnapshot, proof?: { toolId: string; revision: string }) => {
    pi.registerTool({
      name: tool.name,
      label: tool.title || tool.name,
      description: tool.description,
      parameters: Type.Unsafe(tool.inputSchema),
      async execute(toolCallId, input, signal) {
        const result = await invoke(
          {
            toolCallId,
            toolName: tool.name,
            ...(proof ? { toolId: proof.toolId, catalogRevision: proof.revision } : {}),
            input,
            captureResult: true,
          },
          signal,
        );
        return pluginToolResult(result, tool);
      },
    });
  };
  for (const tool of tools) register(tool);
  if (environment.PI_DESKTOP_PLUGIN_CATALOG === "1") {
    setupPluginCatalog(pi, { origin, token, runtimeId, sessionId }, request, tools, (loaded) =>
      register(loaded.tool, { toolId: loaded.toolId, revision: loaded.revision }),
    );
  }
  if (snapshot.status === "oversized" || snapshot.status === "invalid") {
    pi.on?.("session_start", async (_event, context) => {
      context.ui.notify(
        `[plugin_snapshot_${snapshot.status}] ${
          environment.PI_DESKTOP_PLUGIN_CATALOG === "1"
            ? "Use studio_plugin_search to discover tools and load selected tools."
            : "Plugin startup tools could not be loaded. This Host needs the tool catalog protocol; repair or update the application."
        }`,
        "warning",
      );
    });
  }
}

export default function pluginBroker(pi: ExtensionAPI): void {
  setupPluginBroker(pi);
}
