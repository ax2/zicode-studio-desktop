import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import { normalizeHistory, type ProjectRun, type ProjectRunnerApi } from "./project-runner";

const COMMAND = "poetry env list --full-path";

function parsePaths(run: ProjectRun): string[] | null {
  if (run.truncated || run.stdout.length > 64 * 1024) return null;
  const lines = run.stdout.trim() ? run.stdout.trim().split(/\r?\n/) : [];
  if (lines.length > 64) return null;
  const paths: string[] = [];
  for (const line of lines) {
    const path = line.trim().replace(/ \(Activated\)$/, "");
    if (
      !path ||
      [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path)
    )
      return null;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function PoetryEnvironmentPicker({
  workspace,
  directory,
  runner,
  disabled,
  onSelect,
}: {
  workspace: string;
  directory: string;
  runner: ProjectRunnerApi;
  disabled: boolean;
  onSelect: (path: string) => void;
}) {
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    return () => {
      generation.current++;
    };
  }, []);

  async function refresh() {
    if (disabled || pending) return;
    const current = generation.current;
    setPending(true);
    setPaths(null);
    setError("");
    try {
      const history = normalizeHistory(await runner.runs(workspace));
      if (generation.current !== current) return;
      const latest = history.runs
        .filter(
          (run) =>
            run.workspaceId === workspace &&
            run.manager === "poetry" &&
            run.command === COMMAND &&
            (run.directory || "") === directory,
        )
        .sort((left, right) => right.startedAt - left.startedAt)[0];
      if (!latest || latest.historical || latest.status !== "succeeded") {
        setError(t("Run poetry env list --full-path in Project commands for this directory, then return here."));
        return;
      }
      const candidates = parsePaths(latest);
      if (!candidates) {
        setError(t("The latest Poetry environment list is incomplete or has an unsupported format."));
        return;
      }
      const catalog = await runner.catalog(workspace, directory);
      if (generation.current !== current) return;
      if (
        (catalog.directory !== directory && (directory || catalog.directory !== undefined)) ||
        !latest.fingerprint ||
        catalog.fingerprint !== latest.fingerprint ||
        !catalog.tasks.some((task) => task.id === "@poetry/environments" && task.runnable)
      ) {
        setError(t("Project command configuration changed. Run poetry env list --full-path again."));
        return;
      }
      setPaths(candidates);
    } catch {
      if (generation.current === current)
        setError(t("Could not read the latest Poetry environment list. Refresh Project commands and retry."));
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
        {t("Use latest Poetry environment list")}
      </button>
      {pending ? <p role="status">{t("Reading latest Poetry environment list…")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {paths?.length === 0 ? <p>{t("Poetry reported no environments for this project.")}</p> : null}
      {paths && paths.length > 0 ? (
        <ul className="project-environment-discovery-list">
          {paths.map((path) => (
            <li key={path}>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                disabled={disabled || pending}
                onClick={() => onSelect(path)}
              >
                {t("Select environment")}
              </button>{" "}
              <code>{path}</code>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        {t(
          "Run poetry env list --full-path from Project commands first. This view reads its latest complete result; selection fills a draft until you save.",
        )}
      </p>
    </div>
  );
}
