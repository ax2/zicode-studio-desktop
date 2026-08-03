// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  consumeMobileShareTarget,
  formatMobileShareTarget,
  MOBILE_SHARE_TARGET_KEY,
  MOBILE_SHARE_TARGET_MAX_AGE_MS,
} from "./mobile-share-target.js";

function storageWith(payload) {
  const values = new Map([[MOBILE_SHARE_TARGET_KEY, JSON.stringify(payload)]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

describe("mobile Web Share Target", () => {
  it("formats title, text, and URL without duplicate fields", () => {
    expect(
      formatMobileShareTarget({
        title: "Research page",
        text: "Useful excerpt",
        url: "https://example.com/article",
      }),
    ).toBe("Research page\n\nUseful excerpt\n\nhttps://example.com/article");
    expect(formatMobileShareTarget({ title: "Same", text: "Same" })).toBe("Same");
  });

  it("consumes a fresh share once and appends it to the editable composer", async () => {
    document.body.innerHTML = '<textarea id="message-input">Existing draft</textarea>';
    const input = document.getElementById("message-input");
    const focus = vi.spyOn(input, "focus");
    const onInput = vi.fn();
    input.addEventListener("input", onInput);
    const createdAt = 1_000_000;
    const storage = storageWith({
      createdAt,
      title: "Shared title",
      text: "Shared text",
      url: "https://example.com",
    });

    expect(
      await consumeMobileShareTarget({
        clientType: "remote",
        input,
        storage,
        now: () => createdAt + 1_000,
      }),
    ).toEqual({
      status: "imported",
      text: "Shared title\n\nShared text\n\nhttps://example.com",
      imageCount: 0,
    });
    expect(input.value).toBe(
      "Existing draft\n\nShared title\n\nShared text\n\nhttps://example.com",
    );
    expect(onInput).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(storage.has(MOBILE_SHARE_TARGET_KEY)).toBe(false);
  });

  it("imports shared images through the existing composer processing queue", async () => {
    document.body.innerHTML = '<textarea id="message-input">Existing draft</textarea>';
    const input = document.getElementById("message-input");
    const createdAt = 1_000_000;
    const storage = storageWith({
      createdAt,
      imageShareId: "12345678-1234-1234-1234-123456789abc",
      text: "Photo context",
    });
    const files = [new File(["photo"], "shared.jpg", { type: "image/jpeg" })];
    const addImageFiles = vi.fn(async () => {});

    expect(
      await consumeMobileShareTarget({
        addImageFiles,
        clientType: "remote",
        input,
        now: () => createdAt + 1_000,
        storage,
        takeSharedImages: async () => ({ status: "imported", files }),
      }),
    ).toEqual({ status: "imported", text: "Photo context", imageCount: 1 });
    expect(addImageFiles).toHaveBeenCalledWith(files);
    expect(input.value).toBe("Existing draft\n\nPhoto context");
  });

  it("keeps valid shared text while reporting an image import failure", async () => {
    const input = document.createElement("textarea");
    const createdAt = 1_000_000;
    const storage = storageWith({
      createdAt,
      imageError: "too_large",
      text: "Keep this text",
    });

    expect(
      await consumeMobileShareTarget({
        clientType: "remote",
        input,
        now: () => createdAt + 1_000,
        storage,
      }),
    ).toEqual({ status: "partial", text: "Keep this text", imageCount: 0 });
    expect(input.value).toBe("Keep this text");
  });

  it("continues with a friendly failure when the image inbox does not respond", async () => {
    const input = document.createElement("textarea");
    const createdAt = 1_000_000;
    const storage = storageWith({
      createdAt,
      imageShareId: "12345678-1234-1234-1234-123456789abc",
    });

    expect(
      await consumeMobileShareTarget({
        clientType: "remote",
        imageReadTimeoutMs: 1,
        input,
        now: () => createdAt + 1_000,
        storage,
        takeSharedImages: () => new Promise(() => {}),
      }),
    ).toEqual({ status: "invalid" });
  });

  it("deletes expired or malformed content without changing the composer", async () => {
    const input = document.createElement("textarea");
    input.value = "Keep me";
    const createdAt = 1_000_000;
    const storage = storageWith({ createdAt, text: "Stale" });

    expect(
      await consumeMobileShareTarget({
        clientType: "remote",
        input,
        storage,
        now: () => createdAt + MOBILE_SHARE_TARGET_MAX_AGE_MS + 1,
      }),
    ).toEqual({ status: "invalid" });
    expect(input.value).toBe("Keep me");
    expect(storage.has(MOBILE_SHARE_TARGET_KEY)).toBe(false);
  });

  it("does not consume a share in the desktop client", async () => {
    const input = document.createElement("textarea");
    const storage = storageWith({ createdAt: Date.now(), text: "Remote only" });

    expect(await consumeMobileShareTarget({ clientType: "desktop", input, storage })).toEqual({
      status: "ignored",
    });
    expect(storage.has(MOBILE_SHARE_TARGET_KEY)).toBe(true);
  });
});
