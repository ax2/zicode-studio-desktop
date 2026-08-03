export const MOBILE_DRAFT_DB_NAME = "zicode-mobile-drafts-v1";
export const MOBILE_DRAFT_KEY_STORE = "keys";
export const MOBILE_DRAFT_STORE = "drafts";
export const MOBILE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MOBILE_DRAFT_MAX_CHARACTERS = 32_768;
export const MOBILE_DRAFT_MAX_IMAGES = 4;
export const MOBILE_DRAFT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MOBILE_DRAFT_MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
export const MOBILE_DRAFT_MAX_IMAGE_RECORDS = 3;
export const MOBILE_DRAFT_SEND_LATER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DRAFT_KEY_ID = "aes-gcm-v1";
const AES_GCM = "AES-GCM";
const LEGACY_SNAPSHOT_PREFIX = "zicode-mobile-draft-v2\n";
const IMAGE_RECORD_SUFFIX = "\nimages-v1";
const SEND_LATER_RECORD_SUFFIX = "\nsend-later-v1";
const VALID_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Draft storage request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Draft storage failed"));
    transaction.onabort = () => reject(transaction.error || new Error("Draft storage was aborted"));
  });
}

function openDraftDatabase(indexedDBRef) {
  return new Promise((resolve, reject) => {
    if (!indexedDBRef?.open) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDBRef.open(MOBILE_DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MOBILE_DRAFT_KEY_STORE)) {
        database.createObjectStore(MOBILE_DRAFT_KEY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(MOBILE_DRAFT_STORE)) {
        database.createObjectStore(MOBILE_DRAFT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open draft storage"));
    request.onblocked = () => reject(new Error("Draft storage is blocked"));
  });
}

export function createIndexedDBDraftStore(indexedDBRef = globalThis.indexedDB) {
  const databasePromise = openDraftDatabase(indexedDBRef);

  async function run(storeName, mode, operation) {
    const database = await databasePromise;
    const transaction = database.transaction(storeName, mode);
    const completion = transactionDone(transaction);
    completion.catch(() => {});
    const result = await requestResult(operation(transaction.objectStore(storeName)));
    await completion;
    return result;
  }

  return {
    addKey(key) {
      return run(MOBILE_DRAFT_KEY_STORE, "readwrite", (store) =>
        store.add({ id: DRAFT_KEY_ID, key }),
      );
    },
    getKey() {
      return run(MOBILE_DRAFT_KEY_STORE, "readonly", (store) => store.get(DRAFT_KEY_ID)).then(
        (record) => record?.key || null,
      );
    },
    deleteDraft(id) {
      return run(MOBILE_DRAFT_STORE, "readwrite", (store) => store.delete(id));
    },
    getDraft(id) {
      return run(MOBILE_DRAFT_STORE, "readonly", (store) => store.get(id));
    },
    listDrafts() {
      return run(MOBILE_DRAFT_STORE, "readonly", (store) => store.getAll());
    },
    putDraft(record) {
      return run(MOBILE_DRAFT_STORE, "readwrite", (store) => store.put(record));
    },
  };
}

export function mobileDraftId(target) {
  const workspaceId = typeof target?.workspaceId === "string" ? target.workspaceId : "";
  const sessionId = typeof target?.sessionId === "string" ? target.sessionId : "";
  return workspaceId && sessionId ? JSON.stringify([workspaceId, sessionId]) : "";
}

function boundedDraftText(value) {
  return Array.from(String(value || "")).slice(0, MOBILE_DRAFT_MAX_CHARACTERS).join("");
}

function base64ByteLength(value) {
  const maximumEncodedLength = Math.ceil(MOBILE_DRAFT_MAX_IMAGE_BYTES / 3) * 4 + 4;
  if (
    !value ||
    value.length > maximumEncodedLength ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return -1;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function boundedDraftImages(value) {
  const images = [];
  let omittedImageCount = 0;
  let totalBytes = 0;
  for (const candidate of Array.isArray(value) ? value : []) {
    const data = typeof candidate?.data === "string" ? candidate.data : "";
    const mimeType = typeof candidate?.mimeType === "string" ? candidate.mimeType : "";
    const bytes = base64ByteLength(data);
    if (
      images.length >= MOBILE_DRAFT_MAX_IMAGES ||
      candidate?.type !== "image" ||
      !VALID_IMAGE_MIME_TYPES.has(mimeType) ||
      bytes <= 0 ||
      bytes > MOBILE_DRAFT_MAX_IMAGE_BYTES ||
      totalBytes + bytes > MOBILE_DRAFT_MAX_TOTAL_IMAGE_BYTES
    ) {
      omittedImageCount += 1;
      continue;
    }
    images.push({ data, mimeType, type: "image" });
    totalBytes += bytes;
  }
  return { images, omittedImageCount, totalBytes };
}

function decodeLegacySnapshot(value) {
  if (!value.startsWith(LEGACY_SNAPSHOT_PREFIX)) return null;
  let parsed;
  try {
    parsed = JSON.parse(value.slice(LEGACY_SNAPSHOT_PREFIX.length));
  } catch {
    return null;
  }
  if (parsed?.version !== 2 || typeof parsed?.text !== "string" || !Array.isArray(parsed?.images)) {
    return null;
  }
  return {
    images: boundedDraftImages(parsed.images).images,
    text: boundedDraftText(parsed.text),
  };
}

function imageRecordId(target) {
  const id = mobileDraftId(target);
  return id ? `${id}${IMAGE_RECORD_SUFFIX}` : "";
}

function sendLaterRecordId(target) {
  const id = mobileDraftId(target);
  return id ? `${id}${SEND_LATER_RECORD_SUFFIX}` : "";
}

export function createMobileDraftVault({
  store = createIndexedDBDraftStore(),
  cryptoRef = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  let keyPromise = null;

  async function getKey() {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      const existing = await store.getKey();
      if (existing) return existing;
      const generated = await cryptoRef.subtle.generateKey(
        { length: 256, name: AES_GCM },
        false,
        ["decrypt", "encrypt"],
      );
      try {
        await store.addKey(generated);
        return generated;
      } catch {
        const winner = await store.getKey();
        if (winner) return winner;
        throw new Error("Could not store the device draft key");
      }
    })();
    return keyPromise;
  }

  async function clear(target) {
    const id = mobileDraftId(target);
    const imagesId = imageRecordId(target);
    const sendLaterId = sendLaterRecordId(target);
    if (id) {
      await Promise.all([
        store.deleteDraft(id),
        store.deleteDraft(imagesId),
        store.deleteDraft(sendLaterId),
      ]);
    }
  }

  async function cleanup({ preserveImageId = "" } = {}) {
    const currentTime = now();
    const records = await store.listDrafts();
    const staleRecords = (records || []).filter((record) => {
          const age = currentTime - Number(record?.updatedAt);
          const maxAge = record?.id?.endsWith?.(SEND_LATER_RECORD_SUFFIX)
            ? MOBILE_DRAFT_SEND_LATER_MAX_AGE_MS
            : MOBILE_DRAFT_MAX_AGE_MS;
          return !Number.isFinite(age) || age < -60_000 || age > maxAge;
        });
    const staleIds = new Set(staleRecords.map((record) => record.id));
    const excessImageRecords = (records || [])
      .filter(
        (record) =>
          !staleIds.has(record.id) &&
          typeof record?.id === "string" &&
          record.id.endsWith(IMAGE_RECORD_SUFFIX),
      )
      .sort((left, right) => {
        if (left.id === preserveImageId) return -1;
        if (right.id === preserveImageId) return 1;
        return Number(right.updatedAt) - Number(left.updatedAt);
      })
      .slice(MOBILE_DRAFT_MAX_IMAGE_RECORDS);
    await Promise.all(
      [...staleRecords, ...excessImageRecords].map((record) => store.deleteDraft(record.id)),
    );
  }

  async function readRecord(id, { maxAge = MOBILE_DRAFT_MAX_AGE_MS } = {}) {
    if (!id) return "";
    const record = await store.getDraft(id);
    if (!record) return "";
    const age = now() - Number(record.updatedAt);
    if (!Number.isFinite(age) || age < -60_000 || age > maxAge) {
      await store.deleteDraft(id);
      return "";
    }
    try {
      const key = await getKey();
      const additionalData = new TextEncoder().encode(id);
      const decrypted = await cryptoRef.subtle.decrypt(
        {
          additionalData,
          iv: new Uint8Array(record.iv),
          name: AES_GCM,
        },
        key,
        record.ciphertext,
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      await store.deleteDraft(id);
      return "";
    }
  }

  async function writeRecord(id, value) {
    if (!id) return;
    if (!value) {
      await store.deleteDraft(id);
      return;
    }
    const key = await getKey();
    const iv = cryptoRef.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(id);
    const ciphertext = await cryptoRef.subtle.encrypt(
      { additionalData, iv, name: AES_GCM },
      key,
      new TextEncoder().encode(value),
    );
    await store.putDraft({
      ciphertext,
      id,
      iv: iv.buffer,
      updatedAt: now(),
    });
  }

  async function read(target) {
    const value = await readRecord(mobileDraftId(target));
    if (!value) return "";
    const legacy = decodeLegacySnapshot(value);
    return legacy ? legacy.text : boundedDraftText(value);
  }

  async function readImages(target) {
    const value = await readRecord(imageRecordId(target));
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (parsed?.version !== 1 || !Array.isArray(parsed?.images)) {
        throw new Error("Invalid mobile image draft");
      }
      return boundedDraftImages(parsed.images).images;
    } catch {
      await store.deleteDraft(imageRecordId(target));
      return [];
    }
  }

  async function readSnapshot(target) {
    const [textValue, images] = await Promise.all([
      readRecord(mobileDraftId(target)),
      readImages(target),
    ]);
    if (!textValue) return { images, text: "" };
    const legacy = decodeLegacySnapshot(textValue);
    return legacy || { images, text: boundedDraftText(textValue) };
  }

  async function save(target, value) {
    const text = boundedDraftText(value);
    await writeRecord(mobileDraftId(target), text.trim() ? text : "");
  }

  async function saveImages(target, value) {
    const bounded = boundedDraftImages(value);
    const encoded = bounded.images.length
      ? JSON.stringify({ images: bounded.images, version: 1 })
      : "";
    await writeRecord(imageRecordId(target), encoded);
    if (bounded.images.length > 0) {
      await cleanup({ preserveImageId: imageRecordId(target) });
    }
    return {
      imageCount: bounded.images.length,
      omittedImageCount: bounded.omittedImageCount,
    };
  }

  async function saveSnapshot(target, value) {
    const [, imageResult] = await Promise.all([
      save(target, value?.text),
      saveImages(target, value?.images),
    ]);
    return imageResult;
  }

  async function clearQueued(target) {
    const id = sendLaterRecordId(target);
    if (id) await store.deleteDraft(id);
  }

  async function markQueued(target) {
    const queuedAt = now();
    await writeRecord(
      sendLaterRecordId(target),
      JSON.stringify({ queuedAt, version: 1 }),
    );
    return { queuedAt };
  }

  async function readQueued(target) {
    const id = sendLaterRecordId(target);
    const value = await readRecord(id, { maxAge: MOBILE_DRAFT_SEND_LATER_MAX_AGE_MS });
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      const age = now() - Number(parsed?.queuedAt);
      if (
        parsed?.version !== 1 ||
        !Number.isFinite(age) ||
        age < -60_000 ||
        age > MOBILE_DRAFT_SEND_LATER_MAX_AGE_MS
      ) {
        throw new Error("Invalid send-later marker");
      }
      return { queuedAt: Number(parsed.queuedAt) };
    } catch {
      await store.deleteDraft(id);
      return null;
    }
  }

  return {
    cleanup,
    clear,
    clearQueued,
    markQueued,
    read,
    readQueued,
    readSnapshot,
    save,
    saveImages,
    saveSnapshot,
  };
}
