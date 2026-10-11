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
  attempts?(scene: string, workspace: string, filters?: { query?: string; offset?: number; signal?: AbortSignal }): Promise<SaveAttemptPage>;
  list(scene: string, workspace: string, filters?: { query?: string; offset?: number; signal?: AbortSignal }): Promise<SavedOutputPage>;
  read(scene: string, workspace: string, item: SavedOutput, signal?: AbortSignal): Promise<ArrayBuffer>;
}
export interface SaveAttempt extends SavedOutput { publication: "observed" | "not_observed"; }
export interface SaveAttemptPage extends Omit<SavedOutputPage, "profile" | "items"> {
  profile: "resource.save.recovery.draft1"; items: SaveAttempt[];
}
export function validSaveAttemptPage(page: SaveAttemptPage, workspace: string, offset: number): boolean {
  return page?.schemaVersion === 1 && page.profile === "resource.save.recovery.draft1" && page.workspaceId === workspace &&
    page.offset === offset && page.pageSize === 40 && page.payloadsRead === false &&
    Number.isSafeInteger(page.total) && page.total >= 0 && page.total <= 128 &&
    Number.isSafeInteger(page.skippedEntries) && page.skippedEntries >= 0 && page.skippedEntries <= 128 &&
    page.hasMore === (offset + 40 < page.total) && Array.isArray(page.items) &&
    page.items.length === Math.min(40, Math.max(0, page.total - offset)) &&
    new Set(page.items.map(item => item.receipt?.saveId)).size === page.items.length &&
    page.items.every(item => validSavedOutput(item, workspace) && Number.isFinite(Date.parse(item.receipt.preparedAt)) &&
      ["observed", "not_observed"].includes(item.publication));
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
