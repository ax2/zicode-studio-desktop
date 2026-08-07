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
