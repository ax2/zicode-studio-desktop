import { useEffect, useRef } from "react";
// @ts-expect-error shared trusted parent controller is plain JavaScript
import { createResourceCallRecords } from "../../../../public/native/plugins/resource-call-records.js";
import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { ManualToolApi } from "./manual-tools";
import type { ResourceTargetProvider } from "./ResourceToolRunner";

export function ResourceCallRecords({ api, scope, getTarget }: {
  api: ManualToolApi; scope: ToolAccessScope; getTarget?: ResourceTargetProvider;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneId = scope.sceneId, workspaceId = scope.workspaceId;
  const signature = JSON.stringify(getTarget?.());
  useEffect(() => {
    if (!host.current || !api.resourceCalls || !api.reconcileResourceCall || !getTarget) return;
    const currentTarget = () => JSON.stringify(getTarget()) === signature ? getTarget() : null;
    const panel = createResourceCallRecords({ container: host.current, gateway: api, getTarget: currentTarget, scope: { sceneId, workspaceId } });
    return () => panel.destroy();
  }, [api, sceneId, workspaceId, getTarget, signature]);
  return <div ref={host} />;
}
