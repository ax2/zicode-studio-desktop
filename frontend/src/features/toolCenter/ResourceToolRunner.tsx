import { useEffect, useRef } from "react";
// @ts-expect-error trusted parent controller is plain JavaScript
import { createDirectoryResourceRunner } from "../../../../public/native/plugins/directory-resource-runner.js";
import type { ToolAccessScope, ToolAccessStore } from "../commandPalette/tool-access";
import type { ManualTool, ManualToolApi, ToolDetail } from "./manual-tools";
import type { ResourceSessionOwner } from "./resource-session-owner";

export interface ResourceRuntimeTarget { instanceId?: string; sessionId?: string; workspaceId?: string; sceneId?: string }
export type ResourceTargetProvider = () => ResourceRuntimeTarget | null;
export function ResourceToolRunner({ tool, detail, api, getTarget, scope, accessStore, onBusy, onRecentChange, session }: {
  tool: ManualTool; detail: ToolDetail; api: ManualToolApi; getTarget?: ResourceTargetProvider; scope: ToolAccessScope;
  accessStore?: ToolAccessStore; onBusy?(busy: boolean): void; onRecentChange?(): void;
  session?: ResourceSessionOwner;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onBusy, onRecentChange }); callbacks.current = { onBusy, onRecentChange };
  const signature = JSON.stringify(getTarget?.());
  const sceneId = scope.sceneId, workspaceId = scope.workspaceId;
  useEffect(() => {
    if (!host.current) return;
    let active = true, mounted = true;
    const currentTarget = () => {
      const target = getTarget?.();
      return JSON.stringify(target) === signature && target?.workspaceId === workspaceId && (target?.sceneId ?? "programming") === sceneId ? target : null;
    };
    const create = (container: HTMLDivElement) => {
    const runner = createDirectoryResourceRunner({ container, tool, detail, gateway: api, getTarget: currentTarget,
      onBusy: (busy: boolean) => { if (active) { session?.reportBusy(busy); if (mounted) callbacks.current.onBusy?.(busy); } },
      onSuccess: async () => {
        if (!active || !accessStore || !currentTarget()) return;
        await accessStore.mutate({ sceneId, workspaceId }, { kind: "recentRecord", id: tool.accessId });
        if (active) callbacks.current.onRecentChange?.();
      },
    });
    return { destroy() { active = false; runner.destroy(); } };
    };
    const element = session ? session.mount(host.current, create) : host.current;
    const standalone = session ? null : create(element);
    return () => { mounted = false; if (session) session.release(element); else standalone?.destroy(); callbacks.current.onBusy?.(false); };
  }, [api, tool, detail, getTarget, sceneId, workspaceId, accessStore, signature, session]);
  return <div className="directory-resource-tool" ref={host} />;
}
