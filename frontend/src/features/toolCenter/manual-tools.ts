import type { CapturedToolResponse, ResultActionsGateway } from "../../../../public/native/plugins/plugin-result-actions.js";
import type { ManualCallApi } from "./manual-call-protocol";

export interface ManualTool {
  toolId: string; accessId: string; pluginId: string; capabilityId: string; title: string;
  applicationName: string; publisher: string; version: string; enabled: boolean; runtime: string;
  categoryId?: string; description?: string;
  fileInputMatch?: "declared" | "unknown" | null;
}
export type ToolDirectoryView = "all" | "favorites" | "recent";
export interface ToolOpenRequest { tool: ManualTool; revision: string }
export interface ToolSource { pluginId: string; title: string; count: number; enabled: boolean }
export interface ToolPage { items: ManualTool[]; total: number; revision: string; nextOffset: number | null; accessRevision?: number | null; sources?: ToolSource[]; categories?: { id: string; count: number }[] }
export interface ToolDetail {
  resourceInputProfile?: string | null;
  pluginId: string; version: string; revision: string; enabled: boolean;
  capability: { id: string; inputSchema: unknown; resourceInputMax?: number };
  permissions: { name: string; reason: string; required: boolean; granted: boolean }[];
}
export interface ManualToolApi extends Partial<ResultActionsGateway>, Partial<ManualCallApi> {
  projectFiles?: { entry?: ((workspaceId: string) => Promise<unknown>) | null;
    entries?: ((workspaceId: string) => Promise<unknown>) | null } | null;
  projectDirectories?: { choose?: ((workspaceId: string) => Promise<unknown>) | null; entry?: ((workspaceId: string) => Promise<unknown>) | null } | null;
  resourceCalls?: { list(scope: { sceneId: string; workspaceId: string }): Promise<unknown[]> };
  reconcileResourceCall?: (...args: unknown[]) => Promise<unknown>;
  searchTools(sceneId: string, options: { query: string; offset: number; revision: string | null;
    view?: ToolDirectoryView; workspaceId?: string; accessRevision?: number | null; pluginId?: string; categoryId?: string; resourceOnly?: boolean; directoryOnly?: boolean; fileName?: string }): Promise<ToolPage>;
  loadTool(sceneId: string, tool: { pluginId: string; capabilityId: string; revision: string }): Promise<ToolDetail>;
  invoke(sceneId: string, workspaceId: string, pluginId: string, capabilityId: string,
    input: Record<string, string | number | boolean>, options: { catalogRevision: string; captureResult?: boolean; callId?: string }): Promise<CapturedToolResponse>;
}
export function supportsResultActions(api: ManualToolApi): api is ManualToolApi & ResultActionsGateway {
  return [api.prepareSave, api.commitSave, api.searchTargets, api.prepareTransfer, api.commitTransfer].every(method => typeof method === "function");
}
export interface TextField { key: string; label: string; required: boolean; maxLength: number; minLength: number; choices?: string[] }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Deliberately reject schemas that need resource selection or custom UI. Host still validates every input.
export function textFields(schema: unknown): TextField[] | null {
  if (!record(schema) || schema.type !== "object" || !record(schema.properties)) return null;
  if (Object.keys(schema).some(key => !["type", "properties", "required", "additionalProperties", "title", "description", "$schema", "$id"].includes(key))) return null;
  // Identifiers and defaults are annotations: never fetch a URI or insert absent values.
  if (schema.$id !== undefined && typeof schema.$id !== "string") return null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const entries = Object.entries(schema.properties);
  if (entries.length > 16 || required.some(key => typeof key !== "string" || !(key in (schema.properties as object)))) return null;
  const fields: TextField[] = [];
  for (const [key, value] of entries) {
    if (!record(value) || value.type !== "string") return null;
    if (Object.keys(value).some(name => !["type", "title", "description", "default", "maxLength", "minLength", "enum"].includes(name))) return null;
    if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length > 40 || !value.enum.every(choice => typeof choice === "string"))) return null;
    const maximum = value.maxLength ?? 32768;
    const minimum = value.minLength ?? 0;
    if (!Number.isInteger(maximum) || !Number.isInteger(minimum) || Number(maximum) < 0 || Number(minimum) < 0 || Number(minimum) > Number(maximum)) return null;
    fields.push({ key, label: typeof value.title === "string" ? value.title : key, required: required.includes(key),
      maxLength: Math.min(Number(maximum), 32768), minLength: Number(minimum), choices: value.enum as string[] | undefined });
  }
  return fields;
}

export function manualToolError(error: unknown): string {
  const code = record(error) && typeof error.code === "string" ? error.code : "";
  if (["catalog_changed", "capability_changed"].includes(code)) return "Tool changed. Reload its details before retrying.";
  if (["worker_timeout", "plugin_capability_timeout"].includes(code)) return "Tool timed out. Its result is unavailable.";
  if (["permission_denied", "capability_unavailable", "plugin_disabled"].includes(code)) return "Tool is unavailable. Check plugin enablement and permissions.";
  return "Tool request failed. Reload and retry.";
}
