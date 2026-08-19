// Workspace ids are v4 UUIDs and session ids are v7 UUIDs, both of which may
// start with a digit (e.g. "29e2ccd0-…", "019f80bd-…"). Allow a leading
// alphanumeric so those routes parse; "." and "/" stay disallowed so the value
// can never encode a path-traversal segment.
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function validId(value) {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

export function parseAppRoute(pathname) {
  if (pathname === "/app/settings") return { name: "settings" };
  const segments = pathname.split("/");
  if (
    segments.length === 6 &&
    segments[1] === "app" &&
    segments[2] === "workspaces" &&
    validId(segments[3]) &&
    segments[4] === "sessions" &&
    validId(segments[5])
  ) {
    return { name: "session", workspaceId: segments[3], sessionId: segments[5] };
  }
  return { name: "not_found" };
}

export function appRoutePath(route) {
  switch (route.name) {
    case "session":
      if (!validId(route.workspaceId) || !validId(route.sessionId)) {
        throw new Error("Invalid workspaceId or sessionId");
      }
      return `/app/workspaces/${route.workspaceId}/sessions/${route.sessionId}`;
    case "settings":
      return "/app/settings";
    default:
      throw new Error(`Cannot build unknown app route: ${route.name}`);
  }
}

export function replaceTemporarySessionRoute(
  history,
  workspaceId,
  temporarySessionId,
  formalSessionId,
) {
  if (!validId(temporarySessionId)) throw new Error("Invalid temporary sessionId");
  const path = appRoutePath({ name: "session", workspaceId, sessionId: formalSessionId });
  // Preserve the existing history state (notably the active plugin id written
  // by the plugin shell). Replacing it with `null` would drop that state and
  // make a later Back navigation (for example, closing the mobile "More" app
  // menu) fall back to Chat instead of staying on the current app.
  history.replaceState(history.state, "", path);
}

export function resolveHistoryNavigation(currentTarget, pathname) {
  const route = parseAppRoute(pathname);
  if (route.name !== "session") return { type: "none" };
  if (route.workspaceId !== currentTarget?.workspaceId) return { type: "reload" };
  if (route.sessionId === currentTarget?.sessionId) return { type: "none" };
  return { type: "switch_session", sessionId: route.sessionId };
}
