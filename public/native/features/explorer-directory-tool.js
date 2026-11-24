import { t } from "../../i18n.js";
import { isDiskInspector } from "../plugins/disk-inspector-result.js";

export async function openExplorerDirectoryTool({ entryMode, api, getTarget, openTool }) {
  const original = getTarget();
  if (original?.runtimeMode !== "tools" || await entryMode() !== "directoryUsage") return false;
  const current = () => {
    const target = getTarget();
    return target?.instanceId === original.instanceId && target?.sessionId === original.sessionId
      && target.workspaceId === original.workspaceId && target.sceneId === original.sceneId;
  };
  if (!current()) return true;
  const { sceneId, workspaceId } = original;
  const page = await api.searchTools(sceneId, { pluginId: "com.zicode.devtools.disk-inspector", directoryOnly: true });
  if (!current()) return true;
  const tool = page.items.find(item => item.enabled && isDiskInspector(item.pluginId, item.capabilityId));
  if (!tool) throw new Error(t("Install and enable Disk Inspector to analyze the folder selected in Explorer."));
  await openTool(tool, page.revision, { sceneId, workspaceId });
  return true;
}
