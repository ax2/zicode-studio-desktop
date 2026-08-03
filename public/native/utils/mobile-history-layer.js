export const MOBILE_HISTORY_LAYER_KEY = "zicodeMobileLayer";

function stateObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function currentUrl(windowRef) {
  const { pathname = "", search = "", hash = "" } = windowRef.location || {};
  return `${pathname}${search}${hash}` || "/";
}

export function setupMobileHistoryLayer({
  id,
  isActive,
  onBack,
  windowRef = globalThis.window,
} = {}) {
  if (!id || !windowRef?.history || typeof isActive !== "function" || typeof onBack !== "function") {
    return null;
  }

  const layerInState = (state = windowRef.history.state) => state?.[MOBILE_HISTORY_LAYER_KEY];

  function enter() {
    if (layerInState() === id) return false;
    windowRef.history.pushState(
      { ...stateObject(windowRef.history.state), [MOBILE_HISTORY_LAYER_KEY]: id },
      "",
      currentUrl(windowRef),
    );
    return true;
  }

  function leave({ replace = false } = {}) {
    if (layerInState() !== id) return false;
    if (!replace) {
      windowRef.history.back();
      return true;
    }
    const nextState = stateObject(windowRef.history.state);
    delete nextState[MOBILE_HISTORY_LAYER_KEY];
    windowRef.history.replaceState(
      Object.keys(nextState).length > 0 ? nextState : null,
      "",
      currentUrl(windowRef),
    );
    return true;
  }

  const handlePopState = (event) => {
    if (isActive() && layerInState(event.state) !== id) onBack();
  };
  windowRef.addEventListener("popstate", handlePopState);

  return {
    enter,
    leave,
    dispose() {
      windowRef.removeEventListener("popstate", handlePopState);
      leave({ replace: true });
    },
  };
}
