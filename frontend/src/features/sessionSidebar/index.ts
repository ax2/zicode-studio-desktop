import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { t } from "../../shared/i18n";
// @ts-expect-error plain JS module without type declarations (public/native/)
import { randomId } from "../../../../public/native/utils/random-id.js";
// @ts-expect-error plain JS module without type declarations (public/)
import { isSuperAgentProjectPath } from "../../../../public/super-agent/session.js";
import {
  SessionSidebarApp,
  type SessionSidebarController,
} from "./SessionSidebarApp";
import {
  projectMarkdownFileName,
  renderProjectSessionsMarkdown,
  renderSessionMarkdown,
  sessionMarkdownFileName,
} from "./sessionMarkdown";
import {
  groupByProject,
  hasLiveStatus,
  isUnreadSession,
  isWorkingSession,
  LOAD_RETRY_DELAYS_MS,
  mergeSessionSummary,
  readArray,
  readObject,
  readSessionCache,
  sessionListSignature,
  STORAGE,
  INITIAL_LIMIT,
  STEP,
  writeSessionCache,
  type ProjectGroup,
  type SessionSearchResult,
  type SessionSummary,
} from "./sessionSidebarLogic";
import {
  createSidebarStore,
  type ContextMenuRow,
  type SidebarStoreHook,
} from "./sessionSidebarStore";

export { formatSessionTime } from "./sessionSidebarLogic";
export type {
  SessionSummary,
  SessionSearchResult,
} from "./sessionSidebarLogic";
export type { SidebarStoreHook } from "./sessionSidebarStore";

export interface SessionSidebarOptions {
  data: {
    listAllSessions(
      workspaceId: string,
    ): Promise<{ sessions: SessionSummary[] }>;
    searchSessions(
      workspaceId: string,
      query: string,
    ): Promise<{ results: SessionSearchResult[] }>;
    readSessionMessages(
      workspaceId: string,
      sessionId: string,
    ): Promise<unknown[]>;
  };
  runtime: {
    request(
      request: { type: string; name?: string },
      target: unknown,
      options?: { idempotencyKey?: string },
    ): Promise<unknown>;
  };
  control: {
    deleteSessions(
      ids: string[],
    ): Promise<{ deleted: string[]; errors: unknown[] }>;
  };
  getTarget(): { workspaceId: string; sessionId?: string };
  onSelect(session: SessionSummary): void;
  onSessionsLoaded?(sessions: SessionSummary[]): void;
  notify?(payload: {
    title: string;
    message?: string;
    type?: string;
  }): void;
  confirm?(message: string): boolean | Promise<boolean>;
}

export class SessionSidebar implements SessionSidebarController {
  container: HTMLElement;
  data: SessionSidebarOptions["data"];
  runtime: SessionSidebarOptions["runtime"];
  control: SessionSidebarOptions["control"];
  getTarget: SessionSidebarOptions["getTarget"];
  onSelect: SessionSidebarOptions["onSelect"];
  onSessionsLoaded?: SessionSidebarOptions["onSessionsLoaded"];
  notify: NonNullable<SessionSidebarOptions["notify"]>;
  confirm: NonNullable<SessionSidebarOptions["confirm"]>;

  store: SidebarStoreHook;
  root: Root;

  private _loadSeq = 0;
  private _loadCommitted = 0;
  private _searchTimer: ReturnType<typeof setTimeout> | null = null;
  private _contextMenuTrigger: HTMLElement | null = null;

  constructor(container: HTMLElement, options: SessionSidebarOptions) {
    this.container = container;
    this.data = options.data;
    this.runtime = options.runtime;
    this.control = options.control;
    this.getTarget = options.getTarget;
    this.onSelect = options.onSelect;
    this.onSessionsLoaded = options.onSessionsLoaded;
    this.notify = options.notify ?? (() => {});
    this.confirm =
      options.confirm ?? ((message: string) => globalThis.confirm?.(message) ?? false);

    this.store = createSidebarStore({
      activeSessionId: options.getTarget()?.sessionId ?? null,
    });
    this.commit({
      favourites: readArray(STORAGE.favourites),
      archived: readArray(STORAGE.archived),
      projectsCollapsed: readObject(STORAGE.projectsCollapsed) as Record<
        string,
        boolean
      >,
      unread: readArray(STORAGE.unread),
    });
    this.root = createRoot(container);
    flushSync(() => {
      this.root.render(
        createElement(SessionSidebarApp, {
          controller: this,
          store: this.store,
          container,
        }),
      );
    });
    this.container.addEventListener("keydown", this.handleSidebarKeydown);
  }

  get sessions(): SessionSummary[] {
    return this.store.getState().sessions;
  }

  commit(patch: Partial<ReturnType<SidebarStoreHook["getState"]>>): void {
    this.store.setState(patch);
    flushSync(() => {});
  }

  // Force the React tree to commit synchronously. Store mutations already
  // flush, so this mainly preserves the render() contract for callers/tests.
  render(): void {
    flushSync(() => {});
  }

  dispose(): void {
    this.container.removeEventListener("keydown", this.handleSidebarKeydown);
    this.root.unmount();
  }

  // ── keyboard navigation (roving tabindex) ─────────────────────────
  isSidebarItemVisible = (element: Element): boolean => {
    if (element.closest(".hidden")) return false;
    if (element.closest(".project-sessions.collapsed")) return false;
    const group = element.closest(
      ".super-agent-pinned-group, .favourites-group, .project-group, .archived-group",
    );
    if (group && getComputedStyle(group).display === "none") return false;
    return true;
  };

  private focusSidebarItem(element: HTMLElement): void {
    const items =
      this.container.querySelectorAll<HTMLElement>(
        ".session-item, .project-header",
      ) ?? [];
    for (const item of items) item.tabIndex = -1;
    element.tabIndex = 0;
    element.focus();
  }

  private handleSidebarKeydown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.matches(".session-item, .project-header")
    ) {
      return;
    }
    if (!this.container.contains(target)) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      return;
    }
    const scope = Array.from(
      this.container.querySelectorAll<HTMLElement>(
        ".session-item, .project-header",
      ),
    ).filter(this.isSidebarItemVisible);
    if (scope.length === 0) return;
    const index = scope.indexOf(target);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.focusSidebarItem(scope[(index + 1) % scope.length]);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.focusSidebarItem(scope[(index - 1 + scope.length) % scope.length]);
        break;
      case "Home":
        event.preventDefault();
        this.focusSidebarItem(scope[0]);
        break;
      case "End":
        event.preventDefault();
        this.focusSidebarItem(scope[scope.length - 1]);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        target.click();
        break;
    }
  };

  // ── persistence helpers ─────────────────────────────────────────
  isFavourite(id: string): boolean {
    return this.store.getState().favourites.includes(id);
  }

  isArchived(id: string): boolean {
    return this.store.getState().archived.includes(id);
  }

  toggleFavourite(id: string): void {
    const state = this.store.getState();
    const favourites = state.favourites.includes(id)
      ? state.favourites.filter((entry) => entry !== id)
      : [...state.favourites, id];
    this.commit({ favourites });
    localStorage.setItem(STORAGE.favourites, JSON.stringify(favourites));
    this.render();
  }

  toggleArchived(id: string): void {
    const state = this.store.getState();
    const wasArchived = state.archived.includes(id);
    const archived = wasArchived
      ? state.archived.filter((entry) => entry !== id)
      : [...state.archived, id];
    this.commit({
      archived,
      // Reveal the archived group right after archiving so the action is
      // visible and can be undone in one click.
      ...(wasArchived ? {} : { archivedCollapsed: false }),
    });
    localStorage.setItem(STORAGE.archived, JSON.stringify(archived));
    if (!wasArchived) {
      localStorage.setItem(STORAGE.archivedCollapsed, "false");
    }
    this.render();
  }

  archiveProject(project: ProjectGroup): void {
    const state = this.store.getState();
    const ids = state.sessions
      .filter(
        (session) =>
          session.projectPath === project.path &&
          !isSuperAgentProjectPath(session.projectPath),
      )
      .map((session) => session.id);
    if (ids.length === 0) return;
    const projectIds = new Set(ids);
    const archived = [...new Set([...state.archived, ...ids])];
    const favourites = state.favourites.filter((id) => !projectIds.has(id));
    this.commit({ archived, favourites, archivedCollapsed: false });
    localStorage.setItem(STORAGE.archived, JSON.stringify(archived));
    localStorage.setItem(STORAGE.favourites, JSON.stringify(favourites));
    localStorage.setItem(STORAGE.archivedCollapsed, "false");
    this.render();
  }

  requestDeleteAllArchived(): void {
    const count = this.store.getState().archived.length;
    if (count === 0 || !this.control) return;
    this.commit({ confirmDeleteCount: count });
  }

  deleteAllArchived(): void {
    this.requestDeleteAllArchived();
  }

  cancelDeleteAll(): void {
    this.commit({ confirmDeleteCount: null });
  }

  async confirmDeleteAll(): Promise<void> {
    const ids = [...this.store.getState().archived];
    if (ids.length === 0 || !this.control) {
      this.commit({ confirmDeleteCount: null });
      return;
    }
    this.commit({ confirmDeleteCount: null });
    try {
      const { deleted } = await this.control.deleteSessions(ids);
      const deletedSet = new Set(deleted);
      const state = this.store.getState();
      this.commit({
        archived: state.archived.filter((id) => !deletedSet.has(id)),
        sessions: state.sessions.filter((session) => !deletedSet.has(session.id)),
      });
      localStorage.setItem(
        STORAGE.archived,
        JSON.stringify(this.store.getState().archived),
      );
    } catch (error) {
      console.error("[Sidebar] deleteAllArchived failed:", error);
    }
  }

  // ── status indicators (driven by the caller) ────────────────────
  setActive(sessionId: string | null): void {
    const state = this.store.getState();
    let unread = state.unread;
    if (sessionId && unread.includes(sessionId)) {
      unread = unread.filter((id) => id !== sessionId);
      localStorage.setItem(STORAGE.unread, JSON.stringify(unread));
    }
    this.commit({ activeSessionId: sessionId, unread });
  }

  markUnread(id: string): void {
    const state = this.store.getState();
    if (!id || id === state.activeSessionId || state.unread.includes(id)) return;
    const unread = [...state.unread, id];
    this.commit({ unread });
    localStorage.setItem(STORAGE.unread, JSON.stringify(unread));
  }

  markRead(id: string): void {
    const state = this.store.getState();
    if (!id || !state.unread.includes(id)) return;
    const unread = state.unread.filter((entry) => entry !== id);
    this.commit({ unread });
    localStorage.setItem(STORAGE.unread, JSON.stringify(unread));
  }

  setStreaming(id: string, streaming: boolean): void {
    if (!id) return;
    const state = this.store.getState();
    const had = state.streaming.includes(id);
    if (streaming === had) return;
    const next = streaming
      ? [...state.streaming, id]
      : state.streaming.filter((entry) => entry !== id);
    this.commit({ streaming: next });
  }

  clearStreaming(): void {
    if (this.store.getState().streaming.length === 0) return;
    this.commit({ streaming: [] });
  }

  private hydrateStatuses(sessions: SessionSummary[]): void {
    const state = this.store.getState();
    const streaming = new Set(state.streaming);
    const unread = new Set(state.unread);
    for (const session of sessions) {
      if (!session?.id) continue;
      if (isWorkingSession(session)) streaming.add(session.id);
      else if (hasLiveStatus(session)) streaming.delete(session.id);

      if (isUnreadSession(session) && session.id !== state.activeSessionId) {
        unread.add(session.id);
      } else if (session.id === state.activeSessionId) {
        unread.delete(session.id);
      }
    }
    const unreadList = [...unread];
    this.commit({ streaming: [...streaming], unread: unreadList });
    localStorage.setItem(STORAGE.unread, JSON.stringify(unreadList));
  }

  // ── loading ─────────────────────────────────────────────────────
  async load({ quiet = false, retryAttempt = 0 } = {}): Promise<void> {
    const seq = ++this._loadSeq;
    const workspaceId = this.getTarget()?.workspaceId;
    if (!workspaceId) return;
    let renderedFromCache = false;
    if (!quiet && this.store.getState().sessions.length === 0) {
      const cachedSessions = readSessionCache(
        workspaceId,
        this.store.getState().activeSessionId,
      );
      if (cachedSessions.length > 0) {
        this.commit({ sessions: cachedSessions, phase: "ready" });
        this.hydrateStatuses(cachedSessions);
        this.onSessionsLoaded?.(cachedSessions);
        this.render();
        renderedFromCache = true;
      }
    }
    if (!quiet && this.store.getState().sessions.length === 0) {
      this.commit({ phase: "skeleton" });
    }
    const previousSignature = sessionListSignature(this.store.getState().sessions);
    try {
      const response = await this.data.listAllSessions(workspaceId);
      if (seq < this._loadCommitted) return;
      this._loadCommitted = seq;
      const nextSessions = response.sessions ?? [];
      // Preserve a just-created active session that the server hasn't persisted
      // yet (see vanilla comments: quiet reload right after upsertSession).
      const activeId = this.store.getState().activeSessionId;
      if (
        activeId &&
        !nextSessions.some((session) => session?.id === activeId)
      ) {
        const local = this.store
          .getState()
          .sessions.find((session) => session?.id === activeId);
        if (local) nextSessions.unshift(local);
      }
      const changed =
        sessionListSignature(nextSessions) !== previousSignature;
      this.commit({ sessions: nextSessions, phase: "ready" });
      this.hydrateStatuses(nextSessions);
      writeSessionCache(workspaceId, nextSessions);
      this.onSessionsLoaded?.(nextSessions);
      if (changed || (!quiet && !renderedFromCache)) this.render();
    } catch (error) {
      if (seq < this._loadCommitted) return;
      const retryDelay = LOAD_RETRY_DELAYS_MS[retryAttempt];
      if (retryDelay != null) {
        console.warn("[Sidebar] Session load failed; retrying:", error);
        if (!quiet && this.store.getState().sessions.length === 0) {
          this.commit({ phase: "loading" });
        }
        setTimeout(() => {
          if (seq === this._loadSeq) {
            this.load({ quiet: true, retryAttempt: retryAttempt + 1 });
          }
        }, retryDelay);
        return;
      }
      console.error("[Sidebar] Failed to load sessions:", error);
      if (this.store.getState().sessions.length > 0) return;
      this.commit({ phase: "error" });
    }
  }

  retryLoad(): void {
    this.load().catch(() => {});
  }

  upsertSession(session: SessionSummary): void {
    if (!session?.id) return;
    const state = this.store.getState();
    const index = state.sessions.findIndex(
      (existing) => existing.id === session.id,
    );
    const existing = index >= 0 ? state.sessions[index] : null;
    const projectFallback =
      existing ??
      state.sessions.find((candidate) => candidate.isCurrentWorkspace) ??
      state.sessions[0] ??
      {};
    const next = mergeSessionSummary(existing, {
      workspaceId: this.getTarget()?.workspaceId ?? projectFallback.workspaceId ?? "",
      projectPath:
        projectFallback.projectPath ?? this.getTarget()?.workspaceId ?? "unknown",
      projectName:
        projectFallback.projectName ?? projectFallback.projectPath ?? "Current project",
      isCurrentWorkspace: true,
      fileName: "",
      ...session,
    });
    const nextSessions = state.sessions.filter(
      (candidate) => candidate.id !== session.id,
    );
    nextSessions.unshift(next);
    this.commit({ sessions: nextSessions });
    this.hydrateStatuses(nextSessions);
    writeSessionCache(this.getTarget()?.workspaceId, nextSessions);
    this.onSessionsLoaded?.(nextSessions);
    this.render();
  }

  // ── search ──────────────────────────────────────────────────────
  setSearchQuery(query: string): void {
    const normalized = (query || "").toLowerCase().trim();
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.commit({
      searchQuery: normalized,
      searchResults: normalized ? this.store.getState().searchResults : null,
    });
    if (!normalized) return;
    if (normalized.length >= 2) {
      this._searchTimer = setTimeout(
        () => this.fullTextSearch(normalized),
        300,
      );
    }
  }

  private async fullTextSearch(query: string): Promise<void> {
    if (query !== this.store.getState().searchQuery) return;
    const workspaceId = this.getTarget()?.workspaceId;
    if (!workspaceId) return;
    try {
      const response = await this.data.searchSessions(workspaceId, query);
      if (query !== this.store.getState().searchQuery) return;
      this.commit({ searchResults: response.results ?? [] });
    } catch (error) {
      console.error("[Sidebar] Search failed:", error);
    }
  }

  // ── view controls ───────────────────────────────────────────────
  showMore(): void {
    this.commit({
      visibleCount: this.store.getState().visibleCount + STEP,
    });
  }

  showLess(): void {
    this.commit({
      visibleCount: Math.max(
        INITIAL_LIMIT,
        this.store.getState().visibleCount - STEP,
      ),
    });
  }

  toggleArchivedCollapsed(): void {
    const next = !this.store.getState().archivedCollapsed;
    this.commit({ archivedCollapsed: next });
    localStorage.setItem(STORAGE.archivedCollapsed, String(next));
  }

  toggleProjectCollapsed(path: string): void {
    const state = this.store.getState();
    const project = groupByProject(
      state.sessions.filter((session) => session.projectPath === path),
    )[0];
    const stored = state.projectsCollapsed[path];
    const wasCollapsed =
      stored === undefined ? !project?.isCurrent : stored === true;
    const projectsCollapsed = {
      ...state.projectsCollapsed,
      [path]: !wasCollapsed,
    };
    this.commit({ projectsCollapsed });
    localStorage.setItem(
      STORAGE.projectsCollapsed,
      JSON.stringify(projectsCollapsed),
    );
  }

  selectSession(session: SessionSummary): void {
    this.closeContextMenu();
    this.onSelect?.(session);
  }

  // ── context menu ────────────────────────────────────────────────
  showContextMenu(event: React.MouseEvent, session: SessionSummary): void {
    event.preventDefault();
    this.showMenu(event, this.buildSessionMenuRows(session));
  }

  /** Touch-friendly entry point: opens the same session menu anchored under
   *  the "more" button, so no right-click is required on coarse pointers. */
  showSessionMenuFromButton(
    button: HTMLElement,
    session: SessionSummary,
  ): void {
    const rect = button.getBoundingClientRect();
    this.showMenu(
      { clientX: rect.left, clientY: rect.bottom + 4, currentTarget: button },
      this.buildSessionMenuRows(session),
    );
  }

  private buildSessionMenuRows(session: SessionSummary): ContextMenuRow[] {
    const state = this.store.getState();
    const rows: ContextMenuRow[] = [
      {
        icon: state.favourites.includes(session.id) ? "☆" : "★",
        label: state.favourites.includes(session.id) ? "Unfavourite" : "Favourite",
        action: () => this.toggleFavourite(session.id),
      },
      {
        icon: state.archived.includes(session.id) ? "📤" : "🗄️",
        label: state.archived.includes(session.id) ? "Unarchive" : "Archive",
        action: () => this.toggleArchived(session.id),
      },
    ];
    if (session.id === state.activeSessionId) {
      rows.push({
        icon: "✏️",
        label: "Rename",
        action: () => this.startRename(session.id),
      });
    }
    if (state.archived.includes(session.id)) {
      rows.push({
        icon: "🗑️",
        label: "Delete",
        action: () => this.deleteArchivedSession(session.id),
      });
    }
    rows.push({
      icon: "📄",
      label: "Export as Markdown",
      action: () => this.exportSessionMarkdown(session),
    });
    return rows;
  }

  async exportSessionMarkdown(session: SessionSummary): Promise<void> {
    this.closeContextMenu();
    const workspaceId =
      session.workspaceId || this.getTarget().workspaceId;
    try {
      const frame = (await this.data.readSessionMessages(
        workspaceId,
        session.id,
      )) as { messages?: unknown[] };
      const messages = Array.isArray(frame) ? frame : frame?.messages ?? [];
      const markdown = renderSessionMarkdown(messages, {
        title: session.name || session.firstMessage || t("Conversation"),
      });
      this.downloadMarkdownFile(
        markdown,
        sessionMarkdownFileName(session.name || session.firstMessage, session.id),
      );
      this.notify({
        title: t("Conversation exported as Markdown"),
        type: "success",
      });
    } catch (error) {
      console.error("[Sidebar] exportSessionMarkdown failed:", error);
      this.notify({
        title: t("Could not export this conversation"),
        message: t("The session transcript could not be read."),
        type: "error",
      });
    }
  }

  private downloadMarkdownFile(markdown: string, fileName: string): void {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async deleteArchivedSession(id: string): Promise<void> {
    this.closeContextMenu();
    if (!this.control) return;
    const session = this.store
      .getState()
      .sessions.find((candidate) => candidate.id === id);
    const title = session?.name || session?.firstMessage || t("Empty session");
    if (
      !(await this.confirm(
        `${t("Delete session")} “${title}”? ${t(
          "This permanently removes the conversation and cannot be undone.",
        )}`,
      ))
    ) {
      return;
    }
    try {
      const { deleted } = await this.control.deleteSessions([id]);
      const deletedSet = new Set(deleted);
      const state = this.store.getState();
      this.commit({
        archived: state.archived.filter((entry) => !deletedSet.has(entry)),
        sessions: state.sessions.filter((session) => !deletedSet.has(session.id)),
      });
      localStorage.setItem(
        STORAGE.archived,
        JSON.stringify(this.store.getState().archived),
      );
    } catch (error) {
      console.error("[Sidebar] deleteArchivedSession failed:", error);
    }
  }

  showProjectContextMenu(
    event: React.MouseEvent,
    project: ProjectGroup,
  ): void {
    event.preventDefault();
    this.showMenu(event, this.buildProjectMenuRows(project));
  }

  /** Touch-friendly entry point for the project header menu. */
  showProjectMenuFromButton(button: HTMLElement, project: ProjectGroup): void {
    const rect = button.getBoundingClientRect();
    this.showMenu(
      { clientX: rect.left, clientY: rect.bottom + 4, currentTarget: button },
      this.buildProjectMenuRows(project),
    );
  }

  private buildProjectMenuRows(project: ProjectGroup): ContextMenuRow[] {
    return [
      {
        icon: "🗄️",
        label: "Archive all sessions",
        action: () => this.archiveProject(project),
      },
      {
        icon: "📦",
        label: "Export project as Markdown",
        action: () => this.exportProjectMarkdown(project),
      },
    ];
  }

  async exportProjectMarkdown(project: ProjectGroup): Promise<void> {
    this.closeContextMenu();
    const workspaceId = this.getTarget().workspaceId;
    const parts: Array<{ title: string; body: string }> = [];
    let failed = 0;
    for (const session of project.sessions) {
      try {
        const frame = (await this.data.readSessionMessages(
          session.workspaceId || workspaceId,
          session.id,
        )) as { messages?: unknown[] };
        const messages = Array.isArray(frame) ? frame : frame?.messages ?? [];
        const body = renderSessionMarkdown(messages);
        if (body.trim()) {
          parts.push({
            title: session.name || session.firstMessage || session.id,
            body,
          });
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    if (parts.length === 0) {
      this.notify({
        title: t("Could not export this project"),
        message: t("No session transcripts could be read."),
        type: "error",
      });
      return;
    }
    this.downloadMarkdownFile(
      renderProjectSessionsMarkdown(parts),
      projectMarkdownFileName(project.name),
    );
    this.notify({
      title: t("Project exported as Markdown"),
      message:
        failed > 0 ? t("Some session transcripts could not be read.") : undefined,
      type: "success",
    });
  }

  showMenu(
    event: { clientX: number; clientY: number; currentTarget: EventTarget | null },
    rows: ContextMenuRow[],
  ): void {
    this.closeContextMenu();
    this._contextMenuTrigger =
      event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.commit({
      contextMenu: { x: event.clientX, y: event.clientY, rows },
    });
  }

  closeContextMenu(): void {
    const menu = document.querySelector(".session-context-menu");
    const restore = this._contextMenuTrigger;
    this._contextMenuTrigger = null;
    if (menu?.contains(document.activeElement) && restore?.isConnected) {
      restore.focus();
    }
    if (this.store.getState().contextMenu) {
      this.commit({ contextMenu: null });
    }
  }

  // ── rename ──────────────────────────────────────────────────────
  startRename(id: string): void {
    this.commit({ renamingId: id });
  }

  cancelRename(id: string): void {
    if (this.store.getState().renamingId === id) {
      this.commit({ renamingId: null });
    }
  }

  async commitRename(id: string, value: string): Promise<void> {
    if (this.store.getState().renamingId !== id) return;
    const name = value.trim();
    const state = this.store.getState();
    const session = state.sessions.find((entry) => entry.id === id);
    const current = session?.name || session?.firstMessage || "";
    if (name && name !== current) {
      try {
        await this.runtime.request(
          { type: "set_session_name", name },
          this.getTarget(),
          { idempotencyKey: randomId() },
        );
        this.commit({
          sessions: state.sessions.map((entry) =>
            entry.id === id ? { ...entry, name } : entry,
          ),
        });
      } catch (error) {
        console.error("[Sidebar] Rename failed:", error);
      }
    }
    this.commit({ renamingId: null });
  }

}
