import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ProjectRunnerApi } from "./project-runner";
import { createProjectRuns } from "./project-runs";

export function useProjectRuns(api: ProjectRunnerApi, workspace?: string | null) {
  const controller = useMemo(() => createProjectRuns(api, workspace), [api, workspace]);
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
