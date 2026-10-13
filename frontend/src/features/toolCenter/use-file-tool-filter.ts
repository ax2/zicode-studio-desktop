import { useEffect, useState } from "react";
import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { ManualToolApi } from "./manual-tools";

function validEntryName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\\/:]/u.test(value) &&
    ![...value].some((char) => char.charCodeAt(0) < 32 ||
      (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159));
}

// File intent is metadata only. Detection and filtering never grant file access.
export function useFileToolFilter(api: ManualToolApi, scope: ToolAccessScope, entryRevision = 0) {
  const key = JSON.stringify([scope.sceneId, scope.workspaceId, entryRevision]);
  const [state, setState] = useState({
    key: "",
    ready: false,
    enabled: false,
    failed: false,
    fileName: null as string | null,
  });
  const current =
    state.key === key
      ? state
      : {
          key,
          ready: typeof api.projectFiles?.entry !== "function" && typeof api.projectFiles?.entries !== "function",
          enabled: false,
          failed: false,
          fileName: null,
        };
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function finish(enabled: boolean, failed: boolean, fileName: string | null = null) {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      setState({ key, ready: true, enabled, failed, fileName });
    }
    const files = api.projectFiles;
    setState({
      key,
      ready: typeof files?.entry !== "function" && typeof files?.entries !== "function",
      enabled: false,
      failed: false,
      fileName: null,
    });
    if (typeof files?.entry === "function" || typeof files?.entries === "function") {
      timer = setTimeout(() => finish(false, true), 5000);
      void Promise.resolve()
        .then(() => files.entry?.(scope.workspaceId))
        .then(async (value) => {
          const name = typeof value === "string" && value.length > 0 ? value : null;
          if (name && !validEntryName(name)) {
            finish(false, true);
            return;
          }
          if (name !== null) { finish(true, false, name); return; }
          const selection = await files.entries?.(scope.workspaceId);
          if (Array.isArray(selection) && selection.length >= 2 && selection.length <= 4 &&
            selection.every(validEntryName) &&
            new Set(selection).size === selection.length) {
            finish(true, false);
          } else if (selection == null || Array.isArray(selection) && selection.length === 0) {
            finish(false, false);
          } else finish(false, true);
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
