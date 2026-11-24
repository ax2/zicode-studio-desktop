import type { ManualTool, ToolOpenRequest } from "./manual-tools";

export type WorkbenchDraftReader = () => Record<string, string> | null;

export function isWorkbenchDraftTool(tool: ManualTool): boolean {
  return (
    tool.pluginId === "com.zicode.devtools.compute" &&
    tool.version === "0.2.0" &&
    tool.runtime === "wasi" &&
    tool.enabled &&
    /^devtools\.compute\.table\.(json|csv|query)$/.test(tool.capabilityId)
  );
}

export function snapshotWorkbenchDraft(
  values: Record<string, string>,
): Record<string, string> | null {
  const { text, options } = values;
  if (!text?.length && !options?.length) return null;
  const bytes = new TextEncoder();
  if (
    (text !== undefined && (text.length > 8192 || bytes.encode(text).length > 8192)) ||
    (options !== undefined && (options.length > 16384 || bytes.encode(options).length > 16384))
  )
    return null;
  return {
    ...(text === undefined ? {} : { text }),
    ...(options === undefined ? {} : { options }),
  };
}

export type KeptWorkbenchDrafts = Map<string, ToolOpenRequest & { values: Record<string, string> }>;

export function findWorkbenchDraft(drafts: KeptWorkbenchDrafts, target: ToolOpenRequest) {
  if (!isWorkbenchDraftTool(target.tool)) return undefined;
  const id = target.tool.capabilityId;
  const saved = drafts.get(id);
  if (saved && (saved.tool.toolId !== target.tool.toolId || saved.revision !== target.revision)) {
    drafts.delete(id);
    return undefined;
  }
  return saved;
}
