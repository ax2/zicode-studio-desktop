export const MOBILE_SHARE_INBOX_DB = "zicode-mobile-share-inbox-v1";
export const MOBILE_SHARE_INBOX_STORE = "shares";
export const MOBILE_SHARE_IMAGE_MAX_AGE_MS = 10 * 60 * 1000;
export const MOBILE_SHARE_IMAGE_MAX_COUNT = 4;
export const MOBILE_SHARE_IMAGE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MOBILE_SHARE_IMAGE_MAX_TOTAL_BYTES = 12 * 1024 * 1024;

const VALID_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function openDatabase(indexedDBRef) {
  return new Promise((resolve, reject) => {
    if (!indexedDBRef?.open) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDBRef.open(MOBILE_SHARE_INBOX_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MOBILE_SHARE_INBOX_STORE)) {
        database.createObjectStore(MOBILE_SHARE_INBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open share inbox"));
    request.onblocked = () => reject(new Error("Share inbox is blocked"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Share inbox failed"));
    transaction.onabort = () => reject(transaction.error || new Error("Share inbox was aborted"));
  });
}

function isValidShareId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,128}$/.test(value);
}

function takeRecord(database, id, now) {
  const transaction = database.transaction(MOBILE_SHARE_INBOX_STORE, "readwrite");
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(MOBILE_SHARE_INBOX_STORE);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error || new Error("Could not read share inbox"));
    request.onsuccess = () => {
      let selected = null;
      for (const record of request.result || []) {
        const createdAt = Number(record?.createdAt);
        const expired =
          !Number.isFinite(createdAt) ||
          now - createdAt > MOBILE_SHARE_IMAGE_MAX_AGE_MS ||
          now - createdAt < -60_000;
        if (record?.id === id) selected = record;
        if (record?.id === id || expired) store.delete(record.id);
      }
      resolve(selected);
    };
  }).then(async (record) => {
    await completion;
    return record;
  });
}

function recordToFiles(record, FileCtor) {
  if (!Array.isArray(record?.files) || !FileCtor) return [];
  const files = [];
  let totalBytes = 0;
  for (const entry of record.files.slice(0, MOBILE_SHARE_IMAGE_MAX_COUNT)) {
    const blob = entry?.blob;
    const type = String(entry?.type || blob?.type || "").toLowerCase();
    const size = Number(blob?.size);
    if (
      !blob ||
      !VALID_IMAGE_TYPES.has(type) ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > MOBILE_SHARE_IMAGE_MAX_FILE_BYTES ||
      totalBytes + size > MOBILE_SHARE_IMAGE_MAX_TOTAL_BYTES
    ) {
      continue;
    }
    totalBytes += size;
    const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
    const name = String(entry?.name || `shared-image-${files.length + 1}.${extension}`).slice(0, 255);
    files.push(
      new FileCtor([blob], name, {
        type,
        lastModified: Number(entry?.lastModified) || Date.now(),
      }),
    );
  }
  return files;
}

export async function takeMobileShareImages(
  id,
  {
    indexedDBRef = globalThis.indexedDB,
    FileCtor = globalThis.File,
    now = () => Date.now(),
  } = {},
) {
  if (!isValidShareId(id)) return { status: "invalid", files: [] };
  let database;
  try {
    database = await openDatabase(indexedDBRef);
    const currentTime = now();
    const record = await takeRecord(database, id, currentTime);
    if (!record) return { status: "missing", files: [] };
    const age = currentTime - Number(record.createdAt);
    if (!Number.isFinite(age) || age < -60_000 || age > MOBILE_SHARE_IMAGE_MAX_AGE_MS) {
      return { status: "invalid", files: [] };
    }
    const files = recordToFiles(record, FileCtor);
    return files.length > 0
      ? { status: "imported", files }
      : { status: "invalid", files: [] };
  } catch {
    return { status: "unavailable", files: [] };
  } finally {
    database?.close?.();
  }
}
