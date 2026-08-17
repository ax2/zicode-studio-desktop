import { useState, type FormEvent, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n.js";
import { Select } from "../../shared/Select";
import {
  projectName,
  type ProjectTarget,
  type ProjectProfile,
  type ProjectSnapshot,
} from "./logic";
import { projectSearchMatches, createProjectWorkspaceStore, type ProjectWorkspaceOptions, type ProjectView } from "./store";

type ProjectStore = ReturnType<typeof createProjectWorkspaceStore>;

const PROJECT_VIEWS: Array<[ProjectView, string]> = [
  ["overview", "Overview"],
  ["context", "Project context"],
  ["knowledge", "Knowledge connections"],
  ["search", "Project search"],
  ["activity", "Recent activity"],
];

export function ProjectNav({ store }: { store: ProjectStore }) {
  const activeView = store((state) => state.activeView);
  const setActiveView = store((state) => state.setActiveView);
  return (
    <nav className="project-workspace-navigation" aria-label={t("Project workspace")}>
      {PROJECT_VIEWS.map(([id, label]) => (
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
  const target = store((state) => state.target);
  const activeView = store((state) => state.activeView);
  const loading = store((state) => state.loading);
  const error = store((state) => state.error);
  const load = store((state) => state.load);
  return (
    <div className="project-workspace-main">
      <header className="project-workspace-header">
        <div>
          <h1>{projectName(target)}</h1>
          <p className="project-workspace-path">
            {target?.cwd || target?.projectPath || t("Local project")}
          </p>
        </div>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("Refresh")}
        </button>
      </header>
      {error ? (
        <StatePanel
          title={t("Could not load project workspace")}
          detail={error.message}
          retry={() => void load()}
        />
      ) : activeView === "context" ? (
        <ContextEditor store={store} />
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
  const snapshot = store((state) => state.snapshot);
  const loading = store((state) => state.loading);
  const openApp = store((state) => state.openApp);
  const stats: Array<[number, string, () => void]> = [
    [snapshot.notebooks.length, "Notebooks", () => openApp("com.zicode.notes")],
    [snapshot.notes.length, "Notes", () => openApp("com.zicode.notes")],
    [snapshot.artifacts.length, "Artifacts", () => openApp("com.zicode.artifacts")],
    [snapshot.sessions.length, "Sessions", () => openApp("core.chat")],
    [
      snapshot.files.length,
      "Files",
      () => window.dispatchEvent(new CustomEvent("zicode:open-files")),
    ],
    [snapshot.taskCount, "Tasks", () => openApp("com.zicode.tasks")],
    [snapshot.automationCount, "Automations", () => openApp("com.zicode.automation")],
  ];
  return (
    <section className="project-workspace-overview">
      <div className="project-workspace-stats">
        {stats.map(([value, label, action]) => (
          <button key={label} type="button" className="ui-card project-workspace-stat" onClick={action}>
            <strong>{value}</strong>
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
      {loading ? (
        <p className="project-workspace-state">{t("Loading project…")}</p>
      ) : !snapshot.notes.length && !snapshot.artifacts.length ? (
        <StatePanel
          title={t("Turn this conversation into a project")}
          detail={t(
            "Create notes and artifacts from the current conversation; they will stay connected here.",
          )}
        />
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
  const contextDraft = store((state) => state.contextDraft);
  const saveProfile = store((state) => state.saveProfile);
  const setContextDraft = store((state) => state.setContextDraft);
  const notify = store((state) => state.notify);
  const [saving, setSaving] = useState(false);
  const draft = contextDraft ?? profile;
  const budget = String(draft.budget ?? "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveProfile({
        instructions: draft.instructions.trim(),
        defaultScene: draft.defaultScene,
        budget: String(draft.budget ?? "").trim(),
      });
      notify({ title: t("Project context saved"), type: "success" });
    } catch (reason) {
      notify({
        title: t("Could not save project context"),
        message: reason instanceof Error ? reason.message : String(reason),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ui-panel project-workspace-context" onSubmit={handleSubmit}>
      <h2>{t("Project context")}</h2>
      <Field label={t("Project instructions")} htmlFor="project-instructions">
        <textarea
          id="project-instructions"
          className="ui-textarea"
          rows={7}
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
      <button type="submit" className="ui-button ui-button--primary" disabled={saving}>
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
  const onUseContextPack = store((state) => state.onUseContextPack);
  return (
    <section className="project-workspace-knowledge">
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
                <button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() =>
                    onUseContextPack([
                      { notebookId: pair.leftNotebookId, noteId: pair.leftNoteId, title: pair.leftTitle },
                      { notebookId: pair.rightNotebookId, noteId: pair.rightNoteId, title: pair.rightTitle },
                    ])
                  }
                >
                  {t("Use context pack")}
                </button>
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
                <button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() =>
                    onUseContextPack(
                      [
                        { notebookId: conflict.leftNotebookId, noteId: conflict.leftNoteId, title: conflict.leftTitle },
                        { notebookId: conflict.rightNotebookId, noteId: conflict.rightNoteId, title: conflict.rightTitle },
                      ],
                      { compare: true },
                    )
                  }
                >
                  {t("Compare in chat")}
                </button>
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
                  <span className="project-workspace-result-type">
                    {String(match.kind)}
                  </span>
                  <strong>{String(match.title || t("Untitled"))}</strong>
                  <span className="project-workspace-result-summary">
                    {String(
                      (match as Record<string, unknown>).snippet ||
                        (match as Record<string, unknown>).summary ||
                        (match as Record<string, unknown>).path ||
                        "",
                    )}
                  </span>
                  <span className="project-workspace-result-open">
                    {t("Open in app")}
                  </span>
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
      contentRoot = mountPluginSurface(
        container,
        <ProjectMain store={store} />,
        contentRoot,
      );
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
