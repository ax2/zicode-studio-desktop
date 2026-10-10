import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { Root } from "react-dom/client";
import { t } from "../../shared/i18n.js";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { Select } from "../../shared/Select";
import { ContextPackButton } from "./ContextPackButton";
import { ContextRecoveryPanel } from "./ContextRecoveryPanel";
import { directoryScope } from "./directory-context";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { GitStatusPanel } from "./GitStatusPanel";
import {
  type ProjectProfile,
  type ProjectSnapshot,
  type ProjectTarget,
  projectName,
} from "./logic";
import { ProjectDirectoryContext } from "./ProjectDirectoryContext";
import { ProjectRecentRunsPanel } from "./ProjectRecentRunsPanel";
import { ProjectRunnerPanel } from "./ProjectRunnerPanel";
import { ProjectStorageView } from "./ProjectStorageView";
import { ProjectTerminalPanel } from "./ProjectTerminalPanel";
import { ProjectToolPaths } from "./ProjectToolPaths";
import { ProjectWorkPanel } from "./ProjectWorkPanel";
import { ProjectWorkSummaryPanel } from "./ProjectWorkSummaryPanel";
import { SubprojectEnvironment } from "./SubprojectEnvironment";
import {
  createProjectWorkspaceStore,
  type ProjectView,
  type ProjectWorkspaceOptions,
  projectSearchMatches,
} from "./store";

type ProjectStore = ReturnType<typeof createProjectWorkspaceStore>;

const PROJECT_VIEWS: Array<[ProjectView, string]> = [
  ["overview", "Overview"],
  ["context", "Project context"],
  ["knowledge", "Knowledge connections"],
  ["search", "Project search"],
  ["activity", "Recent activity"],
  ["environment", "Development environment"],
  ["storage", "Project storage"],
  ["runner", "Project commands"],
  ["terminal", "Project terminal"],
  ["work", "Project work"],
];

export function ProjectNav({ store }: { store: ProjectStore }) {
  const activeView = store((state) => state.activeView);
  const readStorage = store((state) => state.readStorage);
  const setActiveView = store((state) => state.setActiveView);
  return (
    <nav className="project-workspace-navigation" aria-label={t("Project workspace")}>
      {PROJECT_VIEWS.filter(([id]) => id !== "storage" || readStorage).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`project-workspace-nav-item${activeView === id ? " active" : ""}`}
          aria-pressed={activeView === id}
          onClick={() => setActiveView(id)}
        >
          {t(label)}
        </button>
      ))}
    </nav>
  );
}

export function ProjectMain({ store }: { store: ProjectStore }) {
  const runner = store((state) => state.runner);
  const prepareRunAnalysis = store((state) => state.prepareRunAnalysis);
  const directory = store((state) => state.projectDirectory);
  const setDirectory = store((state) => state.setProjectDirectory);
  const terminal = store((state) => state.terminal);
  const readEnvironment = store((state) => state.readEnvironment);
  const readStorage = store((state) => state.readStorage);
  const openStorageEntry = store((state) => state.openStorageEntry);
  const toolPaths = store((state) => state.toolPaths);
  const revision = store((state) => state.refreshRevision);
  const target = store((state) => state.target);
  const scope = directoryScope(target);
  const changeDirectory = (value: string) => setDirectory(value, scope);
  const activeView = store((state) => state.activeView);
  const loading = store((state) => state.loading);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  const onManageProjects = store((state) => state.onManageProjects);
  const work = store((state) => state.snapshot.work);
  const openApp = store((state) => state.openApp);
  return (
    <div className="project-workspace-main">
      <header className="project-workspace-header">
        <div>
          <h1>{projectName(target)}</h1>
          <p className="project-workspace-path">
            {target?.cwd || target?.projectPath || t("Local project")}
          </p>
        </div>
        <button type="button" className="ui-button ui-button--ghost" onClick={onManageProjects}>
          {t("Manage projects")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("Refresh")}
        </button>
      </header>
      {target?.workspaceId &&
      (activeView === "runner" ||
        activeView === "environment" ||
        activeView === "terminal" ||
        activeView === "storage") ? (
        <ProjectDirectoryContext directory={directory} />
      ) : null}
      {error ? (
        <StatePanel
          title={t("Could not load project workspace")}
          detail={error.message}
          retry={() => void load()}
        />
      ) : activeView === "work" ? (
        <ProjectWorkPanel
          key={scope}
          work={work}
          projectPath={target?.cwd || target?.projectPath}
          loading={loading}
          openApp={openApp}
        />
      ) : activeView === "runner" ? (
        <ProjectRunnerPanel
          key={`${scope}:${revision}`}
          workspaceId={target?.workspaceId}
          projectName={projectName(target)}
          api={runner}
          directory={directory}
          onDirectoryChange={changeDirectory}
          prepareAnalysis={prepareRunAnalysis}
        />
      ) : activeView === "terminal" ? (
        <ProjectTerminalPanel
          key={scope}
          workspaceId={target?.workspaceId}
          api={terminal}
          directory={directory}
          directoryApi={runner}
          onDirectoryChange={changeDirectory}
        />
      ) : activeView === "environment" ? (
        <>
          {target?.workspaceId ? (
            <ProjectToolPaths
              key={target.workspaceId}
              workspace={target.workspaceId}
              api={toolPaths}
              runner={runner}
              directory={directory}
            />
          ) : null}
          <SubprojectEnvironment
            key={scope}
            workspaceId={target?.workspaceId}
            revision={revision}
            readEnvironment={readEnvironment}
            api={runner}
            directory={directory}
            onDirectoryChange={changeDirectory}
          />
        </>
      ) : activeView === "storage" ? (
        <ProjectStorageView
          key={`${scope}:${revision}`}
          workspaceId={target?.workspaceId ?? undefined}
          directory={directory}
          revision={revision}
          api={runner}
          onDirectoryChange={changeDirectory}
          readStorage={readStorage}
          openEntry={openStorageEntry}
        />
      ) : activeView === "context" ? (
        <ContextEditor key={scope} store={store} />
      ) : activeView === "knowledge" ? (
        <KnowledgeView store={store} />
      ) : activeView === "search" ? (
        <SearchView store={store} />
      ) : activeView === "activity" ? (
        <ActivityView store={store} />
      ) : (
        <Overview store={store} />
      )}
    </div>
  );
}

function Overview({ store }: { store: ProjectStore }) {
  const canStageGit = store((state) => state.canStageGit);
  const canUnstageGit = store((state) => state.canUnstageGit);
  const stageGitFile = store((state) => state.stageGitFile);
  const unstageGitFile = store((state) => state.unstageGitFile);
  const workspaceId = store((state) => state.target?.workspaceId);
  const revision = store((state) => state.refreshRevision);
  const readStatus = store((state) => state.readGitStatus);
  const readDiff = store((state) => state.readGitDiff);
  const readHistory = store((state) => state.readGitHistory);
  const readCommitDiff = store((state) => state.readCommitDiff);
  const runner = store((state) => state.runner);
  const setActiveView = store((state) => state.setActiveView);
  const prepareGitReview = store((state) => state.prepareGitReview);
  const snapshot = store((state) => state.snapshot);
  const loading = store((state) => state.loading);
  const openApp = store((state) => state.openApp);
  const stats: Array<[number | string, string, () => void]> = [
    [snapshot.notebooks.length, "Notebooks", () => openApp("com.zicode.notes")],
    [snapshot.notes.length, "Notes", () => openApp("com.zicode.notes")],
    [snapshot.artifacts.length, "Artifacts", () => openApp("com.zicode.artifacts")],
    [snapshot.sessions.length, "Sessions", () => openApp("core.chat")],
    [
      snapshot.files.length,
      "Files",
      () => window.dispatchEvent(new CustomEvent("zicode:open-files")),
    ],
    [
      snapshot.work.tasksUnavailable ? "—" : snapshot.taskCount,
      "Tasks",
      () => store.getState().setActiveView("work"),
    ],
    [
      snapshot.work.automationsUnavailable ? "—" : snapshot.automationCount,
      "Automations",
      () => store.getState().setActiveView("work"),
    ],
  ];
  return (
    <section className="project-workspace-overview">
      <GitStatusPanel
        key={`git-status:${workspaceId}`}
        workspaceId={workspaceId}
        revision={revision}
        readStatus={readStatus}
        readDiff={readDiff}
        prepareGitReview={prepareGitReview}
        stageFile={canStageGit ? stageGitFile : undefined}
        unstageFile={canUnstageGit ? unstageGitFile : undefined}
      />
      <GitHistoryPanel
        key={`git-history:${workspaceId}`}
        workspaceId={workspaceId}
        revision={revision}
        readHistory={readHistory}
        readCommitDiff={readCommitDiff}
        prepareGitReview={prepareGitReview}
      />
      <ProjectRecentRunsPanel
        key={`recent-runs:${workspaceId}`}
        workspaceId={workspaceId}
        revision={revision}
        api={runner}
        openCommands={() => setActiveView("runner")}
      />
      <div className="project-workspace-stats">
        {stats.map(([value, label, action]) => (
          <button
            key={label}
            type="button"
            className="ui-card project-workspace-stat"
            onClick={action}
          >
            <strong>{value}</strong>
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
      <ProjectWorkSummaryPanel
        work={snapshot.work}
        loading={loading}
        openWork={() => setActiveView("work")}
      />
      {loading ? (
        <p className="project-workspace-state">{t("Loading project…")}</p>
      ) : !snapshot.notes.length && !snapshot.artifacts.length ? (
        <>
          <StatePanel
            title={t("Turn this conversation into a project")}
            detail={t(
              "Create notes and artifacts from the current conversation; they will stay connected here.",
            )}
          />
          <p className="project-workspace-hint" role="note">
            {t(
              "A project is a workspace. Use Manage projects to switch or create one (open a folder); edit its instructions and budget under Project context.",
            )}
          </p>
        </>
      ) : (
        <RecentResults snapshot={snapshot} store={store} />
      )}
      {snapshot.warnings.length ? (
        <div className="project-workspace-warning" role="status">
          <span>
            {t("Some project sources could not be refreshed. Existing results remain available.")}
          </span>
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            disabled={loading}
            onClick={() => void store.getState().load()}
          >
            {t("Retry")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function RecentResults({ snapshot, store }: { snapshot: ProjectSnapshot; store: ProjectStore }) {
  const openResult = store((state) => state.openResult);
  const items = [
    ...snapshot.notes.slice(0, 4).map((item) => ({ ...item, type: t("Note") })),
    ...snapshot.artifacts.slice(0, 4).map((item) => ({ ...item, type: t("Artifact") })),
  ].slice(0, 6);
  return (
    <section className="ui-panel project-workspace-results">
      <h2>{t("Recent project results")}</h2>
      <ul>
        {items.map((item) => (
          <li key={`${item.type}-${item.id ?? item.title}`}>
            <button
              type="button"
              className="project-workspace-result-row"
              onClick={() => openResult(item as Record<string, unknown>)}
            >
              <span className="project-workspace-result-type">{item.type}</span>
              <strong>{item.title || t("Untitled")}</strong>
              <span className="project-workspace-result-summary">
                {String(
                  (item as Record<string, unknown>).summary ||
                    (item as Record<string, unknown>).excerpt ||
                    "",
                )}
              </span>
              <span className="project-workspace-result-open">{t("Open in app")}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContextEditor({ store }: { store: ProjectStore }) {
  const profile = store((state) => state.profile);
  const profileError = store((state) => state.profileError);
  const loading = store((state) => state.loading);
  const contextDraft = store((state) => state.contextDraft);
  const contextConflicts = store((state) => state.contextConflicts);
  const loadProfile = store((state) => state.loadProfile);
  const resolveContextConflict = store((state) => state.resolveContextConflict);
  const saveProfile = store((state) => state.saveProfile);
  const setContextDraft = store((state) => state.setContextDraft);
  const notify = store((state) => state.notify);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const target = store((state) => state.target);
  const targetScope = directoryScope(target);
  const [discardArmedScope, setDiscardArmedScope] = useState<string | null>(null);
  const draft = contextDraft ?? profile;
  const budget = String(draft.budget ?? "");

  useEffect(() => {
    if (!discardArmedScope) return;
    const timer = setTimeout(() => setDiscardArmedScope(null), 4000);
    return () => clearTimeout(timer);
  }, [discardArmedScope]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      await saveProfile({
        instructions: draft.instructions.trim(),
        defaultScene: draft.defaultScene,
        budget: String(draft.budget ?? "").trim(),
      });
      setDiscardArmedScope(null);
      notify({
        title: store.getState().contextDraft
          ? t("Project context saved; newer edits remain unsaved")
          : t("Project context saved"),
        type: "success",
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setSaveError(message);
      notify({
        title: t("Could not save project context"),
        message,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function refreshSavedProfile() {
    setRefreshing(true);
    try {
      await loadProfile();
      setSaveError(null);
    } catch {
      // The store keeps the read error visible beside the current draft.
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <form className="ui-panel project-workspace-context" onSubmit={handleSubmit}>
      <h2>{t("Project context")}</h2>
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={saving || refreshing || loading}
        onClick={() => void refreshSavedProfile()}
      >
        {t("Refresh saved context")}
      </button>
      {profileError ? <p role="alert">{profileError}</p> : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
      {contextDraft ? (
        <p role="status">
          {target?.workspaceId
            ? t("Unsaved project context is kept in this window and encrypted local recovery.")
            : t("Unsaved project context is kept for recent projects in this window.")}
        </p>
      ) : null}
      {contextDraft ? (
        <button
          type="button"
          className="ui-button ui-button--danger"
          onClick={() => {
            if (discardArmedScope !== targetScope) {
              setDiscardArmedScope(targetScope);
              return;
            }
            setDiscardArmedScope(null);
            store.getState().discardContextDraft();
          }}
        >
          {discardArmedScope === targetScope
            ? t("Confirm discard draft")
            : t("Discard current draft")}
        </button>
      ) : null}
      <ContextRecoveryPanel store={store} />
      {contextConflicts.length ? (
        <section className="project-workspace-context-conflicts" role="alert">
          <p>
            {t(
              "Both windows changed these project context fields. Choose a value for each before saving.",
            )}
          </p>
          <ul>
            {contextConflicts.map((field) => (
              <li key={field}>
                <span>
                  {field === "instructions"
                    ? t("Project instructions")
                    : field === "defaultScene"
                      ? t("Default scene")
                      : t("Session budget")}
                </span>
                <button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() => {
                    resolveContextConflict(field, "saved");
                    setSaveError(null);
                  }}
                >
                  {t("Use saved value")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() => {
                    resolveContextConflict(field, "draft");
                    setSaveError(null);
                  }}
                >
                  {t("Keep my edit")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Field label={t("Project instructions")} htmlFor="project-instructions">
        <textarea
          id="project-instructions"
          className="ui-textarea"
          rows={7}
          maxLength={50_000}
          value={draft.instructions}
          placeholder={t("Describe goals, conventions, constraints, and the definition of done.")}
          onChange={(event) => setContextDraft({ instructions: event.target.value })}
        />
      </Field>
      <Field label={t("Default scene")} htmlFor="project-scene">
        <Select
          id="project-scene"
          value={draft.defaultScene}
          label={t("Default scene")}
          options={[
            { value: "programming", label: t("Programming") },
            { value: "finance", label: t("Finance") },
            { value: "creative", label: t("Creative") },
          ]}
          onChange={(value) => setContextDraft({ defaultScene: value })}
        />
      </Field>
      <Field label={t("Session budget")} htmlFor="project-budget">
        <input
          id="project-budget"
          className="ui-input"
          value={budget}
          placeholder={t("Optional cost limit")}
          onChange={(event) => setContextDraft({ budget: event.target.value })}
        />
      </Field>
      {contextDraft && !profileError ? (
        <details className="project-workspace-context-saved" open={contextConflicts.length > 0}>
          <summary>{t("Saved project context")}</summary>
          <dl>
            <div>
              <dt>{t("Project instructions")}</dt>
              <dd>{profile.instructions || "—"}</dd>
            </div>
            <div>
              <dt>{t("Default scene")}</dt>
              <dd>{profile.defaultScene}</dd>
            </div>
            <div>
              <dt>{t("Session budget")}</dt>
              <dd>{String(profile.budget ?? "—")}</dd>
            </div>
          </dl>
        </details>
      ) : null}
      <button
        type="submit"
        className="ui-button ui-button--primary"
        disabled={
          saving || refreshing || loading || Boolean(profileError) || contextConflicts.length > 0
        }
      >
        {t("Save project context")}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label className="project-workspace-field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function KnowledgeView({ store }: { store: ProjectStore }) {
  const knowledge = store((state) => state.snapshot.knowledge);
  const prepareContextPack = store((state) => state.prepareContextPack);
  const loading = store((state) => state.loading);
  return (
    <section className="project-workspace-knowledge">
      <p className="project-workspace-state">
        {t(
          "Context actions prepare note references in the current project's chat draft. Check and send the draft yourself; note contents are read only after you send it.",
        )}
      </p>
      <section className="ui-panel">
        <h2>{t("Note links and backlinks")}</h2>
        {knowledge.links.length === 0 ? (
          <p className="project-workspace-state">{t("No note links yet")}</p>
        ) : (
          <ul>
            {knowledge.links.map((link) => (
              <li key={`${link.fromTitle}-${link.toTitle}`}>
                <strong>{link.fromTitle}</strong>
                <span className="project-workspace-link-arrow">→</span>
                <strong>{link.toTitle}</strong>
                <span className="project-workspace-result-type">
                  {t(link.kind === "wikilink" ? "Wiki link" : "Note reference")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ui-panel">
        <h2>{t("Similar notes")}</h2>
        {knowledge.similar.length === 0 ? (
          <p className="project-workspace-state">{t("No similar notes yet")}</p>
        ) : (
          <ul>
            {knowledge.similar.map((pair) => (
              <li key={`${pair.leftNoteId}-${pair.rightNoteId}`}>
                <strong>
                  {pair.leftTitle} ↔ {pair.rightTitle}
                </strong>
                <span className="project-workspace-result-summary">
                  {pair.sharedTags.join(", ")}
                </span>
                <span className="project-workspace-result-type">
                  {Math.round(pair.score * 100)}%
                </span>
                <ContextPackButton
                  disabled={loading}
                  prepare={prepareContextPack}
                  request={{
                    snapshot: knowledge,
                    compare: false,
                    notes: [
                      {
                        notebookId: pair.leftNotebookId,
                        noteId: pair.leftNoteId,
                        title: pair.leftTitle,
                      },
                      {
                        notebookId: pair.rightNotebookId,
                        noteId: pair.rightNoteId,
                        title: pair.rightTitle,
                      },
                    ],
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ui-panel project-workspace-conflicts">
        <h2>{t("Potential conflicts")}</h2>
        {knowledge.conflicts.length === 0 ? (
          <p className="project-workspace-state">{t("No potential conflicts detected")}</p>
        ) : (
          <ul>
            {knowledge.conflicts.map((conflict) => (
              <li key={`${conflict.leftNoteId}-${conflict.rightNoteId}`}>
                <strong>
                  {conflict.leftTitle} ↔ {conflict.rightTitle}
                </strong>
                <span className="project-workspace-result-summary">
                  {t(
                    conflict.reason === "source_changed"
                      ? "Same source has changed"
                      : "Duplicate title with different content",
                  )}
                </span>
                <ContextPackButton
                  disabled={loading}
                  prepare={prepareContextPack}
                  request={{
                    snapshot: knowledge,
                    compare: true,
                    notes: [
                      {
                        notebookId: conflict.leftNotebookId,
                        noteId: conflict.leftNoteId,
                        title: conflict.leftTitle,
                      },
                      {
                        notebookId: conflict.rightNotebookId,
                        noteId: conflict.rightNoteId,
                        title: conflict.rightTitle,
                      },
                    ],
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function SearchView({ store }: { store: ProjectStore }) {
  const snapshot = store((state) => state.snapshot);
  const searchQuery = store((state) => state.searchQuery);
  const sessionSearchResults = store((state) => state.sessionSearchResults);
  const runProjectSearch = store((state) => state.runProjectSearch);
  const openResult = store((state) => state.openResult);
  const [query, setQuery] = useState(searchQuery);
  const matches = projectSearchMatches(snapshot, searchQuery, sessionSearchResults);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runProjectSearch(query.trim());
  }

  return (
    <section className="project-workspace-search">
      <form className="project-workspace-search-form" onSubmit={handleSubmit}>
        <label className="project-workspace-search-field">
          <span className="project-workspace-search-label">{t("Project search")}</span>
          <input
            className="ui-input"
            type="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            placeholder={t("Search conversations, notes, files, and artifacts")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="ui-button ui-button--primary">
          {t("Search")}
        </button>
      </form>
      <section className="ui-panel project-workspace-search-results">
        <h2>{t("Project results")}</h2>
        {!searchQuery ? (
          <p className="project-workspace-state">
            {t("Enter a query to search across the current project.")}
          </p>
        ) : matches.length === 0 ? (
          <p className="project-workspace-state">{t("No project results found")}</p>
        ) : (
          <ul>
            {matches.map((match) => (
              <li key={`${match.kind}-${String(match.title ?? "")}`}>
                <button
                  type="button"
                  className="project-workspace-result-row"
                  onClick={() => openResult(match as Record<string, unknown>)}
                >
                  <span className="project-workspace-result-type">{String(match.kind)}</span>
                  <strong>{String(match.title || t("Untitled"))}</strong>
                  <span className="project-workspace-result-summary">
                    {String(
                      (match as Record<string, unknown>).snippet ||
                        (match as Record<string, unknown>).summary ||
                        (match as Record<string, unknown>).path ||
                        "",
                    )}
                  </span>
                  <span className="project-workspace-result-open">{t("Open in app")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ActivityView({ store }: { store: ProjectStore }) {
  const snapshot = store((state) => state.snapshot);
  const entries = [
    ...snapshot.notes.map((item) => ({ ...item, kind: t("Note updated") })),
    ...snapshot.artifacts.map((item) => ({ ...item, kind: t("Artifact created") })),
  ]
    .sort((left, right) =>
      String(right.updatedAt || right.createdAt).localeCompare(
        String(left.updatedAt || left.createdAt),
      ),
    )
    .slice(0, 20);
  return (
    <section className="ui-panel project-workspace-activity">
      <h2>{t("Recent activity")}</h2>
      {entries.length === 0 ? (
        <p className="project-workspace-state">{t("No project activity yet")}</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id ?? entry.title}`}>
              <span>{entry.kind}</span>
              <strong>{entry.title || t("Untitled")}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StatePanel({
  title,
  detail,
  retry,
}: {
  title: string;
  detail: string;
  retry?: () => void;
}) {
  return (
    <section className="ui-panel project-workspace-state-panel">
      <h2>{title}</h2>
      <p>{detail}</p>
      {retry ? (
        <button type="button" className="ui-button ui-button--primary" onClick={retry}>
          {t("Retry")}
        </button>
      ) : null}
    </section>
  );
}

export interface ProjectWorkspaceAppApi {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  setTarget(target: unknown): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
  getProfile(): Promise<ProjectProfile>;
}

export function createProjectWorkspaceApp(
  options: ProjectWorkspaceOptions,
): ProjectWorkspaceAppApi {
  const store = createProjectWorkspaceStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <ProjectNav store={store} />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <ProjectMain store={store} />, contentRoot);
      if (!store.getState().loading) void store.getState().load();
    },
    setTarget(target) {
      store.getState().setTarget(target as ProjectTarget | null);
    },
    handlesCommand(commandId) {
      return commandId === "projects.open";
    },
    executeCommand() {
      options.openApp?.("com.zicode.projects");
    },
    refresh() {
      return store.getState().load();
    },
    getProfile() {
      return store.getState().loadProfile();
    },
  };
}
