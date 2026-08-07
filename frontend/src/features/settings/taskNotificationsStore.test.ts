import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTaskNotificationsStore,
  MOBILE_TASK_NOTIFICATIONS_KEY,
} from "./taskNotificationsStore";

function fakeNotification(permission = "default") {
  let current = permission;
  return {
    get permission() {
      return current;
    },
    requestPermission: vi.fn(async () => {
      current = "granted";
      return "granted";
    }),
  };
}

describe("task notifications store", () => {
  beforeEach(() => {
    localStorage.clear();
    getTaskNotificationsStore().setState({
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
    });
  });

  it("requests permission only after the remote user enables the setting", async () => {
    const notificationApi = fakeNotification();
    const store = getTaskNotificationsStore();
    store.getState().configure({
      clientType: "remote",
      notificationApi,
      navigatorRef: { serviceWorker: {} },
      storage: localStorage,
    });

    expect(store.getState().hidden).toBe(false);
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();

    await store.getState().setEnabled(true);

    expect(notificationApi.requestPermission).toHaveBeenCalledOnce();
    expect(store.getState().enabled).toBe(true);
    expect(localStorage.getItem(MOBILE_TASK_NOTIFICATIONS_KEY)).toBe("1");
  });

  it("keeps the mobile-only setting hidden for the desktop client", () => {
    const store = getTaskNotificationsStore();
    store.getState().configure({ clientType: "desktop" });
    expect(store.getState().hidden).toBe(true);
    expect(store.getState().statusKey).toBe("");
  });
});
