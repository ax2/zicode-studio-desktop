import { t } from "../../shared/i18n";

export function ProjectDirectoryContext({ directory }: { directory: string }) {
  return (
    <p className="project-workspace-path">
      {t("Current subproject")}: <strong>{directory || t("Workspace root")}</strong>
      {" · "}
      {t(
        "Environment checks and commands share this directory in this window. New terminals and desktop storage scans use it when available. Existing runs and terminals keep their own working directories.",
      )}
    </p>
  );
}
