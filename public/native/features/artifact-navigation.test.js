import { expect, it, vi } from "vitest";
import { artifactNavigationId, navigateToArtifact, openSavedArtifact } from "./artifact-navigation.js";
const target = { sceneId: "programming", workspaceId: "workspace" };
it("keeps legacy current-workspace links and validates scoped navigation", () => {
  expect(artifactNavigationId({ artifactId: "id" }, target)).toBe("id");
  expect(artifactNavigationId({ artifactId: "id", ...target }, target)).toBe("id");
  expect(artifactNavigationId({ artifactId: "id", sceneId: "other", workspaceId: "workspace" }, target)).toBeNull();
  expect(artifactNavigationId({ artifactId: "id", ...target }, { ...target, workspaceId: "changed" })).toBeNull();
  expect(artifactNavigationId({ artifactId: "id", sceneId: "programming" }, target)).toBeNull();
  for (const artifactId of [null, {}, "", "x".repeat(129)]) expect(artifactNavigationId({ artifactId }, target)).toBeNull();
});

it("waits for activation and rechecks workspace and activation refusal", async () => {
  let current = target, active = true, finish;
  const open = vi.fn();
  const options = { getTarget: () => current, isActive: () => active, open,
    activate: () => new Promise(resolve => { finish = resolve; }) };
  let pending = navigateToArtifact({ artifactId: "id", ...target }, options);
  expect(open).not.toHaveBeenCalled(); finish(); await pending;
  expect(open).toHaveBeenCalledWith("id"); open.mockClear();
  pending = navigateToArtifact({ artifactId: "id" }, options);
  current = { ...target, workspaceId: "changed" }; finish(); await pending;
  expect(open).not.toHaveBeenCalled(); current = target;
  pending = navigateToArtifact({ artifactId: "id", ...target }, options);
  active = false; finish(); await pending; expect(open).not.toHaveBeenCalled();
});
it("emits only a bounded identifier and source context without report data", () => {
  const listener = vi.fn(); window.addEventListener("zicode:open-artifact", listener);
  try {
    openSavedArtifact("id", { ...target, input: "private", result: "private" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ artifactId: "id", ...target });
    openSavedArtifact("", target); openSavedArtifact("id", {});
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener("zicode:open-artifact", listener); }
});
