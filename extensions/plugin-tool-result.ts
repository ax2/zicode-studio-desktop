import type { PluginInvokeEnvelope } from "./plugin-invoke-client";
import type { PluginToolSnapshot } from "./plugin-tool-snapshot";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pluginToolResult(response: PluginInvokeEnvelope, tool: PluginToolSnapshot) {
  const value = response.result;
  const reference = response.resultRef;
  const failed = value && typeof value === "object" && !Array.isArray(value) &&
    (value as { ok?: unknown }).ok === false;
  const usable = reference && typeof reference === "object" && !Array.isArray(reference) &&
    UUID.test(String((reference as { resultId?: unknown }).resultId ?? "")) &&
    ((reference as { schemaVersion?: unknown }).schemaVersion === 1 &&
      (reference as { mimeType?: unknown }).mimeType === "text/plain" ||
      (reference as { schemaVersion?: unknown }).schemaVersion === 2 &&
      (reference as { mimeType?: unknown }).mimeType === "application/json");
  const details = !failed && usable && value && typeof value === "object" && !Array.isArray(value)
    ? { ...value, studioResult: { resultRef: reference, pluginId: tool.pluginId,
      capabilityId: tool.capability } }
    : value;
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details,
    ...(failed ? { isError: true } : {}) };
}
