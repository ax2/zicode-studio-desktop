import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { WorkbenchDraft } from "./data-workbench-apply";
import { prepareToolInput, toolFields } from "./manual-tool-fields";
import type { ManualTool, ManualToolApi, ToolOpenRequest } from "./manual-tools";

const compute = "com.zicode.devtools.compute";
const version = "0.2.0";
const prefix = "devtools.compute.table.";
const budget = 8192;

export const workbenchDraftReceivers = [
  { id: "json", title: "Table to JSON" },
  { id: "csv", title: "Table to CSV" },
] as const;

export type WorkbenchDraftReceiver = (typeof workbenchDraftReceivers)[number]["id"];
export type WorkbenchTableMaterial = Pick<WorkbenchDraft, "text" | "format">;
export type OpenWorkbenchDraft = (
  target: WorkbenchDraftReceiver,
  material: WorkbenchTableMaterial,
  isCurrent: () => boolean,
) => Promise<void>;

export async function resolveWorkbenchDraftReceiver(
  api: ManualToolApi,
  scope: ToolAccessScope,
  source: ToolOpenRequest,
  receiver: WorkbenchDraftReceiver,
  material: WorkbenchTableMaterial,
): Promise<ToolOpenRequest & { values: Record<string, string> }> {
  const targetId = prefix + receiver;
  if (
    source.tool.pluginId !== compute ||
    source.tool.version !== version ||
    !source.tool.enabled ||
    source.tool.runtime !== "wasi" ||
    !["json", "csv", "query"].some((mode) => source.tool.capabilityId === prefix + mode) ||
    source.tool.capabilityId === targetId ||
    !workbenchDraftReceivers.some((choice) => choice.id === receiver) ||
    !["json", "csv", "tsv"].includes(material.format) ||
    !material.text.trim() ||
    material.text.length > budget ||
    new TextEncoder().encode(material.text).length > budget
  )
    throw new Error("capability_unavailable");

  const page = await api.searchTools(scope.sceneId, {
    query: targetId,
    pluginId: compute,
    offset: 0,
    revision: null,
  });
  if (page.revision !== source.revision) throw new Error("catalog_changed");
  const target = page.items.find(
    (item): item is ManualTool =>
      item.kind !== "view-operation" &&
      item.pluginId === compute &&
      item.capabilityId === targetId &&
      item.enabled &&
      item.version === version &&
      item.runtime === "wasi",
  );
  if (!target) throw new Error("capability_unavailable");

  const detail = await api.loadTool(scope.sceneId, {
    pluginId: compute,
    capabilityId: targetId,
    revision: page.revision,
  });
  if (detail.revision !== page.revision) throw new Error("catalog_changed");
  const fields = toolFields(detail.capability.inputSchema);
  const values = { text: material.text, options: JSON.stringify({ format: material.format }) };
  const prepared = fields && prepareToolInput(fields, values);
  if (
    !prepared ||
    detail.pluginId !== compute ||
    detail.version !== version ||
    !detail.enabled ||
    detail.capability.id !== targetId ||
    detail.resourceInputProfile ||
    detail.permissions.some(
      (permission) => permission.required && permission.name !== "pi.tools.register",
    ) ||
    "error" in prepared ||
    prepared.input.text !== values.text ||
    prepared.input.options !== values.options
  )
    throw new Error("capability_unavailable");
  return { tool: target, revision: page.revision, values };
}
