import type { Note } from "./notesLogic";

export interface NoteDraft {
  attachmentMarkdown?: string;
  id: string;
  revision: string;
  scope: string;
  updatedAt: string;
  note: Note;
  title: string;
  icon: string;
  content: string;
  tags: string[];
}
export interface NoteDraftRepository {
  list(scope: string): Promise<{ drafts: NoteDraft[]; unreadable: number }>;
  put(draft: NoteDraft): Promise<void>;
  remove(id: string, revision: string): Promise<void>;
}
interface EncryptedDraft {
  id: string;
  revision: string;
  scope: string;
  iv: Uint8Array<ArrayBuffer>;
  payload: ArrayBuffer;
}
const MAX_BYTES = 8 * 1024 * 1024;
export const draftScope = (target: { sceneId: string; workspaceId: string }) =>
  JSON.stringify([target.sceneId, target.workspaceId]);

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error ?? new Error("Draft transaction aborted"));
  });
}
function valid(value: unknown): value is NoteDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as NoteDraft;
  const strings = [
    draft.id,
    draft.revision,
    draft.scope,
    draft.updatedAt,
    draft.title,
    draft.icon,
    draft.content,
    draft.note?.id,
    draft.note?.notebookId,
    draft.note?.title,
    draft.note?.content,
  ];
  return (
    (draft.attachmentMarkdown === undefined || typeof draft.attachmentMarkdown === "string") &&
    strings.every((item) => typeof item === "string") &&
    Array.isArray(draft.tags) &&
    draft.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(draft.note.tags) &&
    draft.note.tags.every((tag) => typeof tag === "string") &&
    (draft.note.version === undefined ||
      typeof draft.note.version === "string" ||
      Number.isSafeInteger(draft.note.version))
  );
}

export function createNoteDraftRepository(): NoteDraftRepository {
  let database: Promise<IDBDatabase> | null = null;
  let keyPromise: Promise<CryptoKey> | null = null;
  function open() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("zicode-note-drafts-v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("keys");
        db.createObjectStore("drafts", { keyPath: "id" }).createIndex("scope", "scope");
      };
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Draft database blocked"));
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
          keyPromise = null;
        };
        resolve(request.result);
      };
    }).catch((error) => {
      database = null;
      throw error;
    });
    return database;
  }
  async function run<T>(
    store: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    const db = await open();
    const transaction = db.transaction(store, mode);
    const completion = done(transaction);
    completion.catch(() => {});
    const value = await result(operation(transaction.objectStore(store)));
    await completion;
    return value;
  }
  function key() {
    keyPromise ??= (async () => {
      const existing = await run("keys", "readonly", (store) => store.get("aes-gcm"));
      if (existing) return existing as CryptoKey;
      const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      try {
        await run("keys", "readwrite", (store) => store.add(generated, "aes-gcm"));
        return generated;
      } catch (error) {
        const winner = await run("keys", "readonly", (store) => store.get("aes-gcm"));
        if (winner) return winner as CryptoKey;
        throw error;
      }
    })().catch((error) => {
      keyPromise = null;
      throw error;
    });
    return keyPromise;
  }
  const aad = (record: Pick<NoteDraft, "id" | "revision" | "scope">) =>
    new TextEncoder().encode(JSON.stringify([record.id, record.revision, record.scope]));
  return {
    async put(draft) {
      if (!valid(draft)) throw new Error("Invalid note draft");
      const bytes = new TextEncoder().encode(JSON.stringify(draft));
      if (bytes.length > MAX_BYTES) throw new Error("Note draft exceeds 8 MiB");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(draft) },
        await key(),
        bytes,
      );
      const record: EncryptedDraft = {
        id: draft.id,
        scope: draft.scope,
        revision: draft.revision,
        iv,
        payload,
      };
      await run("drafts", "readwrite", (store) => store.put(record));
    },
    async list(scope) {
      const records: EncryptedDraft[] = await run("drafts", "readonly", (store) =>
        store.index("scope").getAll(scope),
      );
      const drafts: NoteDraft[] = [];
      let unreadable = 0;
      for (const record of records) {
        try {
          if (
            !(record.payload instanceof ArrayBuffer) ||
            record.payload.byteLength > MAX_BYTES + 16
          )
            throw new Error("Invalid encrypted note draft");
          const bytes = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: record.iv, additionalData: aad(record) },
            await key(),
            record.payload,
          );
          const draft: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (
            !valid(draft) ||
            draft.id !== record.id ||
            draft.scope !== scope ||
            draft.revision !== record.revision
          )
            throw new Error("Invalid note draft");
          drafts.push(draft);
        } catch {
          unreadable += 1;
        }
      }
      return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), unreadable };
    },
    async remove(id, revision) {
      const db = await open();
      const transaction = db.transaction("drafts", "readwrite");
      const completion = done(transaction);
      const store = transaction.objectStore("drafts");
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result?.revision === revision) store.delete(id);
      };
      await completion;
    },
  };
}
