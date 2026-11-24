import type { ManualTool } from "./manual-tools";
import { readUtf8ToolFile } from "./manual-tool-file";
import { parseToolJson } from "./tool-json-input";
import { isWorkbenchDraftTool, snapshotWorkbenchDraft } from "./workbench-session-draft";

const draftType = "zicode-workbench-draft";
const schemaVersion = 1;
// Escaped control characters can need six bytes per original input byte.
const maxDraftFile = 160 * 1024;
const invalidDraft = "Choose a valid ZiCode workbench draft file.";
const oversizedDraft = "Workbench draft files must be 160 KiB or smaller.";

export function workbenchDraftFile(tool: ManualTool, values: Record<string, string>): string | null {
  if (!isWorkbenchDraftTool(tool)) return null;
  const inputs = snapshotWorkbenchDraft(values);
  return inputs ? JSON.stringify({
    type: draftType,
    schemaVersion,
    pluginId: tool.pluginId,
    capabilityId: tool.capabilityId,
    toolVersion: tool.version,
    inputs,
  }) + "\n" : null;
}

export async function readWorkbenchDraftFile(file: File, tool: ManualTool): Promise<Record<string, string>> {
  if (!isWorkbenchDraftTool(tool) || !file.name.toLowerCase().endsWith(".json")) throw Error(invalidDraft);
  const text = await readUtf8ToolFile(file, oversizedDraft, "Could not read the workbench draft file.", maxDraftFile);
  const decoded = parseToolJson(text, "object", maxDraftFile);
  if ("error" in decoded) throw Error(invalidDraft);
  const value = decoded.value;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 6 || value.type !== draftType || value.schemaVersion !== schemaVersion) {
    throw Error(invalidDraft);
  }
  if (value.pluginId !== tool.pluginId || value.capabilityId !== tool.capabilityId || value.toolVersion !== tool.version) {
    throw Error("This draft file belongs to a different tool or version.");
  }
  const inputs = value.inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || Object.entries(inputs).some(
    ([key, field]) => (key !== "text" && key !== "options") || typeof field !== "string",
  )) throw Error(invalidDraft);
  const draft = snapshotWorkbenchDraft(inputs as Record<string, string>);
  if (!draft) throw Error(invalidDraft);
  return draft;
}
