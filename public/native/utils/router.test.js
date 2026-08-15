import { describe, expect, it } from "vitest";
import {
  appRoutePath,
  parseAppRoute,
  replaceTemporarySessionRoute,
  resolveHistoryNavigation,
} from "./router.js";

describe("app router", () => {
  it("round-trips opaque launcher and session routes", () => {
    const launcher = { name: "launcher", workspaceId: "workspace_A-1" };
    expect(parseAppRoute(appRoutePath(launcher))).toEqual(launcher);
    const session = {
      name: "session",
      workspaceId: "workspace_A-1",
      sessionId: "session_B-2",
    };
    expect(parseAppRoute(appRoutePath(session))).toEqual(session);
    expect(parseAppRoute("/app/settings")).toEqual({ name: "settings" });
  });

  it("parses UUID workspace and session ids that begin with a digit", () => {
    // Real ids: workspace ids are v4 UUIDs, session ids are v7 UUIDs, both of
    // which frequently start with a digit and previously failed to parse.
    const session = {
      name: "session",
      workspaceId: "29e2ccd0-c99f-4758-8d50-4018231cc6d5",
      sessionId: "019f80bd-1915-73e1-a140-22426a55f4e3",
    };
    expect(parseAppRoute(appRoutePath(session))).toEqual(session);
  });

  it("rejects paths, ports, malformed IDs, and unknown routes", () => {
    for (const path of [
      "/app/workspaces//launcher",
      "/app/workspaces/3001/sessions//tmp/session.jsonl",
      "/app/workspaces/workspace%2Fescape/launcher",
      "/not-an-app-route",
    ]) {
      expect(parseAppRoute(path)).toEqual({ name: "not_found" });
    }
  });

  it("replaces a temporary session route while preserving history state", () => {
    const calls = [];
    const state = { zicodePluginId: "com.zicode.notes" };
    const history = { state, replaceState: (...args) => calls.push(args) };
    replaceTemporarySessionRoute(history, "workspace-a", "temporary-1", "session-formal");
    expect(calls).toEqual([[state, "", "/app/workspaces/workspace-a/sessions/session-formal"]]);
  });

  it("routes browser Back to an in-workspace session switch or a cross-workspace reload", () => {
    const current = { workspaceId: "workspace-a", sessionId: "session-2" };
    expect(
      resolveHistoryNavigation(current, "/app/workspaces/workspace-a/sessions/session-1"),
    ).toEqual({ type: "switch_session", sessionId: "session-1" });
    expect(
      resolveHistoryNavigation(current, "/app/workspaces/workspace-b/sessions/session-1"),
    ).toEqual({ type: "reload" });
    expect(
      resolveHistoryNavigation(current, "/app/workspaces/workspace-a/sessions/session-2"),
    ).toEqual({ type: "none" });
  });
});
