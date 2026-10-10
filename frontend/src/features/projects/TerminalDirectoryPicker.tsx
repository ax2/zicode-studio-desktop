import { useState } from "react";
import { t } from "../../shared/i18n";
import { ProjectTaskDirectoryPicker } from "./ProjectTaskDirectoryPicker";
import type { ProjectRunnerApi } from "./project-runner";

export function TerminalDirectoryPicker({
  workspace,
  api,
  directory,
  disabled,
  onChange,
}: {
  workspace: string;
  api: Pick<ProjectRunnerApi, "directories">;
  directory: string;
  disabled: boolean;
  onChange(directory: string): void;
}) {
  const [revision, setRevision] = useState(0);
  return (
    <div>
      <ProjectTaskDirectoryPicker
        workspaceId={workspace}
        api={api}
        revision={revision}
        value={directory}
        disabled={disabled}
        onChange={onChange}
        label={t("Directory for new terminals")}
      />
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={disabled}
        onClick={() => setRevision((value) => value + 1)}
      >
        {t("Refresh project directories")}
      </button>
    </div>
  );
}
