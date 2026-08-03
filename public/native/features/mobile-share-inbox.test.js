// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  MOBILE_SHARE_IMAGE_MAX_AGE_MS,
  MOBILE_SHARE_INBOX_DB,
  MOBILE_SHARE_INBOX_STORE,
  takeMobileShareImages,
} from "./mobile-share-inbox.js";

function createIndexedDB(records) {
  const values = new Map(records.map((record) => [record.id, record]));
  const database = {
    close() {},
    createObjectStore() {},
    objectStoreNames: { contains: (name) => name === MOBILE_SHARE_INBOX_STORE },
    transaction() {
      const transaction = { error: null };
      transaction.objectStore = () => ({
        delete: (id) => values.delete(id),
        getAll: () => {
          const request = {};
          queueMicrotask(() => {
            request.result = [...values.values()];
            request.onsuccess?.();
            queueMicrotask(() => transaction.oncomplete?.());
          });
          return request;
        },
      });
      return transaction;
    },
  };
  return {
    open(name) {
      expect(name).toBe(MOBILE_SHARE_INBOX_DB);
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
    values,
  };
}

describe("mobile share image inbox", () => {
  it("takes a fresh image record once and returns browser File objects", async () => {
    const createdAt = 1_000_000;
    const id = "12345678-1234-1234-1234-123456789abc";
    const blob = new Blob(["image-bytes"], { type: "image/jpeg" });
    const inbox = createIndexedDB([
      {
        id,
        createdAt,
        files: [{ blob, name: "camera.jpg", type: "image/jpeg", lastModified: createdAt }],
      },
    ]);

    const result = await takeMobileShareImages(id, {
      FileCtor: File,
      indexedDBRef: inbox,
      now: () => createdAt + 1_000,
    });

    expect(result.status).toBe("imported");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ name: "camera.jpg", type: "image/jpeg" });
    expect(inbox.values.has(id)).toBe(false);
  });

  it("deletes an expired record without returning its image", async () => {
    const createdAt = 1_000_000;
    const id = "87654321-4321-4321-4321-cba987654321";
    const inbox = createIndexedDB([
      {
        id,
        createdAt,
        files: [
          {
            blob: new Blob(["old"], { type: "image/png" }),
            name: "old.png",
            type: "image/png",
          },
        ],
      },
    ]);

    const result = await takeMobileShareImages(id, {
      FileCtor: File,
      indexedDBRef: inbox,
      now: () => createdAt + MOBILE_SHARE_IMAGE_MAX_AGE_MS + 1,
    });

    expect(result).toEqual({ status: "invalid", files: [] });
    expect(inbox.values.has(id)).toBe(false);
  });
});
