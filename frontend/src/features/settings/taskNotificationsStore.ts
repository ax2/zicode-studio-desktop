import { create } from "zustand";

export const MOBILE_TASK_NOTIFICATIONS_KEY = "zicode-mobile-task-notifications";
const GLOBAL_STORE_KEY = "__zicode_task_notifications_store__";

export interface TaskNotificationsEnvironment {
  notificationApi?: {
    permission?: string;
    requestPermission?: () => Promise<string>;
  } | null;
  navigatorRef?: { serviceWorker?: { ready?: Promise<unknown> } };
  storage?: Storage | null;
  documentRef?: Document | null;
  windowRef?: Window | null;
  onError?: (error: unknown) => void;
}

export interface TaskNotificationsState extends TaskNotificationsEnvironment {
  hidden: boolean;
  enabled: boolean;
  requesting: boolean;
  supported: boolean;
  permission: string;
  statusKey: string;
  configure(
    env: TaskNotificationsEnvironment & { clientType?: string },
  ): void;
  refresh(): void;
  setEnabled(nextEnabled: boolean): Promise<boolean>;
}

type GlobalWithStore = typeof globalThis & {
  [GLOBAL_STORE_KEY]?: ReturnType<typeof createTaskNotificationsStore>;
};

function writeEnabled(storage: Storage | null | undefined, enabled: boolean) {
  try {
    if (enabled) storage?.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    else storage?.removeItem(MOBILE_TASK_NOTIFICATIONS_KEY);
  } catch {
    // Private browsing can reject preference writes.
  }
}

function readEnabled(storage: Storage | null | undefined): boolean {
  try {
    return storage?.getItem(MOBILE_TASK_NOTIFICATIONS_KEY) === "1";
  } catch {
    return false;
  }
}

function statusKeyFor(
  permission: string,
  supported: boolean,
  enabled: boolean,
): string {
  if (permission === "denied") {
    return "Task alerts are blocked in this browser. Allow notifications in site settings to enable them.";
  }
  if (!supported) {
    return "System notifications are not available here. On iPhone or iPad, add ZiCode to the Home Screen first.";
  }
  if (enabled) {
    return "ZiCode will show a private alert when a tracked Pi task finishes in the background.";
  }
  return "Enable this to receive a private alert when Pi finishes while your phone is locked or another app is open.";
}

function createTaskNotificationsStore() {
  return create<TaskNotificationsState>()((set, get) => ({
    hidden: true,
    enabled: false,
    requesting: false,
    supported: false,
    permission: "unsupported",
    statusKey: "",
    notificationApi: null,
    navigatorRef: undefined,
    storage: undefined,
    documentRef: undefined,
    windowRef: undefined,
    onError: undefined,
    configure({
      clientType,
      notificationApi,
      navigatorRef,
      storage,
      documentRef,
      windowRef,
      onError,
    }) {
      set({
        notificationApi,
        navigatorRef,
        storage,
        documentRef,
        windowRef,
        onError,
      });
      if (clientType !== "remote") {
        set({
          hidden: true,
          enabled: false,
          requesting: false,
          supported: false,
          permission: "unsupported",
          statusKey: "",
        });
        return;
      }
      set({ hidden: false, enabled: readEnabled(storage) });
      get().refresh();
    },
    refresh() {
      const state = get();
      const permission = state.notificationApi?.permission || "unsupported";
      const supported =
        typeof state.notificationApi?.requestPermission === "function" &&
        (Boolean(state.navigatorRef?.serviceWorker) ||
          typeof state.notificationApi === "function");
      set({
        permission,
        supported,
        statusKey: statusKeyFor(permission, supported, state.enabled),
      });
    },
    async setEnabled(nextEnabled) {
      const state = get();
      if (state.requesting) return false;
      const storage = state.storage;
      if (!nextEnabled) {
        set({ enabled: false });
        writeEnabled(storage, false);
        get().refresh();
        return true;
      }
      if (!state.supported || state.permission === "denied") {
        get().refresh();
        return false;
      }
      set({ requesting: true });
      try {
        const notificationApi = state.notificationApi;
        const result =
          state.permission === "granted"
            ? "granted"
            : await notificationApi?.requestPermission?.();
        const enabled = result === "granted";
        set({ enabled, requesting: false });
        writeEnabled(storage, enabled);
        get().refresh();
        return enabled;
      } catch (error) {
        set({ enabled: false, requesting: false });
        writeEnabled(storage, false);
        state.onError?.(error);
        get().refresh();
        return false;
      }
    },
  }));
}

export function getTaskNotificationsStore() {
  const globalStore = globalThis as GlobalWithStore;
  if (!globalStore[GLOBAL_STORE_KEY]) {
    globalStore[GLOBAL_STORE_KEY] = createTaskNotificationsStore();
  }
  return globalStore[GLOBAL_STORE_KEY] as ReturnType<
    typeof createTaskNotificationsStore
  >;
}

export function useTaskNotificationsState(): TaskNotificationsState {
  return getTaskNotificationsStore()();
}
