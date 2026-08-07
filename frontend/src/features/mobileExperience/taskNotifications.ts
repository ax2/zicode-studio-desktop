import { t } from "../../shared/i18n";
import {
  getTaskNotificationsStore,
  MOBILE_TASK_NOTIFICATIONS_KEY,
} from "../settings/taskNotificationsStore";

const TASK_NOTIFICATION_TAG = "zicode-task-complete";

export { MOBILE_TASK_NOTIFICATIONS_KEY };

export interface TaskTarget {
  sessionId?: string;
  instanceId?: string;
}

export interface MobileTaskNotificationsHandle {
  handleRuntimeEvent(
    event: unknown,
    target: unknown,
    sequence?: unknown,
  ): void;
  isEnabled(): boolean;
  setEnabled(nextEnabled: boolean): Promise<boolean>;
  setTaskRunning(target: unknown, running: boolean): void;
  dispose(): void;
}

export function setupMobileTaskNotifications({
  clientType,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  notificationApi = (
    windowRef as unknown as {
      Notification?: {
        permission?: string;
        requestPermission?: () => Promise<string>;
      };
    }
  ).Notification,
  storage = globalThis.localStorage,
  onError = (error: unknown) =>
    console.warn("[Mobile] Task notification failed:", error),
}: {
  clientType?: string;
  documentRef?: Document | null;
  windowRef?: Window | null;
  navigatorRef?: Navigator | null;
  notificationApi?: {
    permission?: string;
    requestPermission?: () => Promise<string>;
  } | null;
  storage?: Storage | null;
  onError?: (error: unknown) => void;
} = {}): MobileTaskNotificationsHandle | null {
  const store = getTaskNotificationsStore();
  if (clientType !== "remote") {
    store.getState().configure({ clientType });
    return null;
  }
  store.getState().configure({
    clientType,
    notificationApi,
    navigatorRef: navigatorRef as TaskNotificationsNavigator,
    storage,
    documentRef,
    windowRef,
    onError,
  });

  const section = documentRef?.getElementById?.(
    "mobile-task-notification-section",
  );
  const toggle = documentRef?.getElementById?.(
    "toggle-mobile-task-notifications",
  ) as HTMLButtonElement | null | undefined;
  const status = documentRef?.getElementById?.(
    "mobile-task-notification-status",
  );

  function syncDom() {
    const state = store.getState();
    section?.classList.toggle("hidden", state.hidden);
    if (toggle) {
      toggle.classList.toggle("on", state.enabled);
      toggle.setAttribute("aria-checked", String(state.enabled));
      toggle.disabled =
        state.requesting || !state.supported || state.permission === "denied";
      toggle.setAttribute("aria-busy", String(state.requesting));
    }
    if (status) {
      status.dataset.state =
        state.permission === "denied"
          ? "blocked"
          : !state.supported
            ? "unsupported"
            : state.enabled
              ? "enabled"
              : "disabled";
      status.textContent = t(state.statusKey);
    }
  }

  const unsubscribe = store.subscribe(syncDom);
  syncDom();
  const onToggle = () =>
    void store.getState().setEnabled(!store.getState().enabled);
  toggle?.addEventListener("click", onToggle);
  const onLocaleChanged = () => store.getState().refresh();
  windowRef?.addEventListener("zicode:locale-changed", onLocaleChanged);

  const activeTasks = new Set<string>();
  const lastSequences = new Map<string, number>();

  function taskKey(target: unknown) {
    const value = (target ?? {}) as TaskTarget;
    return value.instanceId || value.sessionId || "";
  }

  function isEnabled() {
    const state = store.getState();
    return state.enabled && state.permission === "granted";
  }

  function notificationPath() {
    const pathname = windowRef?.location?.pathname || "/";
    const hash = windowRef?.location?.hash || "";
    return `${pathname}${hash}`;
  }

  async function showCompletionNotification() {
    const state = store.getState();
    if (!isEnabled() || documentRef?.visibilityState !== "hidden") {
      return false;
    }
    const title = t("Pi task finished");
    const options = {
      body: t("Open ZiCode to review the result."),
      tag: TASK_NOTIFICATION_TAG,
      renotify: false,
      icon: "/icons/app-192.png",
      data: { path: notificationPath() },
    };
    try {
      const registration = await navigatorRef?.serviceWorker?.ready;
      if (!isEnabled() || documentRef?.visibilityState !== "hidden") {
        return false;
      }
      const worker = registration as
        | { showNotification?: (title: string, options: unknown) => Promise<unknown> }
        | undefined;
      if (typeof worker?.showNotification === "function") {
        await worker.showNotification(title, options);
        return true;
      }
      const api = state.notificationApi as unknown as
        | { new (title: string, options: unknown): unknown }
        | undefined;
      if (typeof api === "function") {
        new api(title, options);
        return true;
      }
    } catch (error) {
      onError(error);
    }
    return false;
  }

  function setTaskRunning(target: unknown, running: boolean) {
    const key = taskKey(target);
    if (!key) return;
    if (running) {
      activeTasks.add(key);
      return;
    }
    if (!activeTasks.delete(key)) return;
    void showCompletionNotification();
  }

  function handleRuntimeEvent(
    event: unknown,
    target: unknown,
    sequence?: unknown,
  ) {
    const key = taskKey(target);
    const type = (event as { type?: string } | null | undefined)?.type;
    const seq = typeof sequence === "number" ? sequence : undefined;
    if (key && typeof seq === "number" && Number.isFinite(seq)) {
      const previousSequence = lastSequences.get(key) ?? 0;
      if (seq <= previousSequence) return;
      lastSequences.set(key, seq);
    }
    if (type === "agent_start") setTaskRunning(target, true);
    else if (
      type === "agent_settled" ||
      type === "agent_end"
    ) {
      setTaskRunning(target, false);
    }
  }

  return {
    handleRuntimeEvent,
    isEnabled,
    setEnabled: (nextEnabled: boolean) =>
      store.getState().setEnabled(nextEnabled),
    setTaskRunning,
    dispose() {
      unsubscribe();
      toggle?.removeEventListener("click", onToggle);
      windowRef?.removeEventListener(
        "zicode:locale-changed",
        onLocaleChanged,
      );
      activeTasks.clear();
      lastSequences.clear();
    },
  };
}

type TaskNotificationsNavigator = {
  serviceWorker?: { ready?: Promise<unknown> };
};
