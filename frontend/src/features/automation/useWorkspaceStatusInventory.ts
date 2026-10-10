import { useCallback, useEffect, useRef, useState } from "react";
import type { AutomationAppOptions, AutomationWorkspaceStatus } from "./store";
import { readWorkspaceStatuses } from "./workspace-status-contract";

const REFRESH_INTERVAL_MS = 60_000;

/** Refresh the visible inventory without overlapping scans or accepting stale responses. */
export function useWorkspaceStatusInventory(
  listWorkspaceStatus: AutomationAppOptions["listWorkspaceStatus"],
) {
  const [statuses, setStatuses] = useState<AutomationWorkspaceStatus[] | null>(null);
  const [error, setError] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    setStatuses(null);
    setError(false);
    if (!listWorkspaceStatus) {
      refreshRef.current = () => {};
      return;
    }
    let active = true;
    let busy = false;
    let queued = false;
    const scan = () => {
      if (!active) return;
      if (busy) {
        queued = true;
        return;
      }
      busy = true;
      void Promise.resolve()
        .then(listWorkspaceStatus)
        .then(readWorkspaceStatuses)
        .then(
          (result) => {
            if (!active || queued) return;
            setStatuses(result);
            setError(false);
          },
          () => {
            if (active && !queued) setError(true);
          },
        )
        .finally(() => {
          busy = false;
          if (active && queued) {
            queued = false;
            if (document.visibilityState !== "hidden") scan();
          }
        });
    };
    refreshRef.current = scan;
    scan();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scan();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") scan();
    }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      refreshRef.current = () => {};
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [listWorkspaceStatus]);

  return { statuses, error, refresh };
}
