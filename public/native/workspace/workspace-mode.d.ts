export const MULTI_PROJECT_UI_ENABLED: boolean;
export function isWorkspaceApplicationVisible(pluginId: string): boolean;
export function resolveDefaultWorkspacePath(fallback?: string): Promise<string>;
export function isWorkspaceEntryVisible(entryId: string): boolean;
