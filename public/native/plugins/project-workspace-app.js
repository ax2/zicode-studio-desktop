import { t } from "../../i18n.js";

const STORAGE_KEY = "zicode.project-workspaces.v1";

export function projectWorkspaceKey(target) {
  return target?.workspaceId || target?.cwd || target?.projectPath || "default";
}

export function readProjectWorkspaceProfile({ storage = globalThis.localStorage, target } = {}) {
  try {
    const state = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    return state?.version === 1 && state.projects?.[projectWorkspaceKey(target)]
      ? state.projects[projectWorkspaceKey(target)]
      : { instructions: "", defaultScene: target?.sceneId || "programming", budget: "" };
  } catch {
    return { instructions: "", defaultScene: target?.sceneId || "programming", budget: "" };
  }
}

export function setupProjectWorkspaceApp({
  notesGateway,
  artifactGateway,
  dataGateway,
  call,
  getTarget = () => null,
  storage = globalThis.localStorage,
  openApp = () => {},
  onUseContextPack = () => {},
  notify = () => {},
} = {}) {
  let target = getTarget?.();
  let activeView = "overview";
  let navigationRoot = null;
  let contentRoot = null;
  let snapshot = EMPTY_SNAPSHOT;
  let loading = false;
  let error = null;
  let profile = readProjectWorkspaceProfile({ storage, target });
  let searchQuery = "";
  let sessionSearchResults = [];

  function projectKey() {
    return projectWorkspaceKey(target);
  }

  function readProfile() {
    return profile;
  }

  function saveLocalProfile(nextProfile) {
    let state = { version: 1, projects: {} };
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
      if (parsed?.version === 1 && parsed.projects) state = parsed;
    } catch {
      // Replace malformed optional UI state with a valid document.
    }
    state.projects[projectKey()] = { ...nextProfile, updatedAt: new Date().toISOString() };
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function loadProfile() {
    if (typeof call !== "function") return profile;
    const response = await call("read_project_profile");
    if (!response?.ok) throw new Error(response?.error || t("Could not load project context"));
    profile = response.data?.profile || profile;
    return profile;
  }

  async function saveProfile(nextProfile) {
    if (typeof call === "function") {
      const response = await call("write_project_profile", { profile: nextProfile });
      if (!response?.ok) throw new Error(response?.error || t("Could not save project context"));
      profile = response.data?.profile || nextProfile;
    } else {
      saveLocalProfile(nextProfile);
      profile = nextProfile;
    }
    return profile;
  }

  async function load() {
    if (loading) return;
    loading = true;
    error = null;
    render();
    const sceneId = target?.sceneId || "programming";
    try {
      const [notes, artifacts, knowledge, loadedProfile, sessions, files] = await Promise.all([
        notesGateway?.list?.(sceneId).catch((reason) => ({ error: reason })),
        artifactGateway?.list?.(sceneId).catch((reason) => ({ error: reason })),
        notesGateway?.knowledge?.(sceneId).catch((reason) => ({ error: reason })),
        loadProfile().catch((reason) => ({ error: reason })),
        target?.workspaceId
          ? dataGateway?.listSessions?.(target.workspaceId).catch((reason) => ({ error: reason }))
          : { sessions: [] },
        target?.workspaceId
          ? dataGateway?.listFiles?.(target.workspaceId, "").catch((reason) => ({ error: reason }))
          : { files: [] },
      ]);
      snapshot = {
        notebooks: notes?.snapshot?.notebooks ?? [],
        notes: notes?.snapshot?.notes ?? [],
        artifacts: artifacts?.snapshot?.artifacts ?? artifacts?.artifacts ?? [],
        knowledge: knowledge?.snapshot ?? { links: [], similar: [], conflicts: [] },
        sessions: sessions?.sessions ?? sessions?.projects?.[0]?.sessions ?? [],
        files: files?.files ?? files?.entries ?? [],
        warnings: [
          notes?.error,
          artifacts?.error,
          knowledge?.error,
          loadedProfile?.error,
          sessions?.error,
          files?.error,
        ].filter(Boolean),
      };
    } catch (reason) {
      error = reason instanceof Error ? reason : new Error(String(reason));
    } finally {
      loading = false;
      render();
    }
  }

  function renderNavigation(container = navigationRoot) {
    if (!container) return;
    navigationRoot = container;
    const nav = document.createElement("nav");
    nav.className = "project-workspace-navigation";
    nav.setAttribute("aria-label", t("Project workspace"));
    for (const [id, label] of [
      ["overview", "Overview"],
      ["context", "Project context"],
      ["knowledge", "Knowledge connections"],
      ["search", "Project search"],
      ["activity", "Recent activity"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-workspace-nav-item";
      button.classList.toggle("active", activeView === id);
      button.textContent = t(label);
      button.addEventListener("click", () => {
        activeView = id;
        renderNavigation();
        renderContent();
      });
      nav.append(button);
    }
    container.replaceChildren(nav);
  }

  function renderContent(container = contentRoot) {
    if (!container) return;
    contentRoot = container;
    render();
    if (!loading && snapshot === EMPTY_SNAPSHOT) void load();
  }

  function render() {
    if (!contentRoot) return;
    contentRoot.replaceChildren();
    const main = document.createElement("div");
    main.className = "project-workspace-main";
    const header = document.createElement("header");
    header.className = "project-workspace-header";
    const heading = document.createElement("div");
    heading.append(
      element("h1", "", projectName(target)),
      element("p", "project-workspace-path", target?.cwd || target?.projectPath || t("Local project")),
    );
    const refresh = button(t("Refresh"), () => void load(), "ui-button ui-button--secondary");
    refresh.disabled = loading;
    header.append(heading, refresh);
    main.append(header);
    if (error) {
      main.append(statePanel(t("Could not load project workspace"), error.message, () => void load()));
    } else if (activeView === "context") {
      main.append(contextEditor());
    } else if (activeView === "knowledge") {
      main.append(knowledgeView());
    } else if (activeView === "search") {
      main.append(searchView());
    } else if (activeView === "activity") {
      main.append(activityView());
    } else {
      main.append(overview());
    }
    contentRoot.append(main);
  }

  function overview() {
    const section = document.createElement("section");
    section.className = "project-workspace-overview";
    const stats = document.createElement("div");
    stats.className = "project-workspace-stats";
    for (const [value, label, action] of [
      [snapshot.notebooks.length, "Notebooks", () => openApp("com.zicode.notes")],
      [snapshot.notes.length, "Notes", () => openApp("com.zicode.notes")],
      [snapshot.artifacts.length, "Artifacts", () => openApp("com.zicode.artifacts")],
      [snapshot.sessions.length, "Sessions", () => openApp("core.chat")],
      [snapshot.files.length, "Files", () => document.dispatchEvent(new CustomEvent("picot:open-tree"))],
    ]) {
      const card = button("", action, "ui-card project-workspace-stat");
      card.append(element("strong", "", String(value)), element("span", "", t(label)));
      stats.append(card);
    }
    section.append(stats);
    if (loading) section.append(element("p", "project-workspace-state", t("Loading project…")));
    else if (!snapshot.notes.length && !snapshot.artifacts.length) {
      section.append(
        statePanel(
          t("Turn this conversation into a project"),
          t("Create notes and artifacts from the current conversation; they will stay connected here."),
        ),
      );
    } else {
      section.append(recentResults());
    }
    if (snapshot.warnings.length) {
      section.append(
        element(
          "p",
          "project-workspace-warning",
          t("Some project sources could not be refreshed. Existing results remain available."),
        ),
      );
    }
    return section;
  }

  function recentResults() {
    const group = document.createElement("section");
    group.className = "ui-panel project-workspace-results";
    group.append(element("h2", "", t("Recent project results")));
    const items = [
      ...snapshot.notes.slice(0, 4).map((item) => ({ ...item, type: t("Note") })),
      ...snapshot.artifacts.slice(0, 4).map((item) => ({ ...item, type: t("Artifact") })),
    ].slice(0, 6);
    const list = document.createElement("ul");
    for (const item of items) {
      const row = document.createElement("li");
      row.append(
        element("span", "project-workspace-result-type", item.type),
        element("strong", "", item.title || t("Untitled")),
        element("span", "project-workspace-result-summary", item.summary || item.excerpt || ""),
      );
      list.append(row);
    }
    group.append(list);
    return group;
  }

  function contextEditor() {
    const profile = readProfile();
    const form = document.createElement("form");
    form.className = "ui-panel project-workspace-context";
    form.append(element("h2", "", t("Project context")));
    const instructions = textareaField(
      t("Project instructions"),
      profile.instructions,
      t("Describe goals, conventions, constraints, and the definition of done."),
    );
    const scene = selectField(t("Default scene"), profile.defaultScene, [
      ["programming", t("Programming")],
      ["finance", t("Finance")],
      ["creative", t("Creative")],
    ]);
    const budget = inputField(t("Session budget"), profile.budget, t("Optional cost limit"));
    form.append(instructions.label, scene.label, budget.label);
    const save = button(t("Save project context"), null, "ui-button ui-button--primary");
    save.type = "submit";
    form.append(save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await saveProfile({
          instructions: instructions.control.value.trim(),
          defaultScene: scene.control.value,
          budget: budget.control.value.trim(),
        });
        notify({ title: t("Project context saved"), type: "success" });
      } catch (reason) {
        notify({ title: t("Could not save project context"), message: reason.message, type: "error" });
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }

  function activityView() {
    const panel = document.createElement("section");
    panel.className = "ui-panel project-workspace-activity";
    panel.append(element("h2", "", t("Recent activity")));
    const entries = [
      ...snapshot.notes.map((item) => ({ ...item, kind: t("Note updated") })),
      ...snapshot.artifacts.map((item) => ({ ...item, kind: t("Artifact created") })),
    ]
      .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
      .slice(0, 20);
    if (!entries.length) panel.append(element("p", "project-workspace-state", t("No project activity yet")));
    const list = document.createElement("ol");
    for (const entry of entries) {
      const item = document.createElement("li");
      item.append(element("span", "", entry.kind), element("strong", "", entry.title || t("Untitled")));
      list.append(item);
    }
    panel.append(list);
    return panel;
  }

  function knowledgeView() {
    const panel = document.createElement("section");
    panel.className = "project-workspace-knowledge";
    const links = document.createElement("section");
    links.className = "ui-panel";
    links.append(element("h2", "", t("Note links and backlinks")));
    const linkList = document.createElement("ul");
    for (const link of snapshot.knowledge.links) {
      const item = document.createElement("li");
      item.append(
        element("strong", "", link.fromTitle),
        element("span", "project-workspace-link-arrow", "→"),
        element("strong", "", link.toTitle),
        element("span", "project-workspace-result-type", t(link.kind === "wikilink" ? "Wiki link" : "Note reference")),
      );
      linkList.append(item);
    }
    if (!linkList.children.length) links.append(element("p", "project-workspace-state", t("No note links yet")));
    else links.append(linkList);
    const similar = document.createElement("section");
    similar.className = "ui-panel";
    similar.append(element("h2", "", t("Similar notes")));
    const similarList = document.createElement("ul");
    for (const pair of snapshot.knowledge.similar) {
      const item = document.createElement("li");
      item.append(
        element("strong", "", `${pair.leftTitle} ↔ ${pair.rightTitle}`),
        element("span", "project-workspace-result-summary", pair.sharedTags.join(", ")),
        element("span", "project-workspace-result-type", `${Math.round(pair.score * 100)}%`),
        button(
          t("Use context pack"),
          () =>
            onUseContextPack([
              { notebookId: pair.leftNotebookId, noteId: pair.leftNoteId, title: pair.leftTitle },
              { notebookId: pair.rightNotebookId, noteId: pair.rightNoteId, title: pair.rightTitle },
            ]),
          "ui-button ui-button--secondary ui-button--sm",
        ),
      );
      similarList.append(item);
    }
    if (!similarList.children.length) similar.append(element("p", "project-workspace-state", t("No similar notes yet")));
    else similar.append(similarList);
    const conflicts = document.createElement("section");
    conflicts.className = "ui-panel project-workspace-conflicts";
    conflicts.append(element("h2", "", t("Potential conflicts")));
    const conflictList = document.createElement("ul");
    for (const conflict of snapshot.knowledge.conflicts ?? []) {
      const item = document.createElement("li");
      item.append(
        element("strong", "", `${conflict.leftTitle} ↔ ${conflict.rightTitle}`),
        element(
          "span",
          "project-workspace-result-summary",
          t(conflict.reason === "source_changed" ? "Same source has changed" : "Duplicate title with different content"),
        ),
        button(
          t("Compare in chat"),
          () =>
            onUseContextPack([
              { notebookId: conflict.leftNotebookId, noteId: conflict.leftNoteId, title: conflict.leftTitle },
              { notebookId: conflict.rightNotebookId, noteId: conflict.rightNoteId, title: conflict.rightTitle },
            ], { compare: true }),
          "ui-button ui-button--secondary ui-button--sm",
        ),
      );
      conflictList.append(item);
    }
    if (!conflictList.children.length) conflicts.append(element("p", "project-workspace-state", t("No potential conflicts detected")));
    else conflicts.append(conflictList);
    panel.append(links, similar, conflicts);
    return panel;
  }

  function searchView() {
    const panel = document.createElement("section");
    panel.className = "project-workspace-search";
    const form = document.createElement("form");
    form.className = "project-workspace-search-form";
    const query = document.createElement("input");
    query.className = "ui-input";
    query.type = "search";
    query.value = searchQuery;
    query.placeholder = t("Search conversations, notes, files, and artifacts");
    const queryLabel = element("label", "project-workspace-search-field", "");
    queryLabel.append(element("span", "project-workspace-search-label", t("Project search")), query);
    const submit = button(t("Search"), null, "ui-button ui-button--primary");
    submit.type = "submit";
    form.append(queryLabel, submit);
    const results = document.createElement("section");
    results.className = "ui-panel project-workspace-search-results";
    renderProjectSearchResults(results);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      searchQuery = query.value.trim();
      sessionSearchResults = [];
      submit.disabled = true;
      if (searchQuery && target?.workspaceId && dataGateway?.searchSessions) {
        try {
          const response = await dataGateway.searchSessions(target.workspaceId, searchQuery);
          sessionSearchResults = response?.results ?? response?.sessions ?? [];
        } catch (reason) {
          notify({ title: t("Conversation search failed"), message: reason.message, type: "error" });
        }
      }
      submit.disabled = false;
      renderProjectSearchResults(results);
    });
    panel.append(form, results);
    return panel;
  }

  function renderProjectSearchResults(container) {
    container.replaceChildren();
    container.append(element("h2", "", t("Project results")));
    if (!searchQuery) {
      container.append(element("p", "project-workspace-state", t("Enter a query to search across the current project.")));
      return;
    }
    const normalized = searchQuery.toLocaleLowerCase();
    const matches = [
      ...snapshot.notes.filter((item) => searchable(item).includes(normalized)).map((item) => ({ ...item, kind: t("Note") })),
      ...snapshot.artifacts.filter((item) => searchable(item).includes(normalized)).map((item) => ({ ...item, kind: t("Artifact") })),
      ...snapshot.files.filter((item) => searchable(item).includes(normalized)).map((item) => ({ ...item, title: item.name || item.path, kind: t("File") })),
      ...sessionSearchResults.map((item) => ({ ...item, title: item.title || item.name || item.sessionId, kind: t("Conversation") })),
    ].slice(0, 100);
    if (!matches.length) {
      container.append(element("p", "project-workspace-state", t("No project results found")));
      return;
    }
    const list = document.createElement("ul");
    for (const match of matches) {
      const row = document.createElement("li");
      row.append(
        element("span", "project-workspace-result-type", match.kind),
        element("strong", "", match.title || t("Untitled")),
        element("span", "project-workspace-result-summary", match.snippet || match.summary || match.path || ""),
      );
      list.append(row);
    }
    container.append(list);
  }

  function setTarget(nextTarget) {
    const changed = projectKey() !== (nextTarget?.workspaceId || nextTarget?.cwd || nextTarget?.projectPath || "default");
    target = nextTarget;
    if (changed) {
      snapshot = EMPTY_SNAPSHOT;
      profile = readProjectWorkspaceProfile({ storage, target });
    }
    render();
    if (changed) void load();
  }

  return {
    renderNavigation,
    renderContent,
    setTarget,
    handlesCommand: (commandId) => commandId === "projects.open",
    executeCommand: () => openApp("com.zicode.projects"),
    refresh: load,
    getProfile: loadProfile,
  };
}

const EMPTY_SNAPSHOT = Object.freeze(emptySnapshot());

function emptySnapshot() {
  return {
    notebooks: [],
    notes: [],
    artifacts: [],
    sessions: [],
    files: [],
    knowledge: { links: [], similar: [], conflicts: [] },
    warnings: [],
  };
}

function searchable(item) {
  return [item?.title, item?.name, item?.summary, item?.excerpt, item?.path]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function projectName(target) {
  const path = target?.cwd || target?.projectPath || "";
  return target?.workspaceName || path.split(/[\\/]/).filter(Boolean).at(-1) || t("Project workspace");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text ?? "";
  return node;
}

function button(text, onClick, className) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = text;
  if (onClick) control.addEventListener("click", onClick);
  return control;
}

function statePanel(title, detail, retry) {
  const panel = document.createElement("section");
  panel.className = "ui-panel project-workspace-state-panel";
  panel.append(element("h2", "", title), element("p", "", detail));
  if (retry) panel.append(button(t("Retry"), retry, "ui-button ui-button--primary"));
  return panel;
}

function textareaField(labelText, value, hint) {
  const label = element("label", "project-workspace-field", "");
  label.append(element("span", "", labelText));
  const control = document.createElement("textarea");
  control.className = "ui-textarea";
  control.rows = 7;
  control.value = value;
  control.placeholder = hint;
  label.append(control);
  return { label, control };
}

function selectField(labelText, value, options) {
  const label = element("label", "project-workspace-field", "");
  label.append(element("span", "", labelText));
  const control = document.createElement("select");
  control.className = "ui-select";
  for (const [id, text] of options) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text;
    option.selected = id === value;
    control.append(option);
  }
  label.append(control);
  return { label, control };
}

function inputField(labelText, value, placeholder) {
  const label = element("label", "project-workspace-field", "");
  label.append(element("span", "", labelText));
  const control = document.createElement("input");
  control.className = "ui-input";
  control.value = value;
  control.placeholder = placeholder;
  label.append(control);
  return { label, control };
}
