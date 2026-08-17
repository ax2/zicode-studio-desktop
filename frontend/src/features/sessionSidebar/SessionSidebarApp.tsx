import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "../../shared/i18n";
import { isImeComposing } from "../../shared/ime";
// @ts-expect-error plain JS modules without type declarations (public/)
import { isSuperAgentProjectPath } from "../../../../public/super-agent/session.js";
// @ts-expect-error plain JS module without type declarations (public/)
import { isSuperAgentEnabled } from "../../../../public/super-agent/settings.js";
import {
  asPinnedSuperAgentSession,
  formatSessionTime,
  groupByProject,
  highlightParts,
  INITIAL_LIMIT,
  latestSession,
  type ProjectGroup,
  type SessionSearchResult,
  type SessionSummary,
} from "./sessionSidebarLogic";
import type {
  ContextMenuRow,
  SidebarStoreHook,
} from "./sessionSidebarStore";

export interface SessionSidebarController {
  isSidebarItemVisible(element: Element): boolean;
  selectSession(session: SessionSummary): void;
  toggleFavourite(id: string): void;
  toggleArchived(id: string): void;
  requestDeleteAllArchived(): void;
  cancelDeleteAll(): void;
  confirmDeleteAll(): void;
  startRename(id: string): void;
  commitRename(id: string, name: string): void;
  cancelRename(id: string): void;
  toggleArchivedCollapsed(): void;
  toggleProjectCollapsed(path: string): void;
  showMore(): void;
  showLess(): void;
  showContextMenu(event: React.MouseEvent, session: SessionSummary): void;
  showSessionMenuFromButton(button: HTMLElement, session: SessionSummary): void;
  showProjectContextMenu(event: React.MouseEvent, project: ProjectGroup): void;
  showProjectMenuFromButton(button: HTMLElement, project: ProjectGroup): void;
  closeContextMenu(): void;
  retryLoad(): void;
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

function FolderChevron() {
  return (
    <span className="chevron folder-icon">
      <svg
        className="folder-closed-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
      >
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        />
      </svg>
      <svg
        className="folder-open-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
      >
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="m6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
        />
      </svg>
    </span>
  );
}

function MoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SessionSidebarApp({
  controller,
  store,
  container,
}: {
  controller: SessionSidebarController;
  store: SidebarStoreHook;
  container: HTMLElement;
}) {
  const sessions = store((state) => state.sessions);
  const activeSessionId = store((state) => state.activeSessionId);
  const favourites = store((state) => state.favourites);
  const archived = store((state) => state.archived);
  const archivedCollapsed = store((state) => state.archivedCollapsed);
  const projectsCollapsed = store((state) => state.projectsCollapsed);
  const unread = store((state) => state.unread);
  const streaming = store((state) => state.streaming);
  const searchQuery = store((state) => state.searchQuery);
  const searchResults = store((state) => state.searchResults);
  const visibleCount = store((state) => state.visibleCount);
  const phase = store((state) => state.phase);
  const contextMenu = store((state) => state.contextMenu);
  const confirmDeleteCount = store((state) => state.confirmDeleteCount);
  const renamingId = store((state) => state.renamingId);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);

  const unreadSet = new Set(unread);
  const streamingSet = new Set(streaming);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(".context-menu-item") ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(current + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(current - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        controller.closeContextMenu();
        break;
      case "Enter":
      case " ":
        if (current >= 0) {
          event.preventDefault();
          const action = contextMenu?.rows[current]?.action;
          controller.closeContextMenu();
          action?.();
        }
        break;
    }
  };

  // Close the context menu on any outside click (mirrors the vanilla contract).
  useLayoutEffect(() => {
    const onDocumentClick = () => controller.closeContextMenu();
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [controller]);

  // Position + focus the context menu once it opens.
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    let x = contextMenu.x;
    let y = contextMenu.y;
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.querySelector<HTMLElement>(".context-menu-item")?.focus({
      preventScroll: true,
    });
  }, [contextMenu]);

  // Focus + select the rename input when rename starts.
  useLayoutEffect(() => {
    if (!renamingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  // Focus the cancel action when the delete-all confirmation opens and return
  // focus to the trigger when it closes. Escape cancels the destructive dialog.
  useLayoutEffect(() => {
    if (confirmDeleteCount == null) {
      confirmTriggerRef.current?.focus();
      confirmTriggerRef.current = null;
      return;
    }
    confirmTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    confirmDialogRef.current
      ?.querySelector<HTMLButtonElement>(".sidebar-confirm-no")
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.cancelDeleteAll();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = confirmDialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmDeleteCount, controller]);

  // Roving tabindex: anchor on the active session, else the first item.
  useLayoutEffect(() => {
    const items = Array.from(
      container.querySelectorAll<HTMLElement>(".session-item, .project-header"),
    );
    const visible = items.filter(controller.isSidebarItemVisible);
    if (visible.length === 0) return;
    const active = container.querySelector<HTMLElement>(
      `[data-session-id="${activeSessionId}"]`,
    );
    const anchor = active && visible.includes(active) ? active : visible[0];
    for (const element of items) element.tabIndex = -1;
    anchor.tabIndex = 0;
  });

  const superAgentEnabled = isSuperAgentEnabled();
  // The session list is bound to the current workspace: switching workspace
  // swaps the whole list. The pinned Agent Inbox stays as a system surface.
  const workspaceSessions = sessions.filter(
    (session) =>
      session.isCurrentWorkspace ||
      isSuperAgentProjectPath(session.projectPath),
  );
  const superAgentSessions = workspaceSessions.filter((session) =>
    isSuperAgentProjectPath(session.projectPath),
  );
  const pinnedSuperAgent = superAgentEnabled
    ? asPinnedSuperAgentSession(latestSession(superAgentSessions))
    : null;

  const favouritesSessions: SessionSummary[] = [];
  const archivedSessions: SessionSummary[] = [];
  const regular: SessionSummary[] = [];
  for (const session of workspaceSessions) {
    if (isSuperAgentProjectPath(session.projectPath)) continue;
    if (archived.includes(session.id)) archivedSessions.push(session);
    else if (favourites.includes(session.id)) favouritesSessions.push(session);
    else regular.push(session);
  }
  const projectGroups = groupByProject(regular);

  const titleMatches = (session: SessionSummary) =>
    !searchQuery ||
    (session.name || session.firstMessage || "")
      .toLowerCase()
      .includes(searchQuery);

  if (phase === "skeleton" && sessions.length === 0) {
    return (
      <>
        {Array.from({ length: 6 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder skeleton rows have no stable identity
          <div className="session-skeleton" key={`skeleton-${index}`}>
            <div className="session-skeleton-title"></div>
          </div>
        ))}
      </>
    );
  }
  if (sessions.length === 0 && phase === "loading") {
    return <div className="session-loading">{t("Loading sessions...")}</div>;
  }
  if (sessions.length === 0 && phase === "error") {
    return (
      <div className="session-loading">
        {t("Failed to load sessions.")}{" "}
        <button className="retry-link" id="retry-load-sessions" onClick={() => controller.retryLoad()}>
          {t("Retry")}
        </button>
      </div>
    );
  }
  if (sessions.length === 0) {
    return <div className="session-loading">{t("No saved sessions")}</div>;
  }
  if (workspaceSessions.length === 0) {
    return (
      <div className="session-loading">
        {t("No saved sessions in this workspace")}
      </div>
    );
  }

  const visibleSearchResults =
    searchQuery && searchResults && searchResults.length > 0
      ? searchResults
      : null;

  const renderSessionItem = (
    session: SessionSummary,
    {
      showArchiveButton = true,
      hidden = false,
    }: { showArchiveButton?: boolean; hidden?: boolean } = {},
  ) => {
    const title = session.name || session.firstMessage || t("Empty session");
    const isArchived = archived.includes(session.id);
    const archiveLabel = t(isArchived ? "Unarchive session" : "Archive session");
    const isActive = session.id === activeSessionId;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: session item click/context pattern preserved from the vanilla sidebar
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation handled by the sidebar container's roving keydown
      <div
        className={`session-item${isActive ? " active" : ""}${
          unreadSet.has(session.id) ? " unread" : ""
        }${
          streamingSet.has(session.id) ? " streaming mirror-live" : ""
        }${hidden ? " hidden" : ""}`}
        data-session-id={session.id}
        tabIndex={-1}
        key={session.id}
        aria-current={isActive ? "true" : undefined}
        onClick={() => controller.selectSession(session)}
        onContextMenu={(event) => controller.showContextMenu(event, session)}
      >
        <div className="session-title-row">
          {renamingId === session.id ? (
            <input
              ref={renameInputRef}
              className="session-rename-input"
              defaultValue={title}
              onBlur={(event) =>
                controller.commitRename(session.id, event.currentTarget.value)
              }
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={(event) => {
                if (isImeComposing(event, composingRef.current)) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  controller.cancelRename(session.id);
                }
              }}
            />
          ) : (
            <div className="session-title" title={title}>
              {title}
            </div>
          )}
          <span className="session-action-slot">
            {showArchiveButton ? (
              <button
                className="session-archive-btn"
                title={`${archiveLabel} ${title}`}
                aria-label={`${archiveLabel} ${title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  controller.toggleArchived(session.id);
                }}
              >
                <ArchiveIcon />
              </button>
            ) : null}
            <button
              className="session-more-btn"
              title={`${t("More actions")} ${title}`}
              aria-label={`${t("More actions")} ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                controller.showSessionMenuFromButton(
                  event.currentTarget,
                  session,
                );
              }}
            >
              <MoreIcon />
            </button>
          </span>
        </div>
      </div>
    );
  };

  const renderToggleRow = (visibleCountValue: number, totalCount: number) => {
    const hasMore = visibleCountValue < totalCount;
    const canShowLess = visibleCountValue > INITIAL_LIMIT;
    if (!hasMore && !canShowLess) return null;
    return (
      <div className="project-sessions-toggle-row" key="toggle-row">
        {hasMore ? (
          <button
            type="button"
            className="project-sessions-toggle"
            onClick={(event) => {
              event.stopPropagation();
              controller.showMore();
            }}
          >
            {t("Show more")}
          </button>
        ) : null}
        {canShowLess ? (
          <button
            type="button"
            className="project-sessions-toggle project-sessions-toggle-less"
            onClick={(event) => {
              event.stopPropagation();
              controller.showLess();
            }}
          >
            {t("Show less")}
          </button>
        ) : null}
      </div>
    );
  };

  const renderProjectGroup = (project: ProjectGroup) => {
    const stored = projectsCollapsed[project.path];
    const collapsed = stored === undefined ? !project.isCurrent : stored === true;
    const visible = project.isCurrent && !searchQuery
      ? project.sessions.slice(0, visibleCount)
      : project.sessions;
    const hasVisibleItem = project.sessions.some(titleMatches);
    return (
      <div
        className={`project-group${project.isCurrent ? " current-project" : ""}`}
        key={project.path}
        style={searchQuery && !hasVisibleItem ? { display: "none" } : undefined}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: project header collapse/new-chat pattern preserved from the vanilla sidebar */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation handled by the sidebar container's roving keydown */}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: disclosure state exposed on a roving-tabindex header without a native role */}
        <div
          className={`project-header project-group-header${collapsed ? " collapsed" : ""}`}
          data-project-path={project.path}
          aria-expanded={!collapsed}
          tabIndex={-1}
          onClick={() => controller.toggleProjectCollapsed(project.path)}
          onContextMenu={(event) => controller.showProjectContextMenu(event, project)}
        >
          <FolderChevron />
          <span className="project-name" title={project.path}>
            {project.name}
          </span>
          <span className="project-count">{project.sessions.length}</span>
          <button
            className="project-more-btn"
            title={t("More actions")}
            aria-label={t("More actions")}
            onClick={(event) => {
              event.stopPropagation();
              controller.showProjectMenuFromButton(event.currentTarget, project);
            }}
          >
            <MoreIcon />
          </button>
        </div>
        <div className={`project-sessions${collapsed ? " collapsed" : ""}`}>
          {visible.map((session) =>
            renderSessionItem(session, { hidden: !titleMatches(session) }),
          )}
          {project.isCurrent && !searchQuery
            ? renderToggleRow(visible.length, project.sessions.length)
            : null}
        </div>
      </div>
    );
  };

  return (
    <>
      {visibleSearchResults ? (
        <div className="search-results-group" key="search-results">
          <div className="project-header search-results-header">
            <span>🔍</span> <span>{t("Message matches")}</span>{" "}
            <span className="project-count">{visibleSearchResults.length}</span>
          </div>
          <div className="project-sessions">
            {visibleSearchResults.map((result: SessionSearchResult) => {
              const title =
                result.sessionName || result.firstMessage || t("Untitled");
              const snippet = result.matches?.[0]?.snippet || "";
              const matchCount = result.matches?.length ?? 0;
              const time = formatSessionTime(result.sessionTimestamp || "");
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: search result item pattern preserved from the vanilla sidebar
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation handled by the sidebar container's roving keydown
                <div
                  className={`session-item search-result-item${
                    result.sessionId === activeSessionId ? " active" : ""
                  }`}
                  data-session-id={result.sessionId}
                  tabIndex={-1}
                  key={result.sessionId}
                  aria-current={
                    result.sessionId === activeSessionId ? "true" : undefined
                  }
                  onClick={() =>
                    controller.selectSession({
                      id: result.sessionId,
                      isCurrentWorkspace: true,
                    })
                  }
                >
                  <div className="session-title-row">
                    <div className="session-title" title={title}>
                      {title}
                    </div>
                  </div>
                  <div className="search-snippet">
                    {highlightParts(snippet, searchQuery).map((part) =>
                      part.mark ? (
                        <mark key={part.key}>{part.text}</mark>
                      ) : (
                        <span key={part.key}>{part.text}</span>
                      ),
                    )}
                  </div>
                  <div className="session-meta">
                    {time}
                    {matchCount > 1
                      ? ` · ${t("{count} matches").replace("{count}", String(matchCount))}`
                      : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {pinnedSuperAgent ? (
        <div className="super-agent-pinned-group" key="pinned">
          <div className="project-header super-agent-pinned-header" tabIndex={-1}>
            <span className="fav-star">★</span>{" "}
            <span>{t("Agent Inbox")}</span>{" "}
            <span className="project-count">{t("Pinned")}</span>
          </div>
          <div className="project-sessions">
            {renderSessionItem(pinnedSuperAgent, { showArchiveButton: false })}
          </div>
        </div>
      ) : null}

      {favouritesSessions.length > 0 ? (
        <div
          className="favourites-group"
          key="favourites"
          style={
            searchQuery && !favouritesSessions.some(titleMatches)
              ? { display: "none" }
              : undefined
          }
        >
          <div className="project-header favourites-header" tabIndex={-1}>
            <span className="fav-star">★</span>{" "}
            <span>{t("Favourites")}</span>{" "}
            <span className="project-count">{favouritesSessions.length}</span>
          </div>
          <div className="project-sessions">
            {favouritesSessions.map((session) =>
              renderSessionItem(session, { hidden: !titleMatches(session) }),
            )}
          </div>
        </div>
      ) : null}

      {projectGroups.map(renderProjectGroup)}

      {archivedSessions.length > 0 ? (
        <div
          className="archived-group"
          key="archived"
          style={
            searchQuery && !archivedSessions.some(titleMatches)
              ? { display: "none" }
              : undefined
          }
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: archived header collapse pattern preserved from the vanilla sidebar */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation handled by the sidebar container's roving keydown */}
          <div
            className={`project-header archived-header${
              archivedCollapsed ? " collapsed" : ""
            }`}
            tabIndex={-1}
            onClick={() => controller.toggleArchivedCollapsed()}
          >
            <FolderChevron />
            <span>{t("Archived")}</span>{" "}
            <span className="project-count">{archivedSessions.length}</span>
            <button
              className="archived-delete-all-btn"
              tabIndex={0}
              title={t("Delete all archived sessions")}
              aria-label={t("Delete all archived sessions")}
              onClick={(event) => {
                event.stopPropagation();
                controller.requestDeleteAllArchived();
              }}
            >
              <TrashIcon />
            </button>
          </div>
          <div className={`project-sessions${archivedCollapsed ? " collapsed" : ""}`}>
            {archivedSessions.map((session) =>
              renderSessionItem(session, {
                showArchiveButton: false,
                hidden: !titleMatches(session),
              }),
            )}
          </div>
        </div>
      ) : null}

      {contextMenu
        ? createPortal(
            <div
              ref={menuRef}
              className="session-context-menu"
              role="menu"
              onKeyDown={handleMenuKeyDown}
            >
              {contextMenu.rows.map((row: ContextMenuRow) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: menu has its own keydown handler for activation
                <div
                  className="context-menu-item"
                  role="menuitem"
                  tabIndex={-1}
                  key={row.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    controller.closeContextMenu();
                    row.action();
                  }}
                >
                  <span className="context-menu-icon">{row.icon}</span>
                  {t(row.label)}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}

      {confirmDeleteCount != null
        ? createPortal(
            <div className="sidebar-confirm-overlay">
              <div
                ref={confirmDialogRef}
                className="sidebar-confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={t("Delete archived sessions")}
              >
                <div className="sidebar-confirm-message">
                  {t(
                    "Delete {count} archived sessions permanently? This cannot be undone.",
                  ).replace("{count}", String(confirmDeleteCount))}
                </div>
                <div className="sidebar-confirm-actions">
                  <button
                    type="button"
                    className="sidebar-confirm-no"
                    onClick={() => controller.cancelDeleteAll()}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    type="button"
                    className="sidebar-confirm-yes"
                    onClick={() => controller.confirmDeleteAll()}
                  >
                    {t("Delete")}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
