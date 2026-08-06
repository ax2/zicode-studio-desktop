import { t } from "../../i18n.js";
import { setupMobileStartRouteTracking } from "./mobile-start-route.js";
import { createInstallPromptPolicy, setupMobileServiceWorker } from "./mobile-pwa-lifecycle.js";
import { isLoopbackHost } from "./remote-auth.js";
import { setupMobileStoragePersistence } from "./mobile-storage-persistence.js";
import { setupMobileTaskNotifications } from "./mobile-task-notifications.js";

const DEFAULT_RECONNECT_ESCALATION_MS = 8_000;

function isStandalone(windowRef) {
  return (
    windowRef.matchMedia?.("(display-mode: standalone)")?.matches ||
    windowRef.navigator?.standalone === true
  );
}

export function isIosDevice(navigatorRef = globalThis.navigator) {
  const userAgent = navigatorRef?.userAgent || "";
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigatorRef?.platform === "MacIntel" && Number(navigatorRef?.maxTouchPoints) > 1);
}

export function canUseRemotePwa(locationRef = globalThis.location) {
  return locationRef?.protocol === "https:" && !isLoopbackHost(locationRef?.hostname);
}

export function setupMobileExperience({
  adapter,
  clientType,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  storage = globalThis.localStorage,
  now = () => Date.now(),
  reconnectEscalationMs = DEFAULT_RECONNECT_ESCALATION_MS,
} = {}) {
  if (!documentRef?.body || clientType !== "remote") return null;

  const startRouteTracking = setupMobileStartRouteTracking({ documentRef, storage, windowRef });
  const taskNotifications = setupMobileTaskNotifications({
    clientType,
    documentRef,
    windowRef,
    navigatorRef,
    notificationApi: windowRef.Notification,
    storage,
  });
  const installPolicy = createInstallPromptPolicy({ storage, now });
  const storagePersistence = setupMobileStoragePersistence({
    clientType,
    documentRef,
    navigatorRef,
    windowRef,
  });
  const serviceWorker = setupMobileServiceWorker({
    enabled: canUseRemotePwa(windowRef.location),
    navigatorRef,
    now,
  });

  let connected = false;
  let installEvent = null;
  let installReturnFocus = null;
  let reconnectEscalated = false;
  let reconnectTimer = null;
  let p2pConnected = adapter?.isP2pConnected?.() ?? false;

  const connection = documentRef.createElement("div");
  connection.className = "mobile-connection-status";
  connection.hidden = true;
  const connectionMessage = documentRef.createElement("span");
  connectionMessage.className = "mobile-connection-message";
  connectionMessage.setAttribute("role", "status");
  connectionMessage.setAttribute("aria-live", "polite");
  const connectionMode = documentRef.createElement("span");
  connectionMode.className = "mobile-connection-mode";
  connectionMode.hidden = true;
  connectionMode.setAttribute("role", "img");
  connectionMode.setAttribute("aria-label", t("Direct connection"));
  const modeIcon = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  modeIcon.setAttribute("viewBox", "0 0 24 24");
  modeIcon.setAttribute("aria-hidden", "true");
  const modePath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  modePath.setAttribute("d", "M13 2 3 14h7l-1 8 10-12h-7l1-8z");
  modeIcon.append(modePath);
  connectionMode.append(modeIcon);
  const retryConnectionButton = documentRef.createElement("button");
  retryConnectionButton.type = "button";
  retryConnectionButton.className =
    "ui-button ui-button--ghost ui-button--sm mobile-connection-retry";
  retryConnectionButton.hidden = true;
  connection.append(connectionMessage, connectionMode, retryConnectionButton);

  const install = documentRef.createElement("aside");
  install.className = "mobile-install-card";
  install.hidden = true;
  install.setAttribute("aria-labelledby", "mobile-install-title");
  const installCopy = documentRef.createElement("div");
  installCopy.className = "mobile-install-copy";
  const installTitle = documentRef.createElement("strong");
  installTitle.id = "mobile-install-title";
  const installHint = documentRef.createElement("span");
  const installActions = documentRef.createElement("div");
  installActions.className = "mobile-install-actions";
  const installButton = documentRef.createElement("button");
  installButton.type = "button";
  installButton.className = "ui-button ui-button--primary ui-button--sm";
  const dismissButton = documentRef.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "ui-button ui-button--ghost ui-button--sm";
  installCopy.append(installTitle, installHint);
  installActions.append(installButton, dismissButton);
  install.append(installCopy, installActions);
  documentRef.body.append(connection, install);

  function clearReconnectTimer() {
    if (reconnectTimer === null) return;
    windowRef.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnectEscalation() {
    if (reconnectTimer !== null || reconnectEscalated || connected || !navigatorRef.onLine) return;
    reconnectTimer = windowRef.setTimeout(() => {
      reconnectTimer = null;
      if (connected || !navigatorRef.onLine) return;
      reconnectEscalated = true;
      renderConnection();
    }, reconnectEscalationMs);
  }

  function renderConnection() {
    retryConnectionButton.textContent = t("Retry");
    if (!navigatorRef.onLine) {
      clearReconnectTimer();
      connectionMode.hidden = true;
      connectionMessage.textContent = t(
        "Network unavailable. ZiCode will reconnect automatically.",
      );
      connection.dataset.state = "offline";
      retryConnectionButton.hidden = true;
      connection.hidden = false;
      return;
    }
    if (!connected) {
      connectionMode.hidden = true;
      connectionMessage.textContent = t(
        reconnectEscalated
          ? "Connecting is taking longer than expected. Check the desktop app, then try again."
          : "Reconnecting to your ZiCode desktop…",
      );
      connection.dataset.state = reconnectEscalated ? "stalled" : "reconnecting";
      retryConnectionButton.hidden = !reconnectEscalated;
      connection.hidden = false;
      scheduleReconnectEscalation();
      return;
    }
    clearReconnectTimer();
    reconnectEscalated = false;
    retryConnectionButton.hidden = true;
    connection.hidden = false;
    connection.dataset.state = "connected";
    connectionMessage.textContent = t("Connected to your ZiCode desktop");
    connectionMode.hidden = !p2pConnected;
    connectionMode.setAttribute("aria-label", t("Direct connection"));
  }

  function dismissed() {
    return installPolicy.isPostponed();
  }

  function renderInstall() {
    const ios = isIosDevice(navigatorRef);
    const eligible = !dismissed() && !isStandalone(windowRef) && (installEvent || ios);
    if (eligible && install.hidden) {
      const active = documentRef.activeElement;
      installReturnFocus =
        active && active !== documentRef.body && !install.contains(active) ? active : null;
    }
    install.hidden = !eligible;
    if (!eligible) return;
    installTitle.textContent = t("Install ZiCode on this phone");
    installHint.textContent = t(
      ios
        ? "In Safari, tap Share, then Add to Home Screen."
        : "Open ZiCode like an app and keep it one tap away.",
    );
    installButton.textContent = t(ios ? "Got it" : "Install");
    dismissButton.textContent = t("Not now");
  }

  function hideInstall({ restoreFocus = true } = {}) {
    install.hidden = true;
    if (!restoreFocus) {
      installReturnFocus = null;
      return;
    }
    const target =
      (installReturnFocus?.isConnected ? installReturnFocus : null) ||
      documentRef.querySelector(".plugin-activity-button[aria-current='page']") ||
      documentRef.querySelector("main");
    installReturnFocus = null;
    if (!target || typeof target.focus !== "function") return;
    const needsTemporaryTabIndex = !target.hasAttribute("tabindex") && target.matches?.("main");
    if (needsTemporaryTabIndex) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (needsTemporaryTabIndex) {
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    }
  }

  async function acceptInstall() {
    if (installEvent) {
      const event = installEvent;
      await event.prompt();
      const choice = await event.userChoice;
      installEvent = null;
      if (choice?.outcome === "accepted") installPolicy.clear();
      else installPolicy.postpone();
    } else {
      installPolicy.postpone();
    }
    hideInstall();
  }

  function dismissInstall() {
    installPolicy.postpone();
    hideInstall();
  }

  const recoverConnection = () => {
    reconnectEscalated = false;
    clearReconnectTimer();
    if (navigatorRef.onLine) adapter?.reconnectNow?.();
    renderConnection();
  };
  const retryConnection = () => recoverConnection();
  const onOnline = () => recoverConnection();
  const onOffline = () => renderConnection();
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "visible") {
      recoverConnection();
      void serviceWorker?.checkForUpdate();
    }
  };
  const onPageShow = (event) => {
    if (event.persisted) {
      recoverConnection();
      void serviceWorker?.checkForUpdate();
    }
  };
  const onInstallPrompt = (event) => {
    event.preventDefault();
    installEvent = event;
    renderInstall();
  };
  const onInstalled = () => {
    installEvent = null;
    installPolicy.clear();
    hideInstall();
  };
  const onLocaleChanged = () => {
    renderConnection();
    renderInstall();
  };
  const removeConnectionListener = adapter?.setConnectionListener?.((value) => {
    connected = value;
    renderConnection();
  });
  const removeP2pListener = adapter?.setP2pListener?.((value) => {
    p2pConnected = Boolean(value);
    renderConnection();
  });

  windowRef.addEventListener("online", onOnline);
  windowRef.addEventListener("offline", onOffline);
  windowRef.addEventListener("pageshow", onPageShow);
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  windowRef.addEventListener("beforeinstallprompt", onInstallPrompt);
  windowRef.addEventListener("appinstalled", onInstalled);
  windowRef.addEventListener("zicode:locale-changed", onLocaleChanged);
  installButton.addEventListener("click", acceptInstall);
  dismissButton.addEventListener("click", dismissInstall);
  retryConnectionButton.addEventListener("click", retryConnection);

  renderConnection();
  renderInstall();

  return {
    handleRuntimeEvent: taskNotifications?.handleRuntimeEvent,
    setTaskRunning: taskNotifications?.setTaskRunning,
    dispose() {
      taskNotifications?.dispose();
      storagePersistence?.dispose();
      serviceWorker?.dispose();
      startRouteTracking?.dispose();
      removeConnectionListener?.();
      removeP2pListener?.();
      windowRef.removeEventListener("online", onOnline);
      windowRef.removeEventListener("offline", onOffline);
      windowRef.removeEventListener("pageshow", onPageShow);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      windowRef.removeEventListener("beforeinstallprompt", onInstallPrompt);
      windowRef.removeEventListener("appinstalled", onInstalled);
      windowRef.removeEventListener("zicode:locale-changed", onLocaleChanged);
      clearReconnectTimer();
      connection.remove();
      install.remove();
    },
  };
}
