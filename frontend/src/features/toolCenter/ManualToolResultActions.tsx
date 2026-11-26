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
    let pendingCommits = 0;
    const commit = async (action: () => Promise<unknown>, signal?: AbortSignal) => {
      if (++pendingCommits === 1) busyCallback.current(true);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (--pendingCommits === 0 && active) busyCallback.current(false);
      };
      signal?.addEventListener("abort", release, { once: true });
      try { return await action(); }
      finally {
        signal?.removeEventListener("abort", release);
        release();
      }
    };
    const nativeExports = gateway.textExports;
    const actions = createPluginResultActions({
      container: container.current,
      sourceResultDisplayed: true,
      gateway: {
        prepareSave: (...args) => gateway.prepareSave(...args),
        commitSave: (...args) => commit(() => gateway.commitSave(...args)),
        ...(nativeExports ? { textExports: {
          ...nativeExports,
          commit: (...args) => commit(() => nativeExports.commit(...args)),
        } } : {}),
        ...(gateway.saveStatus ? { saveStatus: gateway.saveStatus.bind(gateway) } : {}),
        searchTargets: (...args) => gateway.searchTargets(...args),
        prepareTransfer: (...args) => gateway.prepareTransfer(...args),
        commitTransfer: (...args) => commit(() => gateway.commitTransfer(...args), args[2]?.signal),
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
