import { t } from "../../i18n.js";

export const MOBILE_TASK_NOTIFICATIONS_KEY = "zicode-mobile-task-notifications";
const TASK_NOTIFICATION_TAG = "zicode-task-complete";

function taskKey(target = {}) {
  return target.instanceId || target.sessionId || "";
}

function readEnabled(storage) {
  try {
    return storage?.getItem(MOBILE_TASK_NOTIFICATIONS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(storage, enabled) {
  try {
    if (enabled) storage?.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    else storage?.removeItem(MOBILE_TASK_NOTIFICATIONS_KEY);
  } catch {
    // Private browsing can reject preference writes. Permission still applies for this page.
  }
}

function notificationPath(locationRef) {
  const pathname = locationRef?.pathname || "/";
  const hash = locationRef?.hash || "";
  return `${pathname}${hash}`;
}

export function setupMobileTaskNotifications({
  clientType,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  notificationApi = windowRef?.Notification,
  storage = globalThis.localStorage,
  onError = (error) => console.warn("[Mobile] Task notification failed:", error),
} = {}) {
  const section = documentRef?.getElementById?.("mobile-task-notification-section");
  const toggle = documentRef?.getElementById?.("toggle-mobile-task-notifications");
  const status = documentRef?.getElementById?.("mobile-task-notification-status");
  if (clientType !== "remote") {
    section?.classList.add("hidden");
    return null;
  }

  section?.classList.remove("hidden");
  const activeTasks = new Set();
  const lastSequences = new Map();
  let enabled = readEnabled(storage);
  let requesting = false;

  const permission = () => notificationApi?.permission || "unsupported";
  const supported = () =>
    typeof notificationApi?.requestPermission === "function" &&
    (Boolean(navigatorRef?.serviceWorker) || typeof notificationApi === "function");
  const isEnabled = () => enabled && permission() === "granted";

  function render() {
    if (!toggle || !status) return;
    const currentPermission = permission();
    const active = isEnabled();
    toggle.classList.toggle("on", active);
    toggle.setAttribute("aria-checked", String(active));
    toggle.disabled = requesting || !supported() || currentPermission === "denied";
    toggle.setAttribute("aria-busy", String(requesting));
    status.dataset.state =
      currentPermission === "denied"
        ? "blocked"
        : !supported()
          ? "unsupported"
          : active
            ? "enabled"
            : "disabled";
    status.textContent = t(
      currentPermission === "denied"
        ? "Task alerts are blocked in this browser. Allow notifications in site settings to enable them."
        : !supported()
          ? "System notifications are not available here. On iPhone or iPad, add ZiCode to the Home Screen first."
          : active
            ? "ZiCode will show a private alert when a tracked Pi task finishes in the background."
            : "Enable this to receive a private alert when Pi finishes while your phone is locked or another app is open.",
    );
  }

  async function setEnabled(nextEnabled) {
    if (requesting) return false;
    if (!nextEnabled) {
      enabled = false;
      writeEnabled(storage, false);
      render();
      return true;
    }
    if (!supported() || permission() === "denied") {
      render();
      return false;
    }
    requesting = true;
    render();
    try {
      const result =
        permission() === "granted"
          ? "granted"
          : await notificationApi.requestPermission();
      enabled = result === "granted";
      writeEnabled(storage, enabled);
      return enabled;
    } catch (error) {
      enabled = false;
      writeEnabled(storage, false);
      onError(error);
      return false;
    } finally {
      requesting = false;
      render();
    }
  }

  async function showCompletionNotification() {
    if (!isEnabled() || documentRef.visibilityState !== "hidden") return false;
    const title = t("Pi task finished");
    const options = {
      body: t("Open ZiCode to review the result."),
      tag: TASK_NOTIFICATION_TAG,
      renotify: false,
      icon: "/icons/app-192.png",
      data: { path: notificationPath(windowRef.location) },
    };
    try {
      const registration = await navigatorRef?.serviceWorker?.ready;
      if (!isEnabled() || documentRef.visibilityState !== "hidden") return false;
      if (typeof registration?.showNotification === "function") {
        await registration.showNotification(title, options);
        return true;
      }
      if (typeof notificationApi === "function") {
        new notificationApi(title, options);
        return true;
      }
    } catch (error) {
      onError(error);
    }
    return false;
  }

  function setTaskRunning(target, running) {
    const key = taskKey(target);
    if (!key) return;
    if (running) {
      activeTasks.add(key);
      return;
    }
    if (!activeTasks.delete(key)) return;
    void showCompletionNotification();
  }

  function handleRuntimeEvent(event, target, sequence) {
    const key = taskKey(target);
    if (key && Number.isFinite(sequence)) {
      const previousSequence = lastSequences.get(key) ?? 0;
      if (sequence <= previousSequence) return;
      lastSequences.set(key, sequence);
    }
    if (event?.type === "agent_start") setTaskRunning(target, true);
    else if (event?.type === "agent_settled" || event?.type === "agent_end") {
      setTaskRunning(target, false);
    }
  }

  const onToggle = () => void setEnabled(!isEnabled());
  const onLocaleChanged = () => render();
  toggle?.addEventListener("click", onToggle);
  windowRef.addEventListener("zicode:locale-changed", onLocaleChanged);
  render();

  return {
    handleRuntimeEvent,
    isEnabled,
    setEnabled,
    setTaskRunning,
    dispose() {
      toggle?.removeEventListener("click", onToggle);
      windowRef.removeEventListener("zicode:locale-changed", onLocaleChanged);
      activeTasks.clear();
      lastSequences.clear();
    },
  };
}
