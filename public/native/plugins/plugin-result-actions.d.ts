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
  searchTargets(scope: ResultScope, resultId: string, query?: string, offset?: number, revision?: string | null): Promise<unknown>;
  prepareTransfer(scope: ResultScope, resultId: string, target: { pluginId: string; capabilityId: string }, field: string, inputs?: Record<string, string>): Promise<unknown>;
  commitTransfer(scope: ResultScope, grantId: string): Promise<unknown>;
}
export function createPluginResultActions(options: {
  container: HTMLElement; gateway: ResultActionsGateway;
  isCurrent(scope?: ResultScope): boolean;
  onReceiverExecuted?(scope: ResultScope): void | Promise<void>;
}): { show(response: CapturedToolResponse, scope: ResultScope): void; clear(): void; destroy(): void };
