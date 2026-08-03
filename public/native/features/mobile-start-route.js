const MOBILE_START_ROUTE_KEY = "zicode-mobile-start-route";
const OPAQUE_ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const SESSION_ROUTE_PATTERN = new RegExp(
  `^/app/workspaces/${OPAQUE_ID}/sessions/${OPAQUE_ID}$`,
);

function isSecureRemoteLocation(locationRef) {
  const hostname = locationRef?.hostname;
  return (
    locationRef?.protocol === "https:" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1"
  );
}

export function rememberMobileStartRoute(
  locationRef = globalThis.location,
  storage = globalThis.localStorage,
) {
  const path = locationRef?.pathname || "";
  if (!isSecureRemoteLocation(locationRef) || !SESSION_ROUTE_PATTERN.test(path)) return false;
  try {
    storage?.setItem(MOBILE_START_ROUTE_KEY, path);
    return true;
  } catch {
    return false;
  }
}

export function restoreMobileStartRoute({
  location = globalThis.location,
  storage = globalThis.localStorage,
} = {}) {
  if (!isSecureRemoteLocation(location) || location?.pathname !== "/") return false;
  let path = "";
  try {
    path = storage?.getItem(MOBILE_START_ROUTE_KEY) || "";
  } catch {
    return false;
  }
  if (!SESSION_ROUTE_PATTERN.test(path)) return false;
  location.replace(path);
  return true;
}

export function setupMobileStartRouteTracking({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
} = {}) {
  const history = windowRef?.history;
  const location = windowRef?.location;
  if (
    !history ||
    !isSecureRemoteLocation(location) ||
    typeof history.pushState !== "function" ||
    typeof history.replaceState !== "function"
  ) {
    return null;
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  let disposed = false;

  const sync = () => {
    if (disposed) return false;
    return rememberMobileStartRoute(location, storage);
  };
  const wrapHistoryMethod = (original) =>
    function trackedHistoryMethod(...args) {
      const result = Reflect.apply(original, this, args);
      sync();
      return result;
    };

  const trackedPushState = wrapHistoryMethod(originalPushState);
  const trackedReplaceState = wrapHistoryMethod(originalReplaceState);
  history.pushState = trackedPushState;
  history.replaceState = trackedReplaceState;

  const onPopState = () => sync();
  const onPageShow = () => sync();
  const onVisibilityChange = () => {
    if (documentRef?.visibilityState === "visible") sync();
  };
  windowRef.addEventListener("popstate", onPopState);
  windowRef.addEventListener("pageshow", onPageShow);
  documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);
  sync();

  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (history.pushState === trackedPushState) history.pushState = originalPushState;
      if (history.replaceState === trackedReplaceState) {
        history.replaceState = originalReplaceState;
      }
      windowRef.removeEventListener("popstate", onPopState);
      windowRef.removeEventListener("pageshow", onPageShow);
      documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
    },
  };
}
