export async function navigateToNoteSource(url, { scope, activate, isActive, open }) {
  if (!scope.workspaceId || !scope.isCurrent()) return;
  await activate();
  const current = () => isActive() && scope.isCurrent();
  if (current()) await open(url, current);
}

export async function navigateToNote(detail, { getTarget, activate, isActive, open }) {
  const { notebookId, noteId } = detail ?? {};
  if (typeof notebookId !== "string" || !notebookId || typeof noteId !== "string" || !noteId) return;
  const { sceneId, workspaceId } = getTarget() ?? {};
  const scoped = Object.hasOwn(detail, "sceneId") || Object.hasOwn(detail, "workspaceId");
  if (scoped && (!sceneId || !workspaceId || detail.sceneId !== sceneId || detail.workspaceId !== workspaceId)) return;
  await activate();
  const current = getTarget();
  if (isActive() && sceneId === current?.sceneId && workspaceId === current?.workspaceId) {
    await open(notebookId, noteId);
  }
}
