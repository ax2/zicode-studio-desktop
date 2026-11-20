const eventName = "zicode:notes-sync-local-change";

export function notifyNotesSyncLocalChange(workspaceId: string): void {
  if (workspaceId) window.dispatchEvent(new CustomEvent(eventName, { detail: { workspaceId } }));
}

export function watchNotesSyncLocalChanges(getWorkspaceId: () => string | undefined, refresh: () => Promise<void>): () => void {
  const changed = (event: Event) => {
    const workspaceId = (event as CustomEvent<{ workspaceId?: unknown }>).detail?.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId || workspaceId !== getWorkspaceId()) return;
    // The existing Notes store owns error presentation and scope/version checks.
    // This notification only refreshes a list; it never saves or replaces drafts.
    void refresh().catch(() => {});
  };
  window.addEventListener(eventName, changed);
  return () => window.removeEventListener(eventName, changed);
}
