import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import { commandFavoriteId, mergeCommandFavorites } from "./command-favorites";
import {
  type CommandFavoritesTransfer,
  downloadCommandFavorites,
  readCommandFavoritesFile,
} from "./command-favorites-transfer";
import type { TaskCatalog } from "./project-runner";

export function CommandFavoriteTransfer({
  storage,
  scope,
  projectName,
  directory,
  catalog,
  favorites,
  onFavorites,
}: {
  storage: Storage | null;
  scope: string;
  projectName?: string;
  directory: string;
  catalog: TaskCatalog;
  favorites: string[];
  onFavorites(ids: string[]): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const activeScope = useRef(scope);
  const [staged, setStaged] = useState<CommandFavoritesTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeScope.current !== scope) {
      activeScope.current = scope;
      generation.current += 1;
      setStaged(null);
      setError(null);
    }
    return () => {
      generation.current += 1;
    };
  }, [scope]);

  const availableIds = new Set(catalog.tasks.map(commandFavoriteId));
  const matched = staged?.ids.filter((id) => availableIds.has(id)).length ?? 0;
  return (
    <details>
      <summary>{t("Transfer pinned commands")}</summary>
      <p className="ui-muted">
        {t(
          "Pinned command files contain identifiers only. Import merges with this project directory and never runs commands.",
        )}
      </p>
      <div className="ui-toolbar">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={!storage || !projectName || favorites.length === 0}
          onClick={() => {
            if (!projectName) return;
            try {
              downloadCommandFavorites({ projectName, directory, ids: favorites });
              setError(null);
            } catch (reason) {
              setError(
                t(reason instanceof Error ? reason.message : "Could not download pinned commands."),
              );
            }
          }}
        >
          {t("Download pinned commands")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const selected = ++generation.current;
            setStaged(null);
            setError(null);
            void readCommandFavoritesFile(file)
              .then((copy) => {
                if (selected === generation.current) setStaged(copy);
              })
              .catch((reason) => {
                if (selected === generation.current)
                  setError(
                    t(reason instanceof Error ? reason.message : "Invalid pinned commands file."),
                  );
              });
          }}
        />
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={!storage}
          onClick={() => input.current?.click()}
        >
          {t("Import pinned commands")}
        </button>
      </div>
      {staged ? (
        <div className="ui-card">
          <p>
            {t("Source project")}: {staged.projectName} · {staged.directory || t("Workspace root")}
          </p>
          <p>
            {t("Import into current project")}: {projectName || t("Current project")} ·{" "}
            {directory || t("Workspace root")}
          </p>
          <p>
            {t("Pinned commands matched")}: {matched} / {staged.ids.length}
          </p>
          <p className="ui-muted">
            {t(
              "Unavailable command identifiers remain pinned and appear if their commands are discovered later.",
            )}
          </p>
          <div className="ui-toolbar">
            <button
              type="button"
              className="ui-button ui-button--primary"
              onClick={() => {
                try {
                  onFavorites(mergeCommandFavorites(storage, scope, staged.ids));
                  setStaged(null);
                  setError(null);
                } catch (reason) {
                  setError(
                    t(
                      reason instanceof Error && reason.message === "command_favorite_limit"
                        ? "You can pin up to 32 commands in this project directory."
                        : reason instanceof Error &&
                            reason.message === "command_favorite_unavailable"
                          ? "Existing pinned commands could not be read. Import was not saved."
                          : "Could not import pinned commands.",
                    ),
                  );
                }
              }}
            >
              {t("Confirm import pinned commands")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--ghost"
              onClick={() => setStaged(null)}
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
