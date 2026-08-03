export const MOBILE_INSTALL_POSTPONED_KEY = "zicode-mobile-install-postponed-at";
export const MOBILE_INSTALL_POSTPONE_MS = 7 * 24 * 60 * 60 * 1000;
export const MOBILE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function createInstallPromptPolicy({
  storage = globalThis.localStorage,
  now = () => Date.now(),
  postponeMs = MOBILE_INSTALL_POSTPONE_MS,
} = {}) {
  function clear() {
    try {
      storage?.removeItem(MOBILE_INSTALL_POSTPONED_KEY);
      storage?.removeItem("zicode-mobile-install-dismissed");
    } catch {
      // Private browsing may reject preference writes.
    }
  }

  return {
    clear,
    isPostponed() {
      try {
        const timestamp = Number(storage?.getItem(MOBILE_INSTALL_POSTPONED_KEY));
        const current = now();
        const valid =
          Number.isFinite(timestamp) &&
          timestamp > 0 &&
          timestamp <= current + 60_000 &&
          current - timestamp < postponeMs;
        if (!valid) clear();
        return valid;
      } catch {
        return false;
      }
    },
    postpone() {
      try {
        storage?.setItem(MOBILE_INSTALL_POSTPONED_KEY, String(now()));
        storage?.removeItem("zicode-mobile-install-dismissed");
      } catch {
        // The current page can still hide the prompt when storage is unavailable.
      }
    },
  };
}

export function setupMobileServiceWorker({
  enabled,
  navigatorRef = globalThis.navigator,
  now = () => Date.now(),
  updateIntervalMs = MOBILE_WORKER_UPDATE_INTERVAL_MS,
  onError = (error) => console.warn("[Mobile] Service worker update failed:", error),
} = {}) {
  if (!enabled || !navigatorRef?.serviceWorker?.register) return null;

  let disposed = false;
  let lastUpdateCheck = now();
  const registrationPromise = navigatorRef.serviceWorker
    .register("/service-worker.js", { updateViaCache: "none" })
    .catch((error) => {
      onError(error);
      return null;
    });

  return {
    async checkForUpdate({ force = false } = {}) {
      const current = now();
      if (disposed || (!force && current - lastUpdateCheck < updateIntervalMs)) return false;
      lastUpdateCheck = current;
      const registration = await registrationPromise;
      if (disposed || typeof registration?.update !== "function") return false;
      try {
        await registration.update();
        return true;
      } catch (error) {
        onError(error);
        return false;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
