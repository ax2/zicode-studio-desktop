import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../../shared/i18n";
import {
  createNotificationStore,
  type NotificationItem,
  NotificationStackApp,
} from "./NotificationCenterApp";
import {
  type NotificationInput,
  normalizeNotification,
} from "./notificationCenterLogic";

export const DEFAULT_DURATION_MS = 8000;

export interface NotificationCenter {
  notify(
    input: string | NotificationInput,
  ): { element: HTMLElement; dismiss: () => void };
}

export function createNotificationCenter({
  root = document.body,
  duration = DEFAULT_DURATION_MS,
}: {
  root?: HTMLElement;
  duration?: number;
} = {}): NotificationCenter {
  const wrapper = document.createElement("div");
  wrapper.dataset.notificationCenterRoot = "";
  root.appendChild(wrapper);

  const store = createNotificationStore();
  const reactRoot: Root = createRoot(wrapper);
  flushSync(() => {
    reactRoot.render(createElement(NotificationStackApp, { store }));
  });

  let nextId = 1;

  function notify(input: string | NotificationInput) {
    const notification = normalizeNotification(input);
    const item: NotificationItem = {
      id: nextId++,
      title: notification.title || t("Notification"),
      type: notification.type || "info",
      message: notification.message,
      detail: notification.detail,
      duration: notification.duration ?? duration,
      action: notification.action,
    };

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const dismiss = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      flushSync(() => {
        store.dismiss(item.id);
      });
    };

    flushSync(() => {
      store.add(item);
    });

    if (item.duration > 0) {
      timeoutId = setTimeout(dismiss, item.duration);
    }

    const stack = wrapper.querySelector(".native-notification-stack");
    const element = stack?.lastElementChild;
    return {
      element: element as HTMLElement,
      dismiss,
    };
  }

  return { notify };
}
