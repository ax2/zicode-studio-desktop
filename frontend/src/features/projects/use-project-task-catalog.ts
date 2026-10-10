import { useEffect, useState } from "react";
import { type ProjectRunnerApi, type TaskCatalog, taskError } from "./project-runner";

export function useProjectTaskCatalog(
  api: ProjectRunnerApi,
  workspace: string | null | undefined,
  directory: string,
  revision: number,
) {
  const [result, setResult] = useState<{
    api: ProjectRunnerApi;
    workspace: string;
    directory: string;
    revision: number;
    catalog?: TaskCatalog;
    error?: string;
  } | null>(null);
  const current =
    result?.api === api &&
    result.workspace === workspace &&
    result.directory === directory &&
    result.revision === revision
      ? result
      : null;
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    void api.catalog(workspace, directory).then(
      (catalog) => {
        if (!active) return;
        const confirmed =
          catalog.directory === directory || (!directory && catalog.directory === undefined);
        setResult({
          api,
          workspace,
          directory,
          revision,
          ...(confirmed
            ? { catalog }
            : { error: taskError(new Error("task_directory_unconfirmed")) }),
        });
      },
      (reason) => {
        if (active) setResult({ api, workspace, directory, revision, error: taskError(reason) });
      },
    );
    return () => {
      active = false;
    };
  }, [api, workspace, directory, revision]);
  return { catalog: current?.catalog ?? null, error: current?.error ?? "" };
}
