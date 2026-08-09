export interface SessionSummary {
  id: string;
  workspaceId?: string;
  fileName?: string;
  name?: string;
  firstMessage?: string;
  timestamp?: string;
  modifiedAtMs?: number;
  projectPath?: string;
  projectName?: string;
  isCurrentWorkspace?: boolean;
  kind?: string;
  status?: string;
  state?: string;
  isWorking?: boolean;
  unread?: boolean;
  hasUnread?: boolean;
  target?: unknown;
}

export interface SessionSearchResult {
  sessionId: string;
  sessionName?: string;
  firstMessage?: string;
  sessionTimestamp?: string;
  matches?: Array<{ snippet?: string }>;
}

export const STORAGE = {
  favourites: "picot-favourites",
  archived: "picot-archived",
  archivedCollapsed: "picot-archived-collapsed",
  projectsCollapsed: "picot-projects-collapsed",
  sessionCache: "picot-session-list-cache",
  latestSessionCache: "picot-session-list-cache:latest",
  unread: "picot-unread",
};

export const INITIAL_LIMIT = 8;
export const STEP = 10;
export const LOAD_RETRY_DELAYS_MS = [250, 750, 1500];

export function readObject(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function readArray(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function sessionCacheKey(workspaceId: string): string {
  return `${STORAGE.sessionCache}:${workspaceId}`;
}

export function rebaseCachedSessions(
  sessions: SessionSummary[],
  activeSessionId: string | null | undefined,
): SessionSummary[] {
  const active = sessions.find((session) => session?.id === activeSessionId);
  const activeProjectPath = active?.projectPath;
  if (!activeProjectPath) return sessions;
  return sessions.map((session) => ({
    ...session,
    isCurrentWorkspace: session?.projectPath === activeProjectPath,
  }));
}

export function readSessionCache(
  workspaceId: string,
  activeSessionId: string | null | undefined,
): SessionSummary[] {
  try {
    const workspaceValue = JSON.parse(
      localStorage.getItem(sessionCacheKey(workspaceId)) || "[]",
    );
    if (Array.isArray(workspaceValue) && workspaceValue.length > 0) {
      return workspaceValue;
    }
    const latestValue = JSON.parse(
      localStorage.getItem(STORAGE.latestSessionCache) || "[]",
    );
    return Array.isArray(latestValue)
      ? rebaseCachedSessions(latestValue, activeSessionId)
      : [];
  } catch {
    return [];
  }
}

export function writeSessionCache(
  workspaceId: string,
  sessions: SessionSummary[],
): void {
  try {
    localStorage.setItem(sessionCacheKey(workspaceId), JSON.stringify(sessions));
    localStorage.setItem(STORAGE.latestSessionCache, JSON.stringify(sessions));
  } catch {
    // Cache writes are best-effort; private browsing/quota issues should not
    // affect the live sidebar.
  }
}

export function sessionListSignature(sessions: SessionSummary[]): string {
  return JSON.stringify(
    (sessions ?? []).map((session) => ({
      id: session?.id ?? null,
      name: session?.name ?? null,
      firstMessage: session?.firstMessage ?? null,
      timestamp: session?.timestamp ?? null,
      modifiedAtMs: session?.modifiedAtMs ?? null,
      projectPath: session?.projectPath ?? null,
      projectName: session?.projectName ?? null,
      isCurrentWorkspace: session?.isCurrentWorkspace === true,
      kind: session?.kind ?? null,
      status: session?.status ?? null,
      state: session?.state ?? null,
      isWorking: session?.isWorking === true,
      unread: session?.unread === true,
      hasUnread: session?.hasUnread === true,
      target: session?.target ?? null,
    })),
  );
}

export function isWorkingSession(session: SessionSummary | undefined): boolean {
  return (
    session?.status === "working" ||
    session?.state === "working" ||
    session?.isWorking === true
  );
}

export function hasLiveStatus(session: SessionSummary | undefined): boolean {
  return (
    session?.status != null ||
    session?.state != null ||
    session?.isWorking != null
  );
}

export function isUnreadSession(session: SessionSummary | undefined): boolean {
  return session?.unread === true || session?.hasUnread === true;
}

export function sessionTimeMs(session: SessionSummary | undefined): number {
  const modified = Number(session?.modifiedAtMs);
  if (Number.isFinite(modified) && modified > 0) return modified;
  const parsed = Date.parse(session?.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asPinnedSuperAgentSession(
  session: SessionSummary | null | undefined,
): SessionSummary | null {
  if (!session) return null;
  return {
    ...session,
    kind: "super-agent",
    name: "Agent Inbox",
    projectName: "Agent Inbox",
  };
}

export function latestSession(
  sessions: SessionSummary[],
): SessionSummary | null {
  return (
    [...sessions].sort(
      (left, right) => sessionTimeMs(right) - sessionTimeMs(left),
    )[0] ?? null
  );
}

export function mergeSessionSummary(
  existing: SessionSummary | null | undefined,
  incoming: Partial<SessionSummary>,
): SessionSummary {
  // Callers guarantee the merged session carries a real id (upsertSession
  // exits early without one), so the spread's optional id is safe here.
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
    name: incoming?.name ?? existing?.name ?? undefined,
    firstMessage: existing?.firstMessage ?? incoming?.firstMessage ?? undefined,
    timestamp: incoming?.timestamp ?? existing?.timestamp ?? new Date().toISOString(),
    modifiedAtMs: incoming?.modifiedAtMs ?? existing?.modifiedAtMs ?? Date.now(),
  } as SessionSummary;
}

export function formatSessionTime(isoTimestamp: string): string {
  if (!isoTimestamp) return "";
  try {
    const timestamp = Date.parse(isoTimestamp);
    if (!Number.isFinite(timestamp)) return "";
    const deltaMs = Date.now() - timestamp;
    if (deltaMs < 60 * 1000) return t("Just now");
    if (deltaMs < 60 * 60 * 1000) {
      return t("{count}m ago").replace(
        "{count}",
        String(Math.floor(deltaMs / (60 * 1000))),
      );
    }
    if (deltaMs < 24 * 60 * 60 * 1000) {
      return t("{count}h ago").replace(
        "{count}",
        String(Math.floor(deltaMs / (60 * 60 * 1000))),
      );
    }
    if (deltaMs < 48 * 60 * 60 * 1000) return t("Yesterday");
    return new Date(timestamp).toLocaleDateString();
  } catch {
    return "";
  }
}

export interface ProjectGroup {
  path: string;
  name: string;
  isCurrent: boolean;
  sessions: SessionSummary[];
}

export function groupByProject(sessions: SessionSummary[]): ProjectGroup[] {
  const order: string[] = [];
  const byPath = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const path = session.projectPath || "unknown";
    let group = byPath.get(path);
    if (!group) {
      group = {
        path,
        name: session.projectName || path,
        isCurrent: Boolean(session.isCurrentWorkspace),
        sessions: [],
      };
      byPath.set(path, group);
      order.push(path);
    }
    group.sessions.push(session);
  }
  const result: ProjectGroup[] = [];
  for (const path of order) {
    const group = byPath.get(path);
    if (group) result.push(group);
  }
  return result;
}

export function highlightParts(
  text: string,
  query: string,
): Array<{ text: string; mark: boolean; key: string }> {
  if (!query) return [{ text, mark: false, key: "plain" }];
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts: Array<{ text: string; mark: boolean; key: string }> = [];
  const re = new RegExp(`(${escapedQuery})`, "gi");
  let lastIndex = 0;
  let partIndex = 0;
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        mark: false,
        key: `part-${partIndex++}`,
      });
    }
    parts.push({ text: match[0], mark: true, key: `part-${partIndex++}` });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) re.lastIndex += 1;
    match = re.exec(text);
  }
  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      mark: false,
      key: `part-${partIndex++}`,
    });
  }
  return parts.length > 0 ? parts : [{ text, mark: false, key: "plain" }];
}
import { t } from "../../shared/i18n";
