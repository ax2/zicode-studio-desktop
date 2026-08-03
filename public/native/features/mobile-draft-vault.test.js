// @vitest-environment node

import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createMobileDraftVault,
  MOBILE_DRAFT_MAX_AGE_MS,
  MOBILE_DRAFT_MAX_IMAGE_RECORDS,
  MOBILE_DRAFT_MAX_IMAGES,
  MOBILE_DRAFT_SEND_LATER_MAX_AGE_MS,
  mobileDraftId,
} from "./mobile-draft-vault.js";

function createMemoryStore() {
  const drafts = new Map();
  let key = null;
  return {
    drafts,
    get storedKey() {
      return key;
    },
    async addKey(value) {
      if (key) throw new Error("ConstraintError");
      key = value;
    },
    async getKey() {
      return key;
    },
    async deleteDraft(id) {
      drafts.delete(id);
    },
    async getDraft(id) {
      return drafts.get(id) || null;
    },
    async listDrafts() {
      return [...drafts.values()];
    },
    async putDraft(record) {
      drafts.set(record.id, record);
    },
  };
}

describe("encrypted mobile draft vault", () => {
  it("encrypts a per-session draft with a non-extractable key and restores it", async () => {
    const store = createMemoryStore();
    const target = { workspaceId: "workspace-1", sessionId: "session-1" };
    const vault = createMobileDraftVault({ cryptoRef: webcrypto, store, now: () => 1_000_000 });

    await vault.save(target, "Private unfinished prompt");

    const record = store.drafts.get(mobileDraftId(target));
    expect(record).toBeTruthy();
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain("Private unfinished prompt");
    expect(store.storedKey.extractable).toBe(false);
    expect(await vault.read(target)).toBe("Private unfinished prompt");
    expect(await vault.read({ workspaceId: "workspace-1", sessionId: "session-2" })).toBe("");
  });

  it("encrypts bounded image attachments with the text snapshot", async () => {
    const store = createMemoryStore();
    const target = { workspaceId: "workspace-1", sessionId: "session-images" };
    const vault = createMobileDraftVault({ cryptoRef: webcrypto, store, now: () => 1_000_000 });
    const image = {
      data: "cHJpdmF0ZS1pbWFnZS1ieXRlcw==",
      mimeType: "image/png",
      type: "image",
    };

    expect(await vault.saveSnapshot(target, { images: [image], text: "Caption" })).toEqual({
      imageCount: 1,
      omittedImageCount: 0,
    });

    const record = store.drafts.get(mobileDraftId(target));
    const ciphertext = new TextDecoder().decode(record.ciphertext);
    const imageRecord = [...store.drafts.values()].find((value) => value.id !== record.id);
    expect(store.drafts.size).toBe(2);
    expect(ciphertext).not.toContain("Caption");
    expect(new TextDecoder().decode(imageRecord.ciphertext)).not.toContain(image.data);
    expect(await vault.readSnapshot(target)).toEqual({ images: [image], text: "Caption" });

    await vault.save(target, "Changed caption");
    expect([...store.drafts.values()].find((value) => value.id === imageRecord.id)).toBe(imageRecord);
    expect(await vault.readSnapshot(target)).toEqual({ images: [image], text: "Changed caption" });
  });

  it("omits invalid or excess images without losing a valid text draft", async () => {
    const store = createMemoryStore();
    const target = { workspaceId: "workspace-1", sessionId: "session-limits" };
    const vault = createMobileDraftVault({ cryptoRef: webcrypto, store });
    const image = { data: "aW1hZ2U=", mimeType: "image/jpeg", type: "image" };
    const images = Array.from({ length: MOBILE_DRAFT_MAX_IMAGES + 2 }, () => ({ ...image }));
    images.push({ data: "not base64", mimeType: "image/png", type: "image" });

    expect(await vault.saveSnapshot(target, { images, text: "Keep me" })).toEqual({
      imageCount: MOBILE_DRAFT_MAX_IMAGES,
      omittedImageCount: 3,
    });
    const restored = await vault.readSnapshot(target);
    expect(restored.text).toBe("Keep me");
    expect(restored.images).toHaveLength(MOBILE_DRAFT_MAX_IMAGES);
  });

  it("keeps image recovery bounded to the most recent sessions", async () => {
    let currentTime = 1_000_000;
    const store = createMemoryStore();
    const vault = createMobileDraftVault({
      cryptoRef: webcrypto,
      now: () => currentTime,
      store,
    });
    const image = { data: "aW1hZ2U=", mimeType: "image/png", type: "image" };
    const targets = Array.from({ length: MOBILE_DRAFT_MAX_IMAGE_RECORDS + 1 }, (_, index) => ({
      sessionId: `session-${index}`,
      workspaceId: "workspace-1",
    }));

    for (const value of targets) {
      await vault.saveSnapshot(value, { images: [image], text: `Draft ${value.sessionId}` });
      currentTime += 1;
    }

    expect((await vault.readSnapshot(targets[0])).images).toEqual([]);
    expect(await vault.read(targets[0])).toBe("Draft session-0");
    expect((await vault.readSnapshot(targets.at(-1))).images).toEqual([image]);
  });

  it("encrypts an expiring send-later marker without deleting the draft", async () => {
    let currentTime = 1_000_000;
    const store = createMemoryStore();
    const target = { workspaceId: "workspace-1", sessionId: "session-queued" };
    const vault = createMobileDraftVault({
      cryptoRef: webcrypto,
      now: () => currentTime,
      store,
    });
    await vault.save(target, "Send after reconnect");
    expect(await vault.markQueued(target)).toEqual({ queuedAt: currentTime });
    expect(await vault.readQueued(target)).toEqual({ queuedAt: currentTime });
    const records = [...store.drafts.values()];
    expect(records).toHaveLength(2);
    expect(
      records.every(
        (record) => !new TextDecoder().decode(record.ciphertext).includes("queuedAt"),
      ),
    ).toBe(true);

    currentTime += MOBILE_DRAFT_SEND_LATER_MAX_AGE_MS + 1;
    expect(await vault.readQueued(target)).toBeNull();
    expect(await vault.read(target)).toBe("Send after reconnect");
  });

  it("deletes expired and tampered records instead of exposing unusable text", async () => {
    let currentTime = 1_000_000;
    const store = createMemoryStore();
    const target = { workspaceId: "workspace-1", sessionId: "session-1" };
    const vault = createMobileDraftVault({
      cryptoRef: webcrypto,
      store,
      now: () => currentTime,
    });
    await vault.save(target, "Draft");
    const id = mobileDraftId(target);
    const record = store.drafts.get(id);
    record.ciphertext = new Uint8Array([1, 2, 3]).buffer;

    expect(await vault.read(target)).toBe("");
    expect(store.drafts.has(id)).toBe(false);

    await vault.save(target, "Old draft");
    currentTime += MOBILE_DRAFT_MAX_AGE_MS + 1;
    await vault.cleanup();
    expect(store.drafts.has(id)).toBe(false);
  });

  it("clears whitespace and successfully submitted drafts", async () => {
    const store = createMemoryStore();
    const target = { workspaceId: "workspace-1", sessionId: "session-1" };
    const vault = createMobileDraftVault({ cryptoRef: webcrypto, store });
    const deleteSpy = vi.spyOn(store, "deleteDraft");

    await vault.save(target, "Ready to send");
    await vault.saveImages(target, [
      { data: "aW1hZ2U=", mimeType: "image/png", type: "image" },
    ]);
    await vault.markQueued(target);
    await vault.clear(target);
    expect(await vault.readSnapshot(target)).toEqual({ images: [], text: "" });
    expect(await vault.readQueued(target)).toBeNull();

    await vault.save(target, "   ");
    expect(deleteSpy).toHaveBeenCalledWith(mobileDraftId(target));
  });
});
