export interface ResultScope {
  sceneId: string; workspaceId: string; pluginId: string; capabilityId: string;
}
export interface CapturedToolResponse {
  result: unknown;
  resultRef?: { resultId: string };
  resultCaptureError?: { code: string };
  replayed?: boolean;
}
export interface ResultActionsGateway {
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
  onReceiverExecuted?(scope: ResultScope): void | Promise<void>;
  onOpenSaved?(artifactId: string, scope: ResultScope): void;
}): { show(response: CapturedToolResponse, scope: ResultScope): void; clear(): void; destroy(): void };
