import { useEffect, useState } from "react";
import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { ManualToolApi } from "./manual-tools";

// File intent is metadata only. Detection and filtering never grant file access.
export function useFileToolFilter(api: ManualToolApi, scope: ToolAccessScope) {
  const key = JSON.stringify([scope.sceneId, scope.workspaceId]);
  const [state, setState] = useState({ key: "", ready: false, enabled: false, failed: false });
  const current =
    state.key === key
      ? state
      : {
          key,
          ready: typeof api.projectFiles?.entry !== "function",
          enabled: false,
          failed: false,
        };
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function finish(enabled: boolean, failed: boolean) {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      setState({ key, ready: true, enabled, failed });
    }
    const files = api.projectFiles;
    setState({ key, ready: typeof files?.entry !== "function", enabled: false, failed: false });
    if (typeof files?.entry === "function") {
      timer = setTimeout(() => finish(false, true), 5000);
      void Promise.resolve()
        .then(() => files.entry?.(scope.workspaceId))
        .then((value) => {
          finish(typeof value === "string" && value.length > 0, false);
        })
        .catch(() => {
          finish(false, true);
        });
    }
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, key, scope.workspaceId]);
  return { ...current, setEnabled: (enabled: boolean) => setState({ ...current, enabled }) };
}
