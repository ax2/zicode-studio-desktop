// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMobileDraftRecovery } from "./mobile-draft-recovery.js";
import { mobileDraftId } from "./mobile-draft-vault.js";

function target(sessionId) {
  return { workspaceId: "workspace-1", sessionId };
}

function createVault(drafts = new Map()) {
  const queued = new Map();
  const normalize = (value) =>
    typeof value === "string" ? { images: [], text: value } : value || { images: [], text: "" };
  return {
    cleanup: vi.fn(async () => {}),
    clear: vi.fn(async (value) => {
      drafts.delete(mobileDraftId(value));
      queued.delete(mobileDraftId(value));
    }),
    clearQueued: vi.fn(async (value) => queued.delete(mobileDraftId(value))),
    read: vi.fn(async (value) => drafts.get(mobileDraftId(value)) || ""),
    readSnapshot: vi.fn(async (value) => normalize(drafts.get(mobileDraftId(value)))),
    readQueued: vi.fn(async (value) => queued.get(mobileDraftId(value)) || null),
    save: vi.fn(async (value, text) => {
      if (text.trim()) drafts.set(mobileDraftId(value), text);
      else drafts.delete(mobileDraftId(value));
    }),
    saveSnapshot: vi.fn(async (value, snapshot) => {
      if (snapshot.text.trim() || snapshot.images.length > 0) {
        drafts.set(mobileDraftId(value), snapshot);
      } else drafts.delete(mobileDraftId(value));
      return { imageCount: snapshot.images.length, omittedImageCount: 0 };
    }),
    markQueued: vi.fn(async (value) => {
      const marker = { queuedAt: 100 };
      queued.set(mobileDraftId(value), marker);
      return marker;
    }),
  };
}

describe("mobile draft recovery", () => {
  let input;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<textarea id="message-input"></textarea>';
    input = document.getElementById("message-input");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restores a session draft without overwriting user input that arrives first", async () => {
    let finishRead;
    const vault = createVault();
    vault.readSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      getTarget: () => target("session-1"),
      input,
      vault,
    });

    const restoring = controller.restoreCurrent();
    await Promise.resolve();
    input.value = "User already typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    finishRead({ images: [], text: "Stored draft" });

    expect(await restoring).toEqual({ status: "skipped" });
    expect(input.value).toBe("User already typed");
    controller.dispose();
  });

  it("restores, focuses, and autosaves a changed draft", async () => {
    const drafts = new Map([[mobileDraftId(target("session-1")), "Recovered prompt"]]);
    const vault = createVault(drafts);
    const restored = vi.fn();
    const focus = vi.spyOn(input, "focus");
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      debounceMs: 10,
      getTarget: () => target("session-1"),
      input,
      onRestored: restored,
      vault,
    });

    expect(await controller.restoreCurrent()).toEqual({
      images: [],
      status: "restored",
      text: "Recovered prompt",
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(restored).toHaveBeenCalledWith({
      imageCount: 0,
      target: target("session-1"),
      textLength: 16,
    });

    input.value = "Updated prompt";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(vault.save).toHaveBeenCalledWith(target("session-1"), "Updated prompt");
    expect(vault.saveSnapshot).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("isolates drafts when switching sessions and migrates a temporary session", async () => {
    const drafts = new Map([[mobileDraftId(target("session-2")), "Second session draft"]]);
    const vault = createVault(drafts);
    const current = target("session-1");
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      getTarget: () => current,
      input,
      vault,
    });
    input.value = "First session draft";

    expect(await controller.setTarget(target("session-2"))).toEqual({
      images: [],
      status: "restored",
      text: "Second session draft",
    });
    expect(input.value).toBe("Second session draft");
    await vi.waitFor(() =>
      expect(vault.saveSnapshot).toHaveBeenCalledWith(target("session-1"), {
        images: [],
        text: "First session draft",
      }),
    );

    input.value = "Temporary draft";
    expect(
      await controller.setTarget(target("session-final"), { preserveInput: true }),
    ).toEqual({ status: "migrated" });
    expect(input.value).toBe("Temporary draft");
    expect(vault.saveSnapshot).toHaveBeenCalledWith(target("session-final"), {
      images: [],
      text: "Temporary draft",
    });
    controller.dispose();
  });

  it("clears a successfully submitted draft and stays inactive on desktop", async () => {
    const vault = createVault();
    const mobile = setupMobileDraftRecovery({
      clientType: "remote",
      getTarget: () => target("session-1"),
      input,
      vault,
    });
    await mobile.clear();
    expect(vault.clear).toHaveBeenCalledWith(target("session-1"));

    input.value = "New text typed while the request was accepted";
    expect(await mobile.clearAfterSubmit()).toEqual({ status: "preserved" });
    expect(vault.saveSnapshot).toHaveBeenCalledWith(target("session-1"), {
      images: [],
      text: "New text typed while the request was accepted",
    });
    mobile.dispose();

    const desktopVault = createVault();
    const desktop = setupMobileDraftRecovery({
      clientType: "desktop",
      getTarget: () => target("session-1"),
      input,
      vault: desktopVault,
    });
    input.value = "Desktop draft";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await desktop.restoreCurrent();
    expect(desktopVault.readSnapshot).not.toHaveBeenCalled();
    expect(desktopVault.saveSnapshot).not.toHaveBeenCalled();
  });

  it("restores image-only drafts and preserves newly attached images after submit", async () => {
    const image = { data: "aW1hZ2U=", mimeType: "image/png", type: "image" };
    const drafts = new Map([
      [mobileDraftId(target("session-1")), { images: [image], text: "" }],
    ]);
    const vault = createVault(drafts);
    let images = [];
    const restored = vi.fn();
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      getImages: () => images.map((value) => ({ ...value })),
      getTarget: () => target("session-1"),
      input,
      onRestored: restored,
      setImages: (value) => {
        images = value.map((item) => ({ ...item }));
      },
      vault,
    });

    expect(await controller.restoreCurrent()).toEqual({
      images: [image],
      status: "restored",
      text: "",
    });
    expect(images).toEqual([image]);
    expect(restored).toHaveBeenCalledWith({
      imageCount: 1,
      target: target("session-1"),
      textLength: 0,
    });

    images = [{ ...image, data: "bmV3LWltYWdl" }];
    expect(await controller.clearAfterSubmit()).toEqual({ status: "preserved" });
    expect(vault.saveSnapshot).toHaveBeenLastCalledWith(target("session-1"), {
      images,
      text: "",
    });
    controller.dispose();
  });

  it("does not overwrite an image attached while recovery is reading", async () => {
    const storedImage = { data: "c3RvcmVk", mimeType: "image/png", type: "image" };
    const newImage = { data: "bmV3", mimeType: "image/jpeg", type: "image" };
    const vault = createVault();
    let finishRead;
    vault.readSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    let images = [];
    const setImages = vi.fn((value) => {
      images = value;
    });
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      getImages: () => images,
      getTarget: () => target("session-1"),
      input,
      setImages,
      vault,
    });

    const restoring = controller.restoreCurrent();
    await Promise.resolve();
    images = [newImage];
    controller.syncImages();
    finishRead({ images: [storedImage], text: "Stored" });

    expect(await restoring).toEqual({ status: "skipped" });
    expect(images).toEqual([newImage]);
    expect(setImages).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("warns once when attachment recovery limits omit images", async () => {
    const image = { data: "aW1hZ2U=", mimeType: "image/png", type: "image" };
    const vault = createVault();
    vault.saveSnapshot.mockResolvedValue({ imageCount: 0, omittedImageCount: 1 });
    const omitted = vi.fn();
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      debounceMs: 10,
      getImages: () => [image],
      getTarget: () => target("session-1"),
      input,
      onImagesOmitted: omitted,
      vault,
    });

    controller.syncImages();
    await vi.advanceTimersByTimeAsync(10);
    controller.syncImages();
    await vi.advanceTimersByTimeAsync(10);

    expect(vault.saveSnapshot).toHaveBeenCalledTimes(2);
    expect(omitted).toHaveBeenCalledOnce();
    expect(omitted).toHaveBeenCalledWith({ count: 1, target: target("session-1") });
    controller.dispose();
  });

  it("persists, migrates, and clears an explicit send-later marker", async () => {
    const vault = createVault();
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      getTarget: () => target("temporary-1"),
      input,
      vault,
    });
    input.value = "Send when connected";

    expect(await controller.markQueued()).toEqual({ queuedAt: 100, status: "queued" });
    expect(await controller.readQueued()).toEqual({ queuedAt: 100 });
    expect(vault.saveSnapshot).toHaveBeenCalledWith(target("temporary-1"), {
      images: [],
      text: "Send when connected",
    });

    await controller.setTarget(target("session-final"), { preserveInput: true });
    expect(vault.markQueued).toHaveBeenCalledWith(target("session-final"));
    expect(await controller.readQueued()).toEqual({ queuedAt: 100 });

    input.value = "";
    await controller.clearAfterSubmit();
    expect(vault.clearQueued).toHaveBeenCalledWith(target("session-final"));
    expect(await controller.readQueued()).toBeNull();
    controller.dispose();
  });

  it("does not create a send intent when encrypted draft storage is unavailable", async () => {
    const vault = createVault();
    vault.saveSnapshot.mockRejectedValue(new Error("Quota exceeded"));
    const controller = setupMobileDraftRecovery({
      clientType: "remote",
      getTarget: () => target("session-1"),
      input,
      vault,
    });
    input.value = "Keep this visible";

    expect(await controller.markQueued()).toEqual({ status: "unavailable" });
    expect(vault.markQueued).not.toHaveBeenCalled();
    expect(input.value).toBe("Keep this visible");
    controller.dispose();
  });
});
