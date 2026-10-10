import { t } from "../../shared/i18n";
import type {
  SessionSearchResult,
  SessionSummary,
} from "../sessionSidebar/sessionSidebarLogic";
import { highlightParts } from "../sessionSidebar/sessionSidebarLogic";

export type { SessionSearchResult, SessionSummary };
export { highlightParts };

export const SEARCH_DEBOUNCE_MS = 300;
export const MAX_TITLE_RESULTS = 12;
export const MAX_RECENT_RESULTS = 12;

export function isAppleOs(): boolean {
  const platform = globalThis.navigator?.platform ?? "";
  const userAgent = globalThis.navigator?.userAgent ?? "";
  return platform.startsWith("Mac") || /Mac OS|iPhone|iPad/.test(userAgent);
}

export function shortcutHintLabel(): string {
  return isAppleOs() ? "⌘K" : "Ctrl+K";
}

export function isSearchShortcut(event: {
  defaultPrevented?: boolean;
  isComposing?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.altKey || event.shiftKey || event.key?.toLowerCase() !== "k") {
    return false;
  }
  return Boolean(event.metaKey || event.ctrlKey);
}

export function normalizeQuery(query: string): string {
  return String(query ?? "")
    .toLowerCase()
    .trim();
}

export function sessionTitle(
  session: SessionSummary | undefined,
): string {
  return session?.name || session?.firstMessage || t("Empty session");
}

export function sessionSearchText(session: SessionSummary): string {
  return [sessionTitle(session), session?.projectName, session?.projectPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function formatMeta(session: SessionSummary): string {
  return [session?.projectName, session?.projectPath].filter(Boolean).join(" · ");
}

export interface SearchRow {
  sessionId: string;
  icon: string;
  title: string;
  meta?: string;
  snippet?: string;
}

export function buildTitleRows(
  sessions: SessionSummary[],
  query: string,
): SearchRow[] {
  const normalized = normalizeQuery(query);
  const matches = normalized
    ? sessions
        .filter((session) => sessionSearchText(session).includes(normalized))
        .slice(0, MAX_TITLE_RESULTS)
    : sessions.slice(0, MAX_RECENT_RESULTS);
  return matches.map((session) => ({
    sessionId: session.id,
    icon: session.isCurrentWorkspace ? "●" : "○",
    title: sessionTitle(session),
    meta: formatMeta(session),
  }));
}

export function buildMessageRows(
  results: SessionSearchResult[],
): SearchRow[] {
  return (results ?? []).map((result) => ({
    sessionId: result.sessionId,
    icon: "⌕",
    title: result.sessionName || result.firstMessage || t("Untitled"),
    meta:
      result.matches && result.matches.length > 1
        ? `${result.matches.length} ${t("matches")}`
        : t("Message match"),
    snippet: result.matches?.[0]?.snippet || "",
  }));
}
