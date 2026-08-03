import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupFinanceTools } from "./finance/extension";
import { handlePicotConfig } from "./picot-config";
import projectTrust from "./project-trust";

type ConfigRequest = {
  id?: string;
  op?: string;
  params?: Record<string, unknown>;
};

export default function picotBridge(pi: ExtensionAPI) {
  projectTrust(pi);
  setupFinanceTools(pi);

  const scenePrompt = process.env.PI_DESKTOP_SCENE_PROMPT?.trim();
  if (scenePrompt) {
    pi.on("before_agent_start", (event) => ({
      systemPrompt: `${event.systemPrompt}\n\n## Active desktop scene\n\n${scenePrompt}`,
    }));
  }

  const allowedTools = parseAllowedTools(process.env.PI_DESKTOP_ALLOWED_TOOLS);
  if (allowedTools) {
    pi.on("tool_call", (event) => {
      if (allowedTools.has(event.toolName)) return;
      return {
        block: true,
        reason: `Tool "${event.toolName}" is disabled by the active desktop scene policy.`,
      };
    });
  }

  // Configuration data plane. Invoked by the WebView via a native RPC prompt
  // (`/picot-config <json>`); extension commands run immediately without
  // hitting the LLM or session history. The result is streamed back through
  // `ctx.ui.notify(JSON)` and correlated by request id on the frontend
  // (see public/native/config-gateway.js).
  pi.registerCommand("picot-config", {
    description: "ZiCode Studio Desktop Settings → Configuration data plane",
    handler: async (rawArguments, ctx) => {
      let request: ConfigRequest;
      try {
        request = JSON.parse(rawArguments) as ConfigRequest;
      } catch {
        return;
      }
      const id = typeof request.id === "string" ? request.id : "";
      if (!id) return;
      const respond = (payload: Record<string, unknown>) => {
        ctx.ui.notify(JSON.stringify({ __picotConfig: id, ...payload }), "info");
      };
      const op = typeof request.op === "string" ? request.op : "";
      const params = request.params && typeof request.params === "object" ? request.params : {};
      try {
        const result = await handlePicotConfig(op, params, ctx);
        respond(result as unknown as Record<string, unknown>);
      } catch (error) {
        respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}

function parseAllowedTools(value: string | undefined): Set<string> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((tool) => typeof tool !== "string")) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    return new Set();
  }
}
