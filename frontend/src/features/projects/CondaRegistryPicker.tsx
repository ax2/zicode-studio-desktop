import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";

export interface CondaDiscovery {
  status: "available" | "missing";
  truncated: boolean;
  environments: {
    name: string;
    path: string;
    source: "registry" | "userDirectory" | "hostActivation" | "configuredDirectory";
  }[];
}

function sourceLabel(source: CondaDiscovery["environments"][number]["source"]): string {
  if (source === "registry") return t("Conda registry");
  if (source === "userDirectory") return t("User Conda directory");
  if (source === "hostActivation") return t("Host Conda activation");
  if (source === "configuredDirectory") return t("Configured Conda directory");
  return t("Unknown Conda source");
}

export function CondaRegistryPicker({
  workspace,
  discover,
  disabled,
  onSelect,
}: {
  workspace: string;
  discover: (workspace: string) => Promise<CondaDiscovery>;
  disabled: boolean;
  onSelect: (path: string) => void;
}) {
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CondaDiscovery | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    return () => {
      generation.current++;
    };
  }, []);

  async function refresh() {
    if (pending || disabled) return;
    const current = generation.current;
    setPending(true);
    setResult(null);
    setError(false);
    try {
      const value = await discover(workspace);
      if (generation.current === current) setResult(value);
    } catch {
      if (generation.current === current) setError(true);
    } finally {
      if (generation.current === current) setPending(false);
    }
  }

  return (
    <div className="project-environment-discovery">
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={disabled || pending}
        onClick={() => void refresh()}
      >
        {t("Find local Conda environments")}
      </button>
      {pending ? <p role="status">{t("Reading local Conda environment sources…")}</p> : null}
      {error ? <p role="alert">{t("Could not read local Conda environment sources.")}</p> : null}
      {result?.status === "missing" ? (
        <p>{t("No local Conda environment sources were found on this computer.")}</p>
      ) : null}
      {result?.status === "available" && result.environments.length === 0 ? (
        <p>{t("No usable Conda environments were found in the local sources.")}</p>
      ) : null}
      {result?.status === "available" && result.environments.length > 0 ? (
        <ul className="project-environment-discovery-list">
          {result.environments.map((environment) => (
            <li key={environment.path}>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                disabled={disabled || pending}
                onClick={() => onSelect(environment.path)}
              >
                {environment.name}
              </button>{" "}
              <span>{sourceLabel(environment.source)}</span> <code>{environment.path}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {result?.truncated ? (
        <p>
          {t(
            "Conda discovery reached its source or entry limit; some environments may be missing.",
          )}
        </p>
      ) : null}
      <p>
        {t(
          "Reads ~/.conda/environments.txt, ~/.conda/envs, CONDA_PREFIX, and CONDA_ENVS_PATH without running Conda or Python. Choose an environment, then save to apply it to this project.",
        )}
      </p>
    </div>
  );
}
