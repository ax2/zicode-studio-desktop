import type { ProjectProfile } from "./logic";

export interface ContextRecoverySnapshot {
  id: string;
  scope: string;
  revision: string;
  updatedAt: string;
  draft: ProjectProfile;
  base: ProjectProfile;
  savedRevision: string | null;
  sourceProjectName?: string;
  sourceCapturedAt?: string;
}

export interface ContextRecoveryRepository {
  list(scope: string): Promise<{
    snapshots: ContextRecoverySnapshot[];
    unreadable: number;
    unreadableRecords: Array<{ id: string; revision: string }>;
  }>;
  put(snapshot: ContextRecoverySnapshot): Promise<void>;
  remove(id: string, revision?: string, scope?: string): Promise<void>;
}

interface EncryptedSnapshot {
  id: string;
  scopeHash: string;
  revision: string;
  iv: Uint8Array<ArrayBuffer>;
  payload: ArrayBuffer;
}

const MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 128;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error ?? new Error("Context recovery transaction aborted"));
  });
}

export function validRecoveryProfile(value: unknown): value is ProjectProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as ProjectProfile;
  return (
    typeof profile.instructions === "string" &&
    profile.instructions.length <= 50_000 &&
    typeof profile.defaultScene === "string" &&
    typeof profile.budget === "string"
  );
}

function validSnapshot(value: unknown): value is ContextRecoverySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as ContextRecoverySnapshot;
  return (
    typeof snapshot.id === "string" &&
    snapshot.id.length > 0 &&
    typeof snapshot.scope === "string" &&
    snapshot.scope.length > 0 &&
    typeof snapshot.revision === "string" &&
    snapshot.revision.length > 0 &&
    typeof snapshot.updatedAt === "string" &&
    (snapshot.savedRevision === null ||
      (typeof snapshot.savedRevision === "string" &&
        /^[a-f0-9]{64}$/.test(snapshot.savedRevision))) &&
    (snapshot.sourceProjectName === undefined ||
      (typeof snapshot.sourceProjectName === "string" &&
        snapshot.sourceProjectName.length <= 1024)) &&
    (snapshot.sourceCapturedAt === undefined ||
      (typeof snapshot.sourceCapturedAt === "string" &&
        !Number.isNaN(Date.parse(snapshot.sourceCapturedAt)))) &&
    validRecoveryProfile(snapshot.draft) &&
    validRecoveryProfile(snapshot.base)
  );
}

export function createContextRecoveryRepository(): ContextRecoveryRepository {
  let database: Promise<IDBDatabase> | null = null;
  let keyPromise: Promise<CryptoKey> | null = null;

  function open(): Promise<IDBDatabase> {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("zicode-project-context-recovery-v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("keys");
        db.createObjectStore("snapshots", { keyPath: "id" }).createIndex("scopeHash", "scopeHash");
      };
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Context recovery database blocked"));
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
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await open();
    const transaction = db.transaction(storeName, mode);
    const completion = transactionDone(transaction);
    completion.catch(() => {});
    const value = await requestResult(operation(transaction.objectStore(storeName)));
    await completion;
    return value;
  }

  function key(): Promise<CryptoKey> {
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

  async function hashScope(scope: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  const aad = (record: Pick<EncryptedSnapshot, "id" | "scopeHash" | "revision">) =>
    new TextEncoder().encode(JSON.stringify([record.id, record.scopeHash, record.revision]));

  async function putWithinLimit(record: EncryptedSnapshot): Promise<void> {
    const db = await open();
    const transaction = db.transaction("snapshots", "readwrite");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore("snapshots");
    let full = false;
    let collision = false;
    const existing = store.get(record.id);
    existing.onsuccess = () => {
      if (existing.result) {
        if (existing.result.scopeHash === record.scopeHash) {
          store.put(record);
        } else {
          collision = true;
        }
        return;
      }
      const count = store.count();
      count.onsuccess = () => {
        if (count.result >= MAX_RECORDS) {
          full = true;
        } else {
          store.put(record);
        }
      };
    };
    await completion;
    if (full) throw new Error("Context recovery capacity reached");
    if (collision) throw new Error("Context recovery identifier collision");
  }

  return {
    async put(snapshot) {
      if (!validSnapshot(snapshot)) throw new Error("Invalid project context recovery snapshot");
      const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
      if (bytes.length > MAX_BYTES) throw new Error("Project context recovery exceeds 1 MiB");
      const scopeHash = await hashScope(snapshot.scope);
      const record: EncryptedSnapshot = {
        id: snapshot.id,
        scopeHash,
        revision: snapshot.revision,
        iv: crypto.getRandomValues(new Uint8Array(12)),
        payload: new ArrayBuffer(0),
      };
      record.payload = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: record.iv, additionalData: aad(record) },
        await key(),
        bytes,
      );
      await putWithinLimit(record);
    },
    async list(scope) {
      const scopeHash = await hashScope(scope);
      const records: EncryptedSnapshot[] = await run("snapshots", "readonly", (store) =>
        store.index("scopeHash").getAll(scopeHash),
      );
      const snapshots: ContextRecoverySnapshot[] = [];
      let unreadable = 0;
      const unreadableRecords: Array<{ id: string; revision: string }> = [];
      for (const record of records) {
        try {
          if (
            !(record.payload instanceof ArrayBuffer) ||
            record.payload.byteLength > MAX_BYTES + 16
          )
            throw new Error("Invalid encrypted context recovery");
          const bytes = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: record.iv, additionalData: aad(record) },
            await key(),
            record.payload,
          );
          const snapshot: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (
            !validSnapshot(snapshot) ||
            snapshot.id !== record.id ||
            snapshot.scope !== scope ||
            snapshot.revision !== record.revision
          )
            throw new Error("Invalid context recovery snapshot");
          snapshots.push(snapshot);
        } catch {
          unreadable += 1;
          if (typeof record.id === "string" && typeof record.revision === "string") {
            unreadableRecords.push({ id: record.id, revision: record.revision });
          }
        }
      }
      return {
        snapshots: snapshots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        unreadable,
        unreadableRecords,
      };
    },
    async remove(id, revision, scope) {
      const scopeHash = scope !== undefined ? await hashScope(scope) : null;
      const db = await open();
      const transaction = db.transaction("snapshots", "readwrite");
      const completion = transactionDone(transaction);
      const store = transaction.objectStore("snapshots");
      const request = store.get(id);
      request.onsuccess = () => {
        if (
          request.result &&
          (revision === undefined || request.result.revision === revision) &&
          (!scopeHash || request.result.scopeHash === scopeHash)
        )
          store.delete(id);
      };
      await completion;
    },
  };
}
