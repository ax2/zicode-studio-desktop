import { toolCategoryName } from "./tool-category-title.js";

export const TOOL_CENTER_ID = "core.tools";
export const PRIMARY_ACTIVITY_IDS = Object.freeze([
  "core.chat", "com.zicode.projects", "com.zicode.tasks", "com.zicode.notes",
  TOOL_CENTER_ID, "com.zicode.automation",
]);

export function primaryActivities(plugins, isAvailable) {
  const byId = new Map(plugins.map(plugin => [plugin.id, plugin]));
  return PRIMARY_ACTIVITY_IDS.flatMap(id => {
    if (id === TOOL_CENTER_ID) return [{ id, name: "Tools", description: "Applications and tools", icon: "plugins" }];
    const plugin = byId.get(id);
    return plugin?.enabled && isAvailable(plugin) ? [plugin] : [];
  });
}

const APPLICATION_CATEGORIES = {
  "com.zicode.projects": "Projects and code", "com.zicode.tasks": "Projects and code",
  "core.chat": "Projects and code", "com.zicode.automation": "Projects and code",
  "com.zicode.notes": "Knowledge and documents", "com.zicode.documents": "Knowledge and documents",
  "com.zicode.articles": "Knowledge and documents", "com.zicode.graph": "Knowledge and documents",
  "com.zicode.idphoto": "Images and media", "com.zicode.imagetools": "Images and media",
  "com.zicode.ocr": "Images and media", "com.zicode.translate": "Text and language",
  "com.zicode.clipboard": "Text and language", "com.zicode.finance": "Personal applications",
  "com.zicode.habits": "Personal applications", "com.zicode.watch": "Personal applications",
  "com.zicode.artifacts": "Knowledge and documents",
};

export function isDirectoryApplication(plugin) {
  if (plugin.origin === "developer" || plugin.origin === "signed") {
    return plugin.views?.some(view => view.location === "main") ?? false;
  }
  return plugin.hasActivity !== false;
}

// Metadata only: never load a view or execute a capability while enumerating.
export function applicationDirectory(plugins, isAvailable, translate, openPlugin) {
  return plugins.filter(plugin => isAvailable(plugin) &&
    (plugin.enabled || plugin.origin === "developer" || plugin.origin === "signed") &&
    isDirectoryApplication(plugin))
    .map(plugin => ({
      id: `${plugin.id}:open`,
      label: translate(plugin.name),
      desc: translate(plugin.appDirectory?.description ?? plugin.description ?? ""),
      category: plugin.appDirectory?.categoryId
        ? toolCategoryName(plugin.appDirectory.categoryId)
        : APPLICATION_CATEGORIES[plugin.id] ?? "Other applications",
      source: plugin.publisher ?? plugin.id,
      disabled: !plugin.enabled,
      keywords: [plugin.id, plugin.publisher, ...(plugin.appDirectory?.aliases ?? []),
        ...(plugin.capabilities ?? []).flatMap(cap => [cap.id, cap.title])]
        .filter(value => typeof value === "string"),
      action: plugin.enabled ? () => openPlugin(plugin.id) : undefined,
    }));
}
