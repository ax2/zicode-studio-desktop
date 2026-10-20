import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { ToolInputValue } from "./tool-json-input";

export interface ManualCallScope extends ToolAccessScope { pluginId: string; capabilityId: string }
export interface ManualCallRequest extends ManualCallScope {
  input: Record<string, ToolInputValue>;
  catalogRevision: string;
  captureResult?: boolean;
}
export interface ManualCallStatus {
  schemaVersion: number; profile: string;
  status: "prepared" | "running" | "cancel_requested" | "finished";
  executionFinished: boolean; outcome: string | null;
}
export interface ManualCallApi {
  callProtocol(): Promise<{ schemaVersion: number; profile: string; prepareRequired: boolean; runtimes: string[]; reconcileProfile?: string }>;
  prepareCall(request: ManualCallRequest): Promise<{ schemaVersion: number; profile: string; callId: string; hostInstanceId?: string }>;
  cancelCall(scope: ManualCallScope, callId: string): Promise<ManualCallStatus>;
  callStatus(scope: ManualCallScope, callId: string): Promise<ManualCallStatus>;
  reconcileCall?(scope: ManualCallScope, callId: string, hostInstanceId: string): Promise<ManualCallStatus & { callId: string; hostInstanceId: string }>;
}
export const manualCallProfile = "manual.tool.call.v1";
export const validCallStatus = (status: ManualCallStatus) => status?.schemaVersion === 1 && status.profile === manualCallProfile &&
  ["prepared", "running", "cancel_requested", "finished"].includes(status.status) &&
  status.executionFinished === (status.status === "finished") &&
  (status.status === "finished"
    ? typeof status.outcome === "string" && status.outcome.length > 0 && status.outcome.length <= 128
    : status.outcome === null);
