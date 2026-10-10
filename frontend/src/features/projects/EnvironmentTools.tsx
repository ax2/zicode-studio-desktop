import { t } from "../../shared/i18n.js";
import type { DetectedTool, EnvironmentRequirement } from "./environment-requirements";
import { groupEnvironmentTools } from "./environment-tool-groups";
import { PythonToolSource } from "./PythonToolSource";

type Manifest = {
  name: string;
  kind: string;
  status: string;
  requirements: EnvironmentRequirement[];
};

function toolStatus(status: string): string {
  if (status === "unverified") return t("Version not checked");
  if (status === "invalid-environment") return t("Python environment unavailable");
  if (status === "ready") return t("Version check passed");
  if (status === "missing") return t("Not found in the host environment");
  if (status === "timeout") return t("Version check timed out");
  return t("Version check failed");
}

function ToolList({
  tools,
  projectWrappers,
}: {
  tools: DetectedTool[];
  projectWrappers: string[];
}) {
  return (
    <ul className="project-environment-list">
      {tools.map((tool) => (
        <li key={tool.id}>
          <div className="project-environment-header">
            <strong>
              {tool.id === "dotnet-project" ? t("Project directory dotnet SDK") : tool.id}
            </strong>
            <span>{toolStatus(tool.status)}</span>
          </div>
          <PythonToolSource tool={tool} />
          {tool.id === "dotnet-project" && (
            <span>
              {t("Resolved from the selected project directory without running build targets.")}
            </span>
          )}
          {tool.version ? <span>{tool.version}</span> : null}
          {tool.executable ? (
            <span className="project-environment-hint">{tool.executable}</span>
          ) : null}
          {projectWrappers.includes(tool.id) && (
            <span>{t("A usable project wrapper is available for this tool.")}</span>
          )}
          {!["ready", "unverified", "invalid-environment"].includes(tool.status) &&
          !(tool.status === "missing" && projectWrappers.includes(tool.id)) ? (
            <p>
              {tool.status === "missing"
                ? t(
                    "Install this tool if your project needs it, then restart ZiCode to refresh the tool paths.",
                  )
                : t(
                    "Check this tool in your system terminal, then retry. ZiCode will not install or repair it automatically.",
                  )}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function EnvironmentTools({
  manifests,
  tools,
  packageManager,
  projectWrappers,
}: {
  manifests: Manifest[];
  tools: DetectedTool[];
  packageManager?: string | null;
  projectWrappers: string[];
}) {
  const grouped = groupEnvironmentTools(manifests, tools, packageManager);
  return (
    <>
      <h3>{t(grouped.other.length ? "Project tools" : "Development tools")}</h3>
      <ToolList tools={grouped.project} projectWrappers={projectWrappers} />
      {grouped.other.length > 0 && (
        <details>
          <summary>
            {t("Other development tools")} ({grouped.other.length})
          </summary>
          <ToolList tools={grouped.other} projectWrappers={projectWrappers} />
        </details>
      )}
    </>
  );
}
