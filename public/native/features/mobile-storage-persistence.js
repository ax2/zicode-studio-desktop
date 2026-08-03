import { t } from "../../i18n.js";

function formatMegabytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  const megabytes = value / (1024 * 1024);
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

export function setupMobileStoragePersistence({
  clientType,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
} = {}) {
  const section = documentRef?.getElementById?.("mobile-task-notification-section");
  const row = documentRef?.getElementById?.("mobile-draft-storage-row");
  const button = documentRef?.getElementById?.("protect-mobile-draft-storage");
  const status = documentRef?.getElementById?.("mobile-draft-storage-status");
  if (clientType !== "remote") {
    row?.classList.add("hidden");
    return null;
  }
  if (!section || !row || !button || !status) return null;

  section.classList.remove("hidden");
  row.classList.remove("hidden");
  const storage = navigatorRef?.storage;
  let state = "checking";
  let estimate = null;
  let requesting = false;
  let disposed = false;
  let generation = 0;

  function supported() {
    return typeof storage?.persisted === "function" && typeof storage?.persist === "function";
  }

  function estimateCopy() {
    const usage = formatMegabytes(estimate?.usage);
    const quota = formatMegabytes(estimate?.quota);
    if (!usage || !quota) return "";
    return t("Storage used: {usage} of {quota}.")
      .replace("{usage}", usage)
      .replace("{quota}", quota);
  }

  function render() {
    const protectedStorage = state === "protected";
    button.disabled = requesting || protectedStorage || state === "unsupported";
    button.setAttribute("aria-busy", String(requesting));
    button.textContent = t(
      requesting
        ? "Requesting…"
        : protectedStorage
          ? "Protected"
          : state === "unsupported"
            ? "Unavailable"
            : "Protect drafts",
    );
    status.dataset.state = state;
    const primary = t(
      state === "protected"
        ? "The browser will not automatically evict ZiCode drafts. Clearing site data still removes them."
        : state === "denied"
          ? "The browser did not grant protection. Drafts remain encrypted but may be cleared under storage pressure."
          : state === "unsupported"
            ? "Persistent storage is unavailable in this browser. Drafts may be cleared under storage pressure."
            : state === "error"
              ? "ZiCode could not read the browser storage status. Your current draft remains available."
              : "Drafts are encrypted on this phone but may be cleared when the browser needs space.",
    );
    const usage = estimateCopy();
    status.textContent = usage ? `${primary} ${usage}` : primary;
  }

  async function refresh() {
    const currentGeneration = ++generation;
    if (!supported()) {
      state = "unsupported";
      render();
      return false;
    }
    try {
      const [persisted, nextEstimate] = await Promise.all([
        storage.persisted(),
        typeof storage.estimate === "function" ? storage.estimate().catch(() => null) : null,
      ]);
      if (disposed || currentGeneration !== generation) return false;
      estimate = nextEstimate;
      state = persisted ? "protected" : "available";
      render();
      return persisted;
    } catch {
      if (disposed || currentGeneration !== generation) return false;
      state = "error";
      render();
      return false;
    }
  }

  async function requestProtection() {
    if (requesting || !supported()) return false;
    requesting = true;
    render();
    try {
      const granted = await storage.persist();
      if (disposed) return false;
      state = granted ? "protected" : "denied";
      if (typeof storage.estimate === "function") {
        estimate = await storage.estimate().catch(() => estimate);
      }
      return granted;
    } catch {
      if (!disposed) state = "error";
      return false;
    } finally {
      requesting = false;
      if (!disposed) render();
    }
  }

  const onClick = () => void requestProtection();
  const onLocaleChanged = () => render();
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "visible") void refresh();
  };
  button.addEventListener("click", onClick);
  windowRef.addEventListener("zicode:locale-changed", onLocaleChanged);
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  render();
  void refresh();

  return {
    refresh,
    requestProtection,
    dispose() {
      disposed = true;
      generation += 1;
      button.removeEventListener("click", onClick);
      windowRef.removeEventListener("zicode:locale-changed", onLocaleChanged);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
