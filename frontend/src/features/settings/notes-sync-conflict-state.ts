export type ConflictChoice = "local" | "remote" | "both";
export interface ConflictSide {
  exists: boolean; deleted: boolean; title?: string; byteLength?: number; sha256?: string;
  text?: string; properties?: string;
}
export interface ConflictRow {
  id: string; kind: "book" | "note" | "attachment"; notebookTitle: string;
  allowedChoices: ConflictChoice[]; local: ConflictSide; remote: ConflictSide;
}
export interface ConflictPage { runId: string; revision: string; total: number; nextCursor: number | null; rows: ConflictRow[] }
export interface ConflictApplied { runId: string; revision: string; state: "savedLocally"; copiedNotes: number; copiedNotebooks: number; pendingUpload: true }
export type ConflictInvoke = (command: string, args: { request: Record<string, unknown> }) => Promise<unknown>;
export interface ConflictScope { workspaceId: string; sceneId: string; runId: string; revision: string }
const choices = new Set(["local", "remote", "both"]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("notes_sync_review_invalid");
  return value as Record<string, unknown>;
}
function count(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw Error("notes_sync_review_invalid");
  return value as number;
}
function text(value: unknown, max = 8192): string {
  if (typeof value !== "string" || value.length > max) throw Error("notes_sync_review_invalid");
  return value;
}
function scope(value: unknown, expected: ConflictScope) {
  const row = object(value);
  if (row.runId !== expected.runId || row.revision !== expected.revision) throw Error("notes_sync_review_changed");
  return row;
}
function side(value: unknown): ConflictSide {
  const row = object(value);
  if (typeof row.exists !== "boolean" || typeof row.deleted !== "boolean") throw Error("notes_sync_review_invalid");
  const result: ConflictSide = { exists: row.exists, deleted: row.deleted };
  if (row.title !== undefined && row.title !== null) result.title = text(row.title);
  if (row.byteLength !== undefined && row.byteLength !== null) result.byteLength = count(row.byteLength, 8 * 1024 * 1024);
  if (row.sha256 !== undefined && row.sha256 !== null) {
    if (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(row.sha256)) throw Error("notes_sync_review_invalid");
    result.sha256 = row.sha256;
  }
  if (row.text !== undefined && row.text !== null) result.text = text(row.text, 1024 * 1024);
  if (row.properties !== undefined && row.properties !== null) result.properties = text(row.properties, 1024 * 1024);
  if ((result.text?.length ?? 0) + (result.properties?.length ?? 0) > 1024 * 1024) throw Error("notes_sync_review_too_large");
  return result;
}
function conflict(value: unknown): ConflictRow {
  const row = object(value), id = text(row.id, 1024);
  if (!id || !["book", "note", "attachment"].includes(row.kind as string)
    || !Array.isArray(row.allowedChoices) || row.allowedChoices.length === 0 || row.allowedChoices.length > 3
    || row.allowedChoices.some(choice => !choices.has(choice)) || new Set(row.allowedChoices).size !== row.allowedChoices.length) throw Error("notes_sync_review_invalid");
  return { id, kind: row.kind as ConflictRow["kind"], notebookTitle: text(row.notebookTitle),
    allowedChoices: row.allowedChoices as ConflictChoice[], local: side(row.local), remote: side(row.remote) };
}
export function parseConflictPage(value: unknown, expected: ConflictScope, cursor: number): ConflictPage {
  const row = scope(value, expected), total = count(row.total, 10_000);
  if (!Array.isArray(row.rows) || row.rows.length > 50) throw Error("notes_sync_review_invalid");
  const rows = row.rows.map(conflict), ids = new Set(rows.map(item => item.id));
  const nextCursor = row.nextCursor === null ? null : count(row.nextCursor, total);
  if (ids.size !== rows.length || cursor + rows.length > total || (nextCursor !== null && (nextCursor <= cursor || nextCursor !== cursor + rows.length))
    || (nextCursor === null && cursor + rows.length !== total)) throw Error("notes_sync_review_invalid");
  return { runId: expected.runId, revision: expected.revision, total, nextCursor, rows };
}
export function parseConflictDetail(value: unknown, expected: ConflictScope, id: string): ConflictRow {
  const row = scope(value, expected), item = conflict(row.item);
  if (item.id !== id) throw Error("notes_sync_review_changed");
  return item;
}
export function parseConflictApplied(value: unknown, expected: ConflictScope): ConflictApplied {
  const row = scope(value, expected);
  if (row.state !== "savedLocally" || row.pendingUpload !== true) throw Error("notes_sync_review_invalid");
  return { runId: expected.runId, revision: expected.revision, state: "savedLocally", pendingUpload: true,
    copiedNotes: count(row.copiedNotes, 10_000), copiedNotebooks: count(row.copiedNotebooks, 10_000) };
}

const messages: Record<string, string> = {
  notes_sync_review_changed: "The current page or notes library changed. Start a new manual sync to review current conflicts.",
  notes_sync_review_expired: "These conflict versions are no longer available. Start a new manual sync to load current versions.",
  notes_sync_review_busy: "The notes library is busy. Your choices are kept; try again shortly.",
  notes_sync_review_invalid: "The conflict review could not be verified. Your choices are kept; refresh sync status before continuing.",
  notes_sync_review_too_large: "This conflict exceeds the comparison limits. Your existing notes are kept.",
  notes_sync_review_unavailable: "The local save result could not be confirmed. Your choices are kept. Check the notes library before starting another sync.",
  notes_sync_permission_denied: "Notes permission is no longer available. Your choices are kept; check permissions before another review.",
  notes_sync_confirmation_required: "Review all conflict choices and explicitly confirm saving them on this device.",
  notes_sync_settings_changed: "Cloud sync settings changed. Start a new manual sync to review current conflicts.",
  notes_sync_credentials_disabled: "System credentials are disabled in this profile. Your choices are kept.",
  notes_sync_credentials_missing: "Cloud sync credentials are missing. Your choices are kept; check saved settings.",
  notes_sync_credentials_unavailable: "System credential storage is unavailable. Your choices are kept.",
};
export function conflictFailure(error: unknown, operation: "read" | "apply" = "read"): { message: string; blocked: boolean } {
  const code = String(error).replace(/^Error: /, "");
  const known = Object.hasOwn(messages, code);
  return { message: known ? messages[code] : operation === "apply" ? messages.notes_sync_review_unavailable : "Could not load conflict versions. Your choices are kept; retry explicitly.",
    blocked: known ? code !== "notes_sync_review_busy" && code !== "notes_sync_confirmation_required" : operation === "apply" };
}
