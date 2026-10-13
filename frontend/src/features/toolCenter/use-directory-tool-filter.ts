import { useEffect, useState } from "react";
import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { ManualToolApi } from "./manual-tools";

// Explorer folder intent narrows discovery only. Reading entries still needs
// the separate directory grant and user confirmation in the Host.
export function useDirectoryToolFilter(api: ManualToolApi, scope: ToolAccessScope, entryRevision = 0) {
  const key = JSON.stringify([scope.sceneId, scope.workspaceId, entryRevision]);
  const [state, setState] = useState({ key: "", ready: false, enabled: false, failed: false });
  const current = state.key === key ? state : {
    key, ready: typeof api.projectDirectories?.entry !== "function", enabled: false, failed: false,
  };
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entry = api.projectDirectories?.entry;
    function finish(enabled: boolean, failed: boolean) {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      setState({ key, ready: true, enabled, failed });
    }
    setState({ key, ready: typeof entry !== "function", enabled: false, failed: false });
    if (typeof entry === "function") {
      timer = setTimeout(() => finish(false, true), 5000);
      void Promise.resolve().then(() => entry(scope.workspaceId))
        .then(value => finish(value === ".", value !== null && value !== "."))
        .catch(() => finish(false, true));
    }
    return () => { active = false; clearTimeout(timer); };
  }, [api, key, scope.workspaceId]);
  return { ...current, setEnabled: (enabled: boolean) => setState({ ...current, enabled }) };
}
