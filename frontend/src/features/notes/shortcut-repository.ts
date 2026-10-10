export interface NoteReference {
  notebookId: string;
  id: string;
}
export interface NoteShortcuts {
  version: 1;
  recent: NoteReference[];
  pinned: NoteReference[];
}
export type ShortcutChange =
  | { kind: "clear"; list: "recent" | "pinned" }
  | { kind: "recent"; note: NoteReference }
  | { kind: "toggle"; note: NoteReference; pinned: boolean }
  | { kind: "import"; recent: NoteReference[]; pinned: NoteReference[] };
export interface ShortcutRepository {
  read(scope: string): Promise<NoteShortcuts>;
  change(scope: string, action: ShortcutChange): Promise<NoteShortcuts>;
}
export const referenceKey = (note: NoteReference) => JSON.stringify([note.notebookId, note.id]);
export const emptyShortcuts = (): NoteShortcuts => ({ version: 1, recent: [], pinned: [] });
function unique(notes: NoteReference[], limit: number) {
  const seen = new Set<string>();
  return notes
    .filter((note) => {
      const key = referenceKey(note);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
export function applyShortcutChange(record: NoteShortcuts, action: ShortcutChange): NoteShortcuts {
  if (action.kind === "clear") return { ...record, [action.list]: [] };
  if (action.kind === "import")
    return {
      version: 1,
      recent: unique([...record.recent, ...action.recent], 8),
      pinned: unique([...record.pinned, ...action.pinned], 16),
    };
  if (action.kind === "recent")
    return { ...record, recent: unique([action.note, ...record.recent], 8) };
  const key = referenceKey(action.note);
  return {
    ...record,
    pinned: action.pinned
      ? unique([action.note, ...record.pinned], 16)
      : record.pinned.filter((note) => referenceKey(note) !== key),
  };
}
function parse(value: unknown): NoteShortcuts {
  if (value === undefined) return emptyShortcuts();
  const record = value as NoteShortcuts | null;
  const valid = (list: unknown, limit: number) =>
    Array.isArray(list) &&
    list.length <= limit &&
    list.every(
      (note) =>
        note &&
        typeof note.id === "string" &&
        typeof note.notebookId === "string" &&
        note.id.length > 0 &&
        note.notebookId.length > 0 &&
        note.id.length <= 256 &&
        note.notebookId.length <= 256,
    );
  if (record?.version !== 1 || !valid(record.recent, 8) || !valid(record.pinned, 16))
    throw new Error("Invalid note shortcuts");
  return record;
}
export function createShortcutRepository(): ShortcutRepository {
  let database: Promise<IDBDatabase> | null = null;
  function open() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("zicode-note-shortcuts-v1", 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("workspaces");
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Shortcut storage is blocked"));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          database = null;
        };
        resolve(request.result);
      };
    }).catch((error) => {
      database = null;
      throw error;
    });
    return database;
  }
  async function run(scope: string, action?: ShortcutChange): Promise<NoteShortcuts> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("workspaces", action ? "readwrite" : "readonly");
      const store = transaction.objectStore("workspaces");
      const request = store.get(scope);
      let record: NoteShortcuts;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          record = parse(request.result);
          if (action) {
            record = applyShortcutChange(record, action);
            store.put(record, scope);
          }
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = transaction.onabort = () =>
        reject(failure ?? transaction.error ?? new Error("Shortcut storage failed"));
    });
  }
  return { read: (scope) => run(scope), change: (scope, action) => run(scope, action) };
}
