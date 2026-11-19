export interface NotesSyncRunStatus {
  runId: string | null;
  running: boolean;
  state: string;
  conflictCount: number;
  retryAfterSeconds: number | null;
  conflictsAvailable?: boolean;
}

export const notesSyncMessages: Record<string, string> = {
  idle: "No sync is running. Restarting Studio never starts sync automatically.",
  running: "Syncing saved notes… You can continue editing.",
  synced: "Saved notes synced successfully.",
  conflicts: "Conflicting changes were kept. Conflict resolution is not available yet.",
  resolvedLocally: "Conflict choices are saved on this device and are waiting to upload. Use Sync now to upload them.",
  cancelled: "Sync cancelled. A request may already have reached the server; the next manual sync safely checks it again.",
  interrupted: "Sync was interrupted. Click Sync now to retry the saved queue.",
  settingsChanged: "Settings or Notes permissions changed. Refresh cloud sync settings before trying again.",
  localChanged: "Notes changed while syncing. Your latest edits are kept. Sync again to merge them.",
  authentication: "The cloud server rejected the credentials. Check the saved username and password.",
  network: "Could not reach the cloud server. Your saved notes and pending queue are kept.",
  rateLimited: "The server requested a pause. Sync will not retry automatically.",
  busy: "The notes library is in use. Try syncing again after the current operation finishes.",
  remoteChanged: "The cloud library changed during sync. Try again to merge the latest version.",
  remoteReset: "The existing cloud index is missing. Sync stopped to protect your notes.",
  unsupportedServer: "This WebDAV server does not safely support conditional writes. Sync stopped.",
  invalidKey: "The cloud library could not be decrypted. Check the library ID and recovery code.",
  tooLarge: "This sync exceeds the supported size limits. Your saved notes are kept.",
  failed: "Sync could not finish safely. Your saved notes and pending queue are kept.",
};

export function parseNotesSyncRunStatus(value: unknown): NotesSyncRunStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid sync status");
  const row = value as Partial<NotesSyncRunStatus>;
  if ((row.runId !== null && (typeof row.runId !== "string" || !row.runId || row.runId.length > 256))
    || typeof row.running !== "boolean" || (row.running && !row.runId)
    || (row.conflictsAvailable !== undefined && typeof row.conflictsAvailable !== "boolean")
    || typeof row.state !== "string" || !row.state || row.state.length > 64
    || !Number.isSafeInteger(row.conflictCount) || (row.conflictCount as number) < 0
    || (row.retryAfterSeconds !== null && (!Number.isSafeInteger(row.retryAfterSeconds) || (row.retryAfterSeconds as number) < 0))) {
    throw new Error("Invalid sync status");
  }
  return { runId: row.runId, running: row.running, state: row.state,
    conflictCount: row.conflictCount, retryAfterSeconds: row.retryAfterSeconds, ...(row.conflictsAvailable === true ? { conflictsAvailable: true } : {}) } as NotesSyncRunStatus;
}

export function notesSyncMessage(state: string): string {
  return Object.hasOwn(notesSyncMessages, state) ? notesSyncMessages[state] : notesSyncMessages.failed;
}
