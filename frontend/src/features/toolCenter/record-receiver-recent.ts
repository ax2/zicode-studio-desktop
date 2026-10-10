import type { ResultScope } from "../../../../public/native/plugins/plugin-result-actions.js";
import type { ToolAccessStore } from "../commandPalette/tool-access";

/** Matches the Host directory's manual.tool:SHA256(JSON([pluginId, capabilityId])). */
export async function recordReceiverRecent(scope: ResultScope, store: ToolAccessStore,
  isCurrent: () => boolean, onRecentChange?: () => void) {
  if (!isCurrent()) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([scope.pluginId, scope.capabilityId])));
  if (!isCurrent()) return;
  const id = `manual.tool:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
  await store.mutate({ sceneId: scope.sceneId, workspaceId: scope.workspaceId }, { kind: "recentRecord", id });
  if (isCurrent()) onRecentChange?.();
}
