import { useState } from "react";
import { t } from "../../shared/i18n";
import { EnvironmentPanel, type EnvironmentPanelProps } from "./EnvironmentPanel";
import { ProjectTaskDirectoryPicker } from "./ProjectTaskDirectoryPicker";
import type { ProjectRunnerApi } from "./project-runner";

export function SubprojectEnvironment({
  workspaceId,
  revision,
  readEnvironment,
  api,
  directory = "",
  onDirectoryChange,
}: EnvironmentPanelProps & {
  api: Pick<ProjectRunnerApi, "directories">;
  onDirectoryChange(directory: string): void;
}) {
  const [refresh, setRefresh] = useState(0);
  return (
    <>
      {workspaceId ? (
        <section className="ui-panel project-environment">
          <ProjectTaskDirectoryPicker
            workspaceId={workspaceId}
            api={api}
            revision={revision + refresh}
            value={directory}
            disabled={false}
            onChange={onDirectoryChange}
            label={t("Environment directory")}
          />
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("Refresh project directories")}
          </button>
        </section>
      ) : null}
      <EnvironmentPanel
        workspaceId={workspaceId}
        directory={directory}
        revision={revision}
        readEnvironment={readEnvironment}
      />
    </>
  );
}
