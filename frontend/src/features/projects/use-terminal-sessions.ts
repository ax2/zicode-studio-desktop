import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { TerminalApi } from "./project-terminal";
import { createTerminalSessions } from "./terminal-sessions";

export function useTerminalSessions(api: TerminalApi, workspace?: string | null) {
  const controller = useMemo(() => createTerminalSessions(api, workspace), [api, workspace]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    return controller.dispose;
  }, [controller]);
  return { ...state, controller };
}
