import { useEffect, useRef } from "react";
import { createPluginResultActions, type CapturedToolResponse, type ResultActionsGateway, type ResultScope } from "../../../../public/native/plugins/plugin-result-actions.js";
import type { ToolAccessStore } from "../commandPalette/tool-access";
import { recordReceiverRecent } from "./record-receiver-recent";

// Reuse Studio's trusted parent controller and Host-issued one-use grants.
// React owns the container; the controller owns its contents and late-response guards.
export function ManualToolResultActions({ response, scope, gateway, onBusy, accessStore, onRecentChange }: {
  response: CapturedToolResponse; scope: ResultScope; gateway: ResultActionsGateway;
  onBusy(busy: boolean): void;
  accessStore?: ToolAccessStore; onRecentChange?(): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const recentCallback = useRef(onRecentChange);
  recentCallback.current = onRecentChange;
  const { sceneId, workspaceId, pluginId, capabilityId } = scope;
  useEffect(() => {
    if (!container.current) return;
    let active = true;
    const commit = async (kind: "commitSave" | "commitTransfer", owner: ResultScope, grantId: string) => {
      busyCallback.current(true);
      try { return await gateway[kind](owner, grantId); }
      finally { if (active) busyCallback.current(false); }
    };
    const actions = createPluginResultActions({
      container: container.current,
      gateway: {
        prepareSave: (...args) => gateway.prepareSave(...args),
        commitSave: (...args) => commit("commitSave", ...args),
        ...(gateway.saveStatus ? { saveStatus: gateway.saveStatus.bind(gateway) } : {}),
        searchTargets: (...args) => gateway.searchTargets(...args),
        prepareTransfer: (...args) => gateway.prepareTransfer(...args),
        commitTransfer: (...args) => commit("commitTransfer", ...args),
        cancelTransfer: (...args) => gateway.cancelTransfer(...args),
        transferStatus: (...args) => gateway.transferStatus(...args),
      },
      isCurrent: candidate => active && candidate?.sceneId === sceneId && candidate.workspaceId === workspaceId,
      onReceiverExecuted: accessStore ? receiver => recordReceiverRecent(receiver, accessStore, () => active,
        () => recentCallback.current?.()) : undefined,
    });
    actions.show(response, { sceneId, workspaceId, pluginId, capabilityId });
    return () => { active = false; actions.destroy(); };
  }, [response, sceneId, workspaceId, pluginId, capabilityId, gateway, accessStore]);
  return <div ref={container} />;
}
