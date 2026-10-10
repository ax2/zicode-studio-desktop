export interface SavedOutput {
  receiptVersion: string;
  integrity: "not_checked";
  receipt: {
    schemaVersion: 1; profile: "resource.save.draft1"; saveId: string; workspaceId: string;
    relativePath: string; mimeType: string; byteLength: number; contentVersion: string; preparedAt: string;
    source: { pluginId: string; capabilityId: string; resourceId: string; packageVersion: string };
  };
}
export interface SavedOutputPage {
  schemaVersion: 1; profile: "resource.library.draft1"; workspaceId: string; items: SavedOutput[];
  total: number; offset: number; pageSize: 40; hasMore: boolean; skippedEntries: number; payloadsRead: false;
}
export interface SavedOutputGateway {
  list(scene: string, workspace: string, filters?: { query?: string; offset?: number; signal?: AbortSignal }): Promise<SavedOutputPage>;
  read(scene: string, workspace: string, item: SavedOutput, signal?: AbortSignal): Promise<ArrayBuffer>;
}
export function validSavedOutput(item: SavedOutput, workspace: string): boolean {
  const r = item?.receipt;
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/plain": "txt", "application/octet-stream": "bin" }[r?.mimeType];
  return !!extension && r.schemaVersion === 1 && r.profile === "resource.save.draft1" && r.workspaceId === workspace &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(r.saveId) && r.relativePath === `.zicode/outputs/${r.saveId}/result.${extension}` &&
    Number.isSafeInteger(r.byteLength) && r.byteLength >= 0 && r.byteLength <= 32 * 1024 * 1024 &&
    /^[0-9a-f]{64}$/.test(r.contentVersion) && /^[0-9a-f]{64}$/.test(item.receiptVersion) && item.integrity === "not_checked" &&
    [r.source?.pluginId, r.source?.capabilityId, r.source?.resourceId, r.source?.packageVersion].every(value => typeof value === "string" && value.length > 0 && value.length <= 256);
}
