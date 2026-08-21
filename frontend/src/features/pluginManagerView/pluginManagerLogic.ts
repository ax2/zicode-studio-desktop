export type PluginManagerFilter =
  | "installed"
  | "builtIn"
  | "disabled"
  | "developer"
  | "signed";

export interface ManagedPlugin {
  id: string;
  name: string;
  description: string;
  icon?: string;
  origin?: "builtIn" | "developer" | "signed";
  core?: boolean;
  enabled?: boolean;
  publisher?: string;
  publisherKeyId?: string;
  retainedVersions?: string[];
  permissions?: Record<string, boolean>;
  permissionDetails?: {
    required?: Array<{ name: string; reason?: string }>;
    optional?: Array<{ name: string; reason?: string }>;
  };
}

export function matchesFilter(
  plugin: ManagedPlugin,
  filter: PluginManagerFilter,
): boolean {
  if (filter === "builtIn") return plugin.origin === "builtIn";
  if (filter === "developer") return plugin.origin === "developer";
  if (filter === "signed") return plugin.origin === "signed";
  if (filter === "disabled") return !plugin.enabled;
  return true;
}

export const MANAGER_FILTERS: Array<{ id: PluginManagerFilter; label: string }> = [
  { id: "installed", label: "Installed" },
  { id: "builtIn", label: "Built-in" },
  { id: "disabled", label: "Disabled" },
  { id: "developer", label: "Developer" },
  { id: "signed", label: "Signed" },
];

/**
 * Map a built-in plugin to the Help center page that explains how to use it.
 * Plugins without a dedicated article return null and hide the guide button.
 */
export function helpPageForPlugin(pluginId: string): string | null {
  const pages: Record<string, string> = {
    "com.zicode.projects": "projects-tasks",
    "com.zicode.tasks": "projects-tasks",
    "com.zicode.automation": "projects-tasks",
    "com.zicode.notes": "notes",
    "com.zicode.finance": "finance",
    "com.zicode.graph": "notes",
    "com.zicode.translate": "translate",
    "com.zicode.idphoto": "idphoto",
    "com.zicode.imagetools": "imagetools",
    "com.zicode.clipboard": "clipboard",
    "com.zicode.documents": "documents",
    "com.zicode.artifacts": "artifacts",
    "com.zicode.articles": "articles",
    "com.zicode.inbox": "inbox",
  };
  return pages[pluginId] ?? null;
}
