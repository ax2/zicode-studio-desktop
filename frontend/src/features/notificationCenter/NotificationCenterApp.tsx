import { flushSync } from "react-dom";
import { useSyncExternalStore } from "react";
import type { NotificationKind } from "./notificationCenterLogic";

export interface NotificationItem {
  id: number;
  title: string;
  type: NotificationKind;
  message?: string;
  detail?: string;
  duration: number;
}

export interface NotificationStore {
  getItems(): NotificationItem[];
  subscribe(listener: () => void): () => void;
  add(item: NotificationItem): void;
  dismiss(id: number): void;
}

export function createNotificationStore(): NotificationStore {
  let items: NotificationItem[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getItems: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add(item) {
      items = [...items, item];
      emit();
    },
    dismiss(id) {
      items = items.filter((item) => item.id !== id);
      emit();
    },
  };
}

export function NotificationStackApp({ store }: { store: NotificationStore }) {
  const items = useSyncExternalStore(store.subscribe, store.getItems, store.getItems);
  if (items.length === 0) return null;
  return (
    <div
      className="native-notification-stack"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          onDismiss={() =>
            flushSync(() => {
              store.dismiss(item.id);
            })
          }
        />
      ))}
    </div>
  );
}

function NotificationCard({
  item,
  onDismiss,
}: {
  item: NotificationItem;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`native-notification native-notification--${item.type}`}
      role={item.type === "error" ? "alert" : "status"}
    >
      <div className="native-notification-content">
        <div className="native-notification-title">
          {item.title || "Notification"}
        </div>
        {item.message ? (
          <div className="native-notification-message">{item.message}</div>
        ) : null}
        {item.detail ? (
          <div className="native-notification-detail">{item.detail}</div>
        ) : null}
      </div>
      <button
        type="button"
        className="native-notification-close"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
