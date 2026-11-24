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
