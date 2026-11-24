export interface ResultScope {
  sceneId: string; workspaceId: string; pluginId: string; capabilityId: string;
}
type ResultExportDescriptor = { mimeType: string; contentVersion: string; byteLength: number };
type ResultExportSource = { scope: ResultScope; resultId: string; format?: "png" | "csv" };

export interface CapturedToolResponse {
  result: unknown;
  operation?: string;
  resultRef?: { resultId: string; schemaVersion?: number; mimeType?: string; contentVersion?: string; byteLength?: number; pngExport?: ResultExportDescriptor; csvExport?: ResultExportDescriptor };
  resultCaptureError?: { code: string };
  replayed?: boolean;
}
export interface ResultActionsGateway {
  textExports?: {
    choose(workspaceId: string, source: ResultExportSource): Promise<unknown>;
    commit(workspaceId: string, source: ResultExportSource, grantId: string): Promise<unknown>;
    cancel(workspaceId: string, source: ResultExportSource, grantId: string): Promise<unknown>;
    verify(workspaceId: string, source: ResultExportSource, grantId: string): Promise<unknown>;
  } | null;
  prepareSave(scope: ResultScope, resultId: string, title: string): Promise<unknown>;
  commitSave(scope: ResultScope, grantId: string): Promise<unknown>;
  saveStatus?(scope: ResultScope, grantId: string): Promise<{ schemaVersion: number; status: "saved" | "unknown"; artifactId?: string }>;
  searchTargets(scope: ResultScope, resultId: string, query?: string, offset?: number, revision?: string | null, options?: { view?: "all" | "favorites" | "recent"; accessRevision?: number | null; pluginId?: string; categoryId?: string; signal?: AbortSignal }): Promise<unknown>;
  prepareTransfer(scope: ResultScope, resultId: string, target: { pluginId: string; capabilityId: string }, field: string, inputs?: Record<string, string>): Promise<unknown>;
  commitTransfer(scope: ResultScope, grantId: string): Promise<unknown>;
  cancelTransfer(scope: ResultScope, grantId: string): Promise<{ schemaVersion: number; status: "cancelled" | "cancellation_requested" | "completed" }>;
  transferStatus(scope: ResultScope, grantId: string): Promise<{ schemaVersion: number; status: "ready" | "running" | "cancellation_requested" | "cancelled" | "completed"; response?: CapturedToolResponse }>;
}
export function createPluginResultActions(options: {
  container: HTMLElement; gateway: ResultActionsGateway;
  isCurrent(scope?: ResultScope): boolean;
  sourceResultDisplayed?: boolean;
  onReceiverExecuted?(scope: ResultScope): void | Promise<void>;
  onOpenSaved?(artifactId: string, scope: ResultScope): void;
}): { show(response: CapturedToolResponse, scope: ResultScope): void; clear(): void; destroy(): void };
