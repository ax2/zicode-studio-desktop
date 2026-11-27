import type { ToolField } from "./manual-tool-fields";
import type { ToolFileTarget } from "./manual-tool-file";

export const springConfigFileTargets = [
  { target: "spring-config-baseline", field: "text", label: "Import baseline configuration…",
    inputLabel: "Baseline configuration file", fieldLabel: "Baseline configuration" },
  { target: "spring-config-comparison", field: "secondary", label: "Import comparison configuration…",
    inputLabel: "Comparison configuration file", fieldLabel: "Comparison configuration" },
] as const satisfies ReadonlyArray<{ target: ToolFileTarget; field: string; label: string; inputLabel: string; fieldLabel: string }>;

export function supportsSpringConfigFiles(
  tool: { pluginId: string; version: string; capabilityId: string }, fields: readonly ToolField[],
) {
  if (tool.pluginId !== "com.zicode.devtools.diagnostics" || tool.version !== "0.1.4" ||
      tool.capabilityId !== "devtools.diagnostics.spring.config" || fields.length !== 2) return false;
  return fields.every(field => field.kind === "string" && field.maxLength === 8192 && !field.choices &&
    ((field.key === "text" && field.required) || (field.key === "secondary" && !field.required)));
}
