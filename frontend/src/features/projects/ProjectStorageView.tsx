import { useState } from "react";
import { t } from "../../shared/i18n.js";
import { ProjectStoragePanel, type ProjectStorageReport } from "./ProjectStoragePanel";
import { ProjectTaskDirectoryPicker } from "./ProjectTaskDirectoryPicker";
import type { ProjectRunnerApi } from "./project-runner";

export function ProjectStorageView({
  workspaceId,
  directory,
  revision,
  api,
  onDirectoryChange,
  readStorage,
  openEntry,
}: {
  workspaceId?: string;
  directory: string;
  revision: number;
  api: Pick<ProjectRunnerApi, "directories">;
  onDirectoryChange(directory: string): void;
  readStorage?: (workspaceId: string, directory: string, deep?: boolean) => Promise<ProjectStorageReport>;
  openEntry?: (workspaceId: string, relativePath: string) => Promise<void>;
}) {
  const [directoryRevision, setDirectoryRevision] = useState(0);
  return (
    <>
      {workspaceId ? (
        <section className="ui-panel project-environment">
          <ProjectTaskDirectoryPicker
            workspaceId={workspaceId}
            api={api}
            revision={revision + directoryRevision}
            value={directory}
            disabled={false}
            onChange={onDirectoryChange}
            label={t("Storage scan directory")}
          />
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => setDirectoryRevision((value) => value + 1)}
          >
            {t("Refresh project directories")}
          </button>
        </section>
      ) : null}
      <ProjectStoragePanel
        workspaceId={workspaceId}
        directory={directory}
        readStorage={readStorage}
        openEntry={openEntry}
      />
    </>
  );
}
