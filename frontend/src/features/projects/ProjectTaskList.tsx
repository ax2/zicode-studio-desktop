import { useEffect, useMemo, useState } from "react";
import { t } from "../../shared/i18n.js";
import { CommandFavoriteTransfer } from "./CommandFavoriteTransfer";
import {
  COMMAND_FAVORITES_STORAGE_KEY,
  commandFavoriteId,
  commandFavoriteStorage,
  favoriteScope,
  readCommandFavorites,
  toggleCommandFavorite,
} from "./command-favorites";
import { type TaskCatalog, taskError } from "./project-runner";

type Task = TaskCatalog["tasks"][number];

function SourceHint({ task }: { task: Task }) {
  const message =
    task.source === "CMakeLists.txt"
      ? "CMake uses build/zicode-studio. Configure before building or testing; configuration runs this project's CMake code."
      : task.source === "CMakePresets.json"
        ? "CMake presets choose their own generator and output directory. Configure first; CMake evaluates conditions and included files when the command runs."
        : task.manager === "mvn" || task.manager === "gradle"
          ? "Maven and Gradle tasks prefer this project's wrapper when present. The build can run project code, download dependencies and write files; review the manifest and wrapper first."
          : task.manager === "dotnet"
            ? ".NET tasks target the selected solution or project file. Restore, build, test and publish can run project code, download packages and write files."
            : task.manager === "python"
              ? "Uses the explicitly selected Python environment, then the nearest .venv or .conda up to the workspace root. pytest and build must already be installed in the selected environment."
              : task.manager === "bundle"
                ? "Bundler uses this directory's Gemfile. Check verifies installed gems; install may download dependencies and write files. The Rake command executes the project's default task."
                : task.manager === "composer"
                  ? "Composer uses this directory's composer.json. Validate checks the manifest; install and project scripts may download dependencies, execute code and write files. Review the script in composer.json before starting it."
                  : task.manager === "uv"
                    ? "uv uses its own project environment. Run sync explicitly before the no-sync test commands; lock, sync and build may download packages or write project files."
                    : null;
  return message ? <p>{t(message)}</p> : null;
}

export function ProjectTaskList({
  catalog,
  workspaceId,
  projectName,
  directory,
  canRun,
  blocked,
  onStart,
}: {
  catalog: TaskCatalog;
  workspaceId: string;
  projectName?: string;
  directory: string;
  canRun: boolean;
  blocked: boolean;
  onStart(taskId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const storage = useMemo(commandFavoriteStorage, []);
  const scope = favoriteScope(workspaceId, directory);
  const [favorites, setFavorites] = useState(() => readCommandFavorites(storage, scope));
  const favoriteSet = new Set(favorites);
  const visiblePinnedCount = catalog.tasks.filter((task) =>
    favoriteSet.has(commandFavoriteId(task)),
  ).length;

  useEffect(() => {
    setFavorites(readCommandFavorites(storage, scope));
    if (!storage) return;
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === storage &&
        (event.key === COMMAND_FAVORITES_STORAGE_KEY || event.key === null)
      )
        setFavorites(readCommandFavorites(storage, scope));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage, scope]);

  function toggleFavorite(id: string) {
    try {
      setFavorites(toggleCommandFavorite(storage, scope, id));
      setFavoriteError(null);
    } catch (reason) {
      setFavoriteError(
        reason instanceof Error && reason.message === "command_favorite_limit"
          ? t("You can pin up to 32 commands in this project directory.")
          : t("Could not save pinned commands on this device."),
      );
    }
  }
  const transfer = (
    <CommandFavoriteTransfer
      storage={storage}
      scope={scope}
      projectName={projectName}
      directory={directory}
      catalog={catalog}
      favorites={favorites}
      onFavorites={setFavorites}
    />
  );
  if (catalog.tasks.length === 0) {
    return (
      <>
        {transfer}
        <p>
          {t(
            "No supported commands found in this directory. Select another project directory or add a supported manifest here.",
          )}
        </p>
      </>
    );
  }
  const filter = query.trim().toLocaleLowerCase();
  const matched = catalog.tasks.filter(
    (task) =>
      (!pinnedOnly || favoriteSet.has(commandFavoriteId(task))) &&
      [task.name, task.command, task.source, task.manager].some((value) =>
        value?.toLocaleLowerCase().includes(filter),
      ),
  );
  const groups = new Map<string, Task[]>();
  for (const task of matched) {
    const source = task.source || t("Other commands");
    const group = groups.get(source) || [];
    group.push(task);
    groups.set(source, group);
  }
  const orderedGroups = [...groups].sort(
    (left, right) =>
      Number(right[1].some((task) => favoriteSet.has(commandFavoriteId(task)))) -
      Number(left[1].some((task) => favoriteSet.has(commandFavoriteId(task)))),
  );
  return (
    <div className="project-runner-task-groups">
      {transfer}
      <label className="project-runner-filter">
        <span>{t("Filter project commands")}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search command or source")}
        />
      </label>
      <div className="project-runner-filter-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          aria-pressed={pinnedOnly}
          disabled={!storage}
          onClick={() => setPinnedOnly((value) => !value)}
        >
          {t("Pinned commands only")} ({visiblePinnedCount})
        </button>
      </div>
      {!storage && <p>{t("Pinned commands are unavailable in this window.")}</p>}
      {favoriteError && <p role="alert">{favoriteError}</p>}
      <p role="status">
        {t("Commands shown")}: {matched.length} / {catalog.tasks.length}
      </p>
      {matched.length === 0 && (
        <p>
          {pinnedOnly && !filter
            ? t("No pinned commands in this directory.")
            : t("No commands match this filter.")}
        </p>
      )}
      {orderedGroups.map(([source, tasks]) => (
        <section className="project-runner-task-group" key={source}>
          <h3>
            <span>
              {t("Command source")}: {source}
            </span>{" "}
            <small>({tasks.length})</small>
          </h3>
          <SourceHint task={tasks[0]} />
          <ul className="project-runner-list">
            {[...tasks]
              .sort(
                (left, right) =>
                  Number(favoriteSet.has(commandFavoriteId(right))) -
                  Number(favoriteSet.has(commandFavoriteId(left))),
              )
              .map((task) => {
                const id = commandFavoriteId(task);
                const pinned = favoriteSet.has(id);
                return (
                  <li key={task.id ?? task.name}>
                    <div className="project-runner-header">
                      <strong>{task.name}</strong>
                      <div className="project-runner-task-actions">
                        <button
                          type="button"
                          className="ui-button ui-button--ghost ui-button--sm"
                          aria-label={`${t("Pin command")}: ${task.name}`}
                          aria-pressed={pinned}
                          disabled={!storage || id.length > 512}
                          onClick={() => toggleFavorite(id)}
                        >
                          {pinned ? t("Pinned") : t("Pin")}
                        </button>
                        <button
                          type="button"
                          className="ui-button ui-button--secondary"
                          disabled={!canRun || blocked || !task.runnable}
                          aria-label={`${t("Run project command")}: ${task.name}`}
                          onClick={() => onStart(task.id ?? task.name)}
                        >
                          {t("Run project command")}
                        </button>
                      </div>
                    </div>
                    <code>{task.command}</code>
                    {task.interpreter && (
                      <span>
                        {t("Python interpreter")}: {task.interpreter}
                      </span>
                    )}
                    {!task.runnable && (
                      <span>
                        {task.unavailableReason
                          ? taskError(new Error(task.unavailableReason))
                          : t("This script name is not supported by the task runner.")}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
