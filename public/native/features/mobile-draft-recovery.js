import { createMobileDraftVault, mobileDraftId } from "./mobile-draft-vault.js";

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_OPERATION_TIMEOUT_MS = 3_000;

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Draft storage timed out")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function inertController() {
  return {
    clear: async () => ({ status: "ignored" }),
    clearAfterSubmit: async () => ({ status: "ignored" }),
    clearQueued: async () => ({ status: "ignored" }),
    dispose() {},
    flush: async () => ({ status: "ignored" }),
    restoreCurrent: async () => ({ status: "ignored" }),
    markQueued: async () => ({ status: "ignored" }),
    readQueued: async () => null,
    setTarget: async () => ({ status: "ignored" }),
    sync() {},
    syncImages() {},
  };
}

export function setupMobileDraftRecovery({
  clientType,
  input,
  getTarget,
  getImages = () => [],
  setImages = () => {},
  vault = null,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  onRestored = () => {},
  onImagesOmitted = () => {},
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  EventCtor = globalThis.Event,
} = {}) {
  if (clientType !== "remote" || !input || typeof getTarget !== "function") {
    return inertController();
  }
  const draftVault = vault || createMobileDraftVault();

  let activeTarget = getTarget();
  let disposed = false;
  let generation = 0;
  let revision = 0;
  let saveTimer = null;
  let persistImagesOnNextSave = false;
  let suppressInput = false;
  let warnedGeneration = -1;

  function cancelTimer() {
    if (saveTimer === null) return;
    windowRef.clearTimeout(saveTimer);
    saveTimer = null;
  }

  function safe(operation) {
    return withTimeout(Promise.resolve().then(operation), operationTimeoutMs);
  }

  function snapshot() {
    return { images: getImages(), text: input.value };
  }

  function persist(target, value, { includeImages = false } = {}) {
    const operation =
      includeImages && draftVault.saveSnapshot
        ? () => draftVault.saveSnapshot(target, value)
        : () => draftVault.save(target, value.text);
    return safe(operation)
      .then((result) => {
        if (result?.omittedImageCount > 0 && warnedGeneration !== generation) {
          warnedGeneration = generation;
          onImagesOmitted({ count: result.omittedImageCount, target });
        }
        return { ok: true, result };
      })
      .catch(() => ({ ok: false }));
  }

  function scheduleSave({ includeImages = false } = {}) {
    cancelTimer();
    persistImagesOnNextSave ||= includeImages;
    const target = activeTarget;
    const value = snapshot();
    saveTimer = windowRef.setTimeout(() => {
      saveTimer = null;
      const persistImages = persistImagesOnNextSave;
      persistImagesOnNextSave = false;
      void persist(target, value, { includeImages: persistImages });
    }, debounceMs);
  }

  function sync() {
    if (disposed || suppressInput) return;
    revision += 1;
    scheduleSave();
  }

  function syncImages() {
    if (disposed || suppressInput) return;
    revision += 1;
    scheduleSave({ includeImages: true });
  }

  async function flush() {
    cancelTimer();
    persistImagesOnNextSave = false;
    if (disposed) return { status: "ignored" };
    const result = await persist(activeTarget, snapshot(), { includeImages: true });
    return { status: result.ok ? "saved" : "unavailable" };
  }

  async function restoreCurrent() {
    if (disposed) return { status: "ignored" };
    const expectedGeneration = generation;
    const expectedRevision = revision;
    const expectedTarget = activeTarget;
    const initialValue = input.value;
    const initialImages = getImages();
    let restored = { images: [], text: "" };
    try {
      restored = await safe(() =>
        draftVault.readSnapshot
          ? draftVault.readSnapshot(expectedTarget)
          : draftVault.read(expectedTarget).then((text) => ({ images: [], text })),
      );
    } catch {
      return { status: "unavailable" };
    }
    if (
      disposed ||
      generation !== expectedGeneration ||
      revision !== expectedRevision ||
      mobileDraftId(activeTarget) !== mobileDraftId(expectedTarget) ||
      input.value !== initialValue ||
      input.value.trim() ||
      getImages().length !== initialImages.length ||
      initialImages.length > 0
    ) {
      return { status: "skipped" };
    }
    const text = restored?.text || "";
    const images = Array.isArray(restored?.images) ? restored.images : [];
    if (!text && images.length === 0) return { status: "empty" };
    suppressInput = true;
    input.value = text;
    setImages(images);
    input.dispatchEvent(new EventCtor("input", { bubbles: true }));
    suppressInput = false;
    revision += 1;
    input.focus();
    input.setSelectionRange?.(input.value.length, input.value.length);
    onRestored({ imageCount: images.length, target: expectedTarget, textLength: text.length });
    return { images, status: "restored", text };
  }

  async function setTarget(nextTarget, { preserveInput = false } = {}) {
    if (disposed || !mobileDraftId(nextTarget)) return { status: "ignored" };
    const previousTarget = activeTarget;
    if (mobileDraftId(previousTarget) === mobileDraftId(nextTarget)) {
      activeTarget = nextTarget;
      return { status: "unchanged" };
    }
    const previousSnapshot = snapshot();
    cancelTimer();
    persistImagesOnNextSave = false;
    generation += 1;
    warnedGeneration = -1;
    revision += 1;
    activeTarget = nextTarget;

    if (preserveInput) {
      const queued = draftVault.readQueued
        ? await safe(() => draftVault.readQueued(previousTarget)).catch(() => null)
        : null;
      await persist(nextTarget, previousSnapshot, { includeImages: true });
      if (queued && draftVault.markQueued) {
        await safe(() => draftVault.markQueued(nextTarget)).catch(() => {});
      }
      await safe(() => draftVault.clear(previousTarget)).catch(() => {});
      return { status: "migrated" };
    }

    void persist(previousTarget, previousSnapshot, { includeImages: true });
    suppressInput = true;
    input.value = "";
    setImages([]);
    input.dispatchEvent(new EventCtor("input", { bubbles: true }));
    suppressInput = false;
    return restoreCurrent();
  }

  async function clear() {
    cancelTimer();
    persistImagesOnNextSave = false;
    await safe(() => draftVault.clear(activeTarget)).catch(() => {});
    return { status: "cleared" };
  }

  async function clearAfterSubmit() {
    cancelTimer();
    persistImagesOnNextSave = false;
    if (draftVault.clearQueued) {
      await safe(() => draftVault.clearQueued(activeTarget)).catch(() => {});
    }
    if (input.value.trim() || getImages().length > 0) {
      await persist(activeTarget, snapshot(), { includeImages: true });
      return { status: "preserved" };
    }
    return clear();
  }

  async function clearQueued() {
    if (!draftVault.clearQueued) return { status: "ignored" };
    await safe(() => draftVault.clearQueued(activeTarget)).catch(() => {});
    return { status: "cleared" };
  }

  async function markQueued() {
    if (!draftVault.markQueued) return { status: "unavailable" };
    const saved = await flush();
    if (saved.status !== "saved") return { status: "unavailable" };
    const result = await safe(() => draftVault.markQueued(activeTarget)).catch(() => null);
    return result ? { ...result, status: "queued" } : { status: "unavailable" };
  }

  async function readQueued() {
    if (!draftVault.readQueued) return null;
    return safe(() => draftVault.readQueued(activeTarget)).catch(() => null);
  }

  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "hidden") void flush();
  };
  const onPageHide = () => void flush();
  input.addEventListener("input", sync);
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  windowRef.addEventListener("pagehide", onPageHide);
  void safe(() => draftVault.cleanup()).catch(() => {});

  return {
    clear,
    clearAfterSubmit,
    clearQueued,
    dispose() {
      if (disposed) return;
      void flush();
      disposed = true;
      cancelTimer();
      input.removeEventListener("input", sync);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      windowRef.removeEventListener("pagehide", onPageHide);
    },
    flush,
    markQueued,
    readQueued,
    restoreCurrent,
    setTarget,
    sync,
    syncImages,
  };
}
