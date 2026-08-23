import { t } from "../../shared/i18n";

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
    "com.zicode.ocr": "ocr",
    "com.zicode.watch": "watch",
    "com.zicode.habits": "habits",
  };
  return pages[pluginId] ?? null;
}

/**
 * Map raw Rust errors from plugin package commands to friendly localized
 * messages so users see understandable feedback instead of internal strings.
 */
export function friendlyPluginError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const fallbacks: Array<[RegExp, string]> = [
    [
      /must use the \.zicode-plugin extension/i,
      t("Choose a .zicode-plugin package file."),
    ],
    [
      /no larger than (50 MiB|10 MiB)|exceeds 50 MiB|exceeds 10 MiB|expands beyond/i,
      t("The plugin package is too large."),
    ],
    [
      /not a valid ZIP|invalid SHA-256|hash mismatch|invalid size|missing one or more declared files|invalid file count/i,
      t("The plugin package is damaged or incomplete."),
    ],
    [
      /manifest is invalid|publisher does not match|signature/i,
      t("The plugin package is not valid for this app (manifest or signature mismatch)."),
    ],
    [
      /staging destination already exists/i,
      t("Another install of this plugin is in progress. Try again in a moment."),
    ],
    [
      /cannot (resolve|inspect|open) signed plugin package/i,
      t("Could not read the plugin package."),
    ],
    [
      /cannot (select|resolve) plugin directory|not a directory/i,
      t("Please choose a plugin directory."),
    ],
    [
      /cannot create plugin registry directory/i,
      t("Could not access the plugin folder."),
    ],
  ];
  for (const [pattern, friendly] of fallbacks) {
    if (pattern.test(message)) return friendly;
  }
  return message;
}
