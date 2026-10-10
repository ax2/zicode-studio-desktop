import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { downloadContextRecovery } from "./context-recovery-export";
import { type ImportedContextRecovery, readContextRecoveryFile } from "./context-recovery-import";
import { directoryScope } from "./directory-context";
import { projectName } from "./logic";
import { ProjectProfilePreview } from "./ProjectProfilePreview";
import { downloadSavedProjectContext } from "./saved-context-export";
import type { createProjectWorkspaceStore } from "./store";

type ProjectStore = ReturnType<typeof createProjectWorkspaceStore>;

export function ContextRecoveryPanel({ store }: { store: ProjectStore }) {
  const target = store((state) => state.target);
  const scope = directoryScope(target);
  const snapshots = store((state) => state.contextRecoverySnapshots);
  const unreadable = store((state) => state.contextRecoveryUnreadable);
  const removableUnreadable = store((state) => state.contextRecoveryRemovableUnreadable);
  const pending = store((state) => state.contextRecoveryPending);
  const error = store((state) => state.contextRecoveryError);
  const draft = store((state) => state.contextDraft);
  const profile = store((state) => state.profile);
  const canRestore = store(
    (state) => !state.loading && !state.profileError && Boolean(state.profileRevision),
  );
  const [armed, setArmed] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [staged, setStaged] = useState<{ scope: string; copy: ImportedContextRecovery } | null>(
    null,
  );
  const importInput = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);

  useEffect(() => {
    importGeneration.current += 1;
    void store.getState().refreshContextRecovery(scope);
    setStaged(null);
    setImportError(null);
    setImporting(false);
  }, [store, scope]);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <section className="ui-card" aria-label={t("Local project context recovery")}>
      <details>
        <summary>
          {t("Local project context recovery")} · {snapshots.length}
        </summary>
        <p className="ui-muted">
          {t(
            "Recovery copies are encrypted in this device profile. They are not a backup or device sync. Restoring compares the draft with the latest saved project context.",
          )}
        </p>
        <p className="ui-muted">
          {t(
            "Downloaded project context recovery files are plaintext. Keep them in a private location.",
          )}
        </p>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => void store.getState().refreshContextRecovery(scope)}
        >
          {t("Refresh")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost"
          disabled={!target?.workspaceId || !canRestore}
          onClick={() => {
            try {
              downloadSavedProjectContext(profile, projectName(target));
              setExportError(null);
            } catch {
              setExportError(t("Could not download saved project context."));
            }
          }}
        >
          {t("Download saved project context")}
        </button>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const selectedScope = scope;
            const generation = ++importGeneration.current;
            setStaged(null);
            setImportError(null);
            void readContextRecoveryFile(file)
              .then((copy) => {
                if (
                  generation === importGeneration.current &&
                  directoryScope(store.getState().target) === selectedScope
                )
                  setStaged({ scope: selectedScope, copy });
              })
              .catch((reason) => {
                if (
                  generation !== importGeneration.current ||
                  directoryScope(store.getState().target) !== selectedScope
                )
                  return;
                setImportError(
                  t(
                    reason instanceof Error
                      ? reason.message
                      : "Invalid project context recovery file.",
                  ),
                );
              });
          }}
        />
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={!target?.workspaceId || importing}
          onClick={() => importInput.current?.click()}
        >
          {t("Import recovery copy")}
        </button>
        {staged?.scope === scope ? (
          <div className="ui-card">
            <p>
              {staged.copy.kind === "saved-profile"
                ? t("Saved project context file")
                : t("Unsaved project context draft file")}
            </p>
            <p>
              {t("Recovery copy source")}: {staged.copy.projectName} ·{" "}
              <time dateTime={staged.copy.capturedAt}>
                {new Date(staged.copy.capturedAt).toLocaleString()}
              </time>
            </p>
            <p>
              {t("Import into current project")}: {projectName(target)}
            </p>
            <p className="ui-muted">
              {t(
                "Import adds a recovery copy without changing the editor or saved project context.",
              )}
            </p>
            <details open>
              <summary>{t("Preview imported project context")}</summary>
              <ProjectProfilePreview
                profile={
                  staged.copy.kind === "saved-profile" ? staged.copy.profile : staged.copy.draft
                }
              />
            </details>
            {staged.copy.kind === "saved-profile" && !canRestore ? (
              <p role="alert">
                {t("Load the destination's saved context before importing this file.")}
              </p>
            ) : null}
            <div className="ui-toolbar">
              <button
                type="button"
                className="ui-button ui-button--primary"
                disabled={importing || (staged.copy.kind === "saved-profile" && !canRestore)}
                onClick={() => {
                  const confirmedScope = staged.scope;
                  const generation = importGeneration.current;
                  setImporting(true);
                  setImportError(null);
                  void store
                    .getState()
                    .importContextRecovery(confirmedScope, staged.copy)
                    .then(() => {
                      if (
                        generation === importGeneration.current &&
                        directoryScope(store.getState().target) === confirmedScope
                      )
                        setStaged(null);
                    })
                    .catch((reason) => {
                      if (
                        generation !== importGeneration.current ||
                        directoryScope(store.getState().target) !== confirmedScope
                      )
                        return;
                      setImportError(
                        t(
                          reason instanceof Error
                            ? reason.message
                            : "Could not import this project context recovery copy.",
                        ),
                      );
                    })
                    .finally(() => {
                      if (generation === importGeneration.current) setImporting(false);
                    });
                }}
              >
                {t("Confirm import recovery copy")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost"
                disabled={importing}
                onClick={() => setStaged(null)}
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        ) : null}
        {unreadable ? (
          <p role="alert">
            {t("Unreadable project context recovery copies")}: {unreadable}
          </p>
        ) : null}
        {removableUnreadable ? (
          <button
            type="button"
            className="ui-button ui-button--danger"
            onClick={() => {
              if (armed !== "discard-unreadable") {
                setArmed("discard-unreadable");
                return;
              }
              setArmed(null);
              void store.getState().discardUnreadableContextRecovery(scope);
            }}
          >
            {armed === "discard-unreadable"
              ? t("Confirm discard unreadable copies")
              : t("Discard unreadable copies")}
          </button>
        ) : null}
        {snapshots.map((snapshot) => {
          const current = store.getState().isCurrentContextRecovery(snapshot.id);
          return (
            <article key={snapshot.id}>
              <p>
                <time dateTime={snapshot.updatedAt}>
                  {new Date(snapshot.updatedAt).toLocaleString()}
                </time>
                {current ? ` · ${t("Current window draft")}` : ""}
                {snapshot.sourceProjectName
                  ? ` · ${t("Recovery copy source")}: ${snapshot.sourceProjectName}`
                  : ""}
              </p>
              <details>
                <summary>{t("Preview recovery copy")}</summary>
                <ProjectProfilePreview profile={snapshot.draft} />
              </details>
              <div className="ui-toolbar">
                <button
                  type="button"
                  className="ui-button ui-button--ghost"
                  onClick={() => {
                    try {
                      downloadContextRecovery(snapshot, projectName(target));
                      setExportError(null);
                    } catch {
                      setExportError(t("Could not download this project context recovery copy."));
                    }
                  }}
                >
                  {t("Download recovery copy")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  disabled={current || !canRestore}
                  onClick={() => {
                    if (draft && armed !== `restore:${snapshot.id}`) {
                      setArmed(`restore:${snapshot.id}`);
                      return;
                    }
                    setArmed(null);
                    store.getState().restoreContextRecovery(snapshot);
                  }}
                >
                  {armed === `restore:${snapshot.id}`
                    ? t("Confirm replace current draft")
                    : t("Restore recovery copy")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--danger"
                  disabled={current}
                  onClick={() => {
                    if (armed !== `discard:${snapshot.id}`) {
                      setArmed(`discard:${snapshot.id}`);
                      return;
                    }
                    setArmed(null);
                    void store.getState().discardContextRecovery(snapshot);
                  }}
                >
                  {armed === `discard:${snapshot.id}`
                    ? t("Confirm discard draft")
                    : t("Discard draft")}
                </button>
              </div>
            </article>
          );
        })}
      </details>
      {pending ? (
        <p role="status">
          {t("Project context recovery is pending. Keep this window open until it finishes.")}
        </p>
      ) : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {exportError ? <p role="alert">{exportError}</p> : null}
      {importError ? <p role="alert">{importError}</p> : null}
    </section>
  );
}
