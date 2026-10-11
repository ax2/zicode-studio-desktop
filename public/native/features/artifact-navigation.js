// Navigation is read-only and scoped when a producer supplies its origin.
export function artifactNavigationId(detail, target) {
  const id = detail?.artifactId;
  if (typeof id !== "string" || !id || id.length > 128) return null;
  const scoped = Object.hasOwn(detail, "sceneId") || Object.hasOwn(detail, "workspaceId");
  if (scoped && (typeof detail.sceneId !== "string" || typeof detail.workspaceId !== "string" ||
    detail.sceneId !== target?.sceneId || detail.workspaceId !== target?.workspaceId)) return null;
  return id;
}

export function openSavedArtifact(artifactId, scope) {
  if (!scope?.sceneId || !scope?.workspaceId || !artifactNavigationId({ artifactId, sceneId: scope.sceneId, workspaceId: scope.workspaceId }, scope)) return;
  window.dispatchEvent(new CustomEvent("zicode:open-artifact", {
    detail: { artifactId, sceneId: scope.sceneId, workspaceId: scope.workspaceId },
  }));
}

export async function navigateToArtifact(detail, { getTarget, activate, isActive, open }) {
  const origin = { ...getTarget() };
  const artifactId = artifactNavigationId(detail, origin);
  if (!artifactId) return;
  await activate();
  const current = getTarget();
  if (!isActive() || origin.sceneId !== current?.sceneId ||
    origin.workspaceId !== current?.workspaceId || artifactNavigationId(detail, current) !== artifactId) return;
  await open(artifactId);
}
