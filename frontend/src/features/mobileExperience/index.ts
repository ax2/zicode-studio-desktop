import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { create } from "zustand";
import { t } from "../../shared/i18n";
import {
  MobileExperienceBridge,
  type MobileExperienceStore,
} from "./MobileExperienceApp";
import {
  canUseRemotePwa,
  isIosDevice,
  isStandalone,
} from "./mobileExperienceLogic";
// @ts-expect-error plain JS modules without type declarations (public/native/)
import { setupMobileStartRouteTracking } from "../../../../public/native/features/mobile-start-route.js";
// @ts-expect-error plain JS module without type declarations (public/native/)
import { createInstallPromptPolicy, setupMobileServiceWorker } from "../../../../public/native/features/mobile-pwa-lifecycle.js";
// @ts-expect-error plain JS module without type declarations (public/native/)
import { setupMobileStoragePersistence } from "../../../../public/native/features/mobile-storage-persistence.js";
// @ts-expect-error plain JS module without type declarations (public/native/)
import { setupMobileTaskNotifications } from "../../../../public/native/features/mobile-task-notifications.js";

const DEFAULT_RECONNECT_ESCALATION_MS = 8_000;

export { isIosDevice, canUseRemotePwa } from "./mobileExperienceLogic";

export interface MobileExperienceOptions {
  adapter?: {
    isP2pConnected?(): boolean;
    reconnectNow?(): void;
    setConnectionListener?(listener: (value: boolean) => void): () => void;
    setP2pListener?(listener: (value: boolean) => void): () => void;
  };
  clientType?: string;
  documentRef?: Document;
  windowRef?: Window;
  navigatorRef?: Navigator;
  storage?: Storage;
  now?: () => number;
  reconnectEscalationMs?: number;
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
}: MobileExperienceOptions = {}): {
  handleRuntimeEvent?: (
    event: unknown,
    target: unknown,
    sequence?: unknown,
  ) => unknown;
  setTaskRunning?: (target: unknown, running: boolean) => void;
  dispose(): void;
} | null {
  if (!documentRef?.body || clientType !== "remote") return null;

  const startRouteTracking = setupMobileStartRouteTracking({
    documentRef,
    storage,
    windowRef,
  });
  const taskNotifications = setupMobileTaskNotifications({
    clientType,
    documentRef,
    windowRef,
    navigatorRef,
    notificationApi: (windowRef as unknown as { Notification: unknown }).Notification,
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
  let installEvent: { prompt(): Promise<unknown>; userChoice: Promise<{ outcome: string }> } | null =
    null;
  let installReturnFocus: Element | null = null;
  let reconnectEscalated = false;
  let reconnectTimer: number | null = null;
  let p2pConnected = adapter?.isP2pConnected?.() ?? false;

  const store = create<MobileExperienceStore>()(() => ({
    connectionState: "reconnecting",
    connectionMessage: "",
    modeVisible: false,
    retryVisible: false,
    installVisible: false,
    installIos: false,
    installTitle: "",
    installHint: "",
    installButtonLabel: "",
    dismissLabel: "",
  }));

  const commit = (patch: Partial<MobileExperienceStore>) => {
    store.setState(patch);
    flushSync(() => {});
  };

  const host = documentRef.createElement("div");
  host.dataset.mobileExperienceRoot = "";
  documentRef.body.append(host);
  let root: Root | null = null;
  flushSync(() => {
    root = createRoot(host);
    root.render(
        createElement(MobileExperienceBridge, {
        store,
        onRetry: recoverConnection,
        onInstall: () => void acceptInstall(),
        onDismiss: dismissInstall,
      }),
    );
  });

  function clearReconnectTimer() {
    if (reconnectTimer === null) return;
    globalThis.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnectEscalation() {
    if (reconnectTimer !== null || reconnectEscalated || connected || !navigatorRef.onLine) return;
    reconnectTimer = globalThis.setTimeout(() => {
      reconnectTimer = null;
      if (connected || !navigatorRef.onLine) return;
      reconnectEscalated = true;
      renderConnection();
    }, reconnectEscalationMs) as unknown as number;
  }

  function renderConnection() {
    if (!navigatorRef.onLine) {
      clearReconnectTimer();
      commit({
        connectionState: "offline",
        modeVisible: false,
        retryVisible: false,
        connectionMessage: t("Network unavailable. ZiCode will reconnect automatically."),
      });
      return;
    }
    if (!connected) {
      commit({
        connectionState: reconnectEscalated ? "stalled" : "reconnecting",
        modeVisible: false,
        retryVisible: reconnectEscalated,
        connectionMessage: t(
          reconnectEscalated
            ? "Connecting is taking longer than expected. Check the desktop app, then try again."
            : "Reconnecting to your ZiCode desktop…",
        ),
      });
      scheduleReconnectEscalation();
      return;
    }
    clearReconnectTimer();
    reconnectEscalated = false;
    commit({
      connectionState: "connected",
      retryVisible: false,
      modeVisible: p2pConnected,
      connectionMessage: t("Connected to your ZiCode desktop"),
    });
  }

  function dismissed() {
    return installPolicy.isPostponed();
  }

  function installCardElement() {
    return documentRef.querySelector<HTMLElement>(".mobile-install-card");
  }

  function renderInstall() {
    const ios = isIosDevice(navigatorRef);
    const eligible = !dismissed() && !isStandalone(windowRef) && (installEvent || ios);
    if (eligible && !store.getState().installVisible) {
      const active = documentRef.activeElement;
      const card = installCardElement();
      installReturnFocus =
        active && active !== documentRef.body && !card?.contains(active) ? active : null;
    }
    if (!eligible) {
      commit({ installVisible: false });
      return;
    }
    commit({
      installVisible: true,
      installIos: ios,
      installTitle: t("Install ZiCode on this phone"),
      installHint: t(
        ios
          ? "In Safari, tap Share, then Add to Home Screen."
          : "Open ZiCode like an app and keep it one tap away.",
      ),
      installButtonLabel: t(ios ? "Got it" : "Install"),
      dismissLabel: t("Not now"),
    });
  }

  function hideInstall({ restoreFocus = true } = {}) {
    commit({ installVisible: false });
    if (!restoreFocus) {
      installReturnFocus = null;
      return;
    }
    const target =
      (installReturnFocus?.isConnected ? installReturnFocus : null) ||
      documentRef.querySelector(".plugin-activity-button[aria-current='page']") ||
      documentRef.querySelector("main");
    installReturnFocus = null;
    if (!target || typeof (target as HTMLElement).focus !== "function") return;
    const element = target as HTMLElement;
    const needsTemporaryTabIndex = !element.hasAttribute("tabindex") && element.matches?.("main");
    if (needsTemporaryTabIndex) element.tabIndex = -1;
    element.focus({ preventScroll: true });
    if (needsTemporaryTabIndex) {
      element.addEventListener("blur", () => element.removeAttribute("tabindex"), {
        once: true,
      });
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

  function recoverConnection() {
    reconnectEscalated = false;
    clearReconnectTimer();
    if (navigatorRef.onLine) adapter?.reconnectNow?.();
    renderConnection();
  }

  const onOnline = () => recoverConnection();
  const onOffline = () => renderConnection();
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "visible") {
      recoverConnection();
      void serviceWorker?.checkForUpdate();
    }
  };
  const onPageShow = (event: Event) => {
    if ((event as Event & { persisted?: boolean }).persisted) {
      recoverConnection();
      void serviceWorker?.checkForUpdate();
    }
  };
  const onInstallPrompt = (event: Event) => {
    event.preventDefault();
    installEvent = event as unknown as typeof installEvent;
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
      root?.unmount();
      host.remove();
    },
  };
}
