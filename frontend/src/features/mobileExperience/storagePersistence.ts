import { t } from "../../shared/i18n";
import { getStoragePersistenceStore } from "../settings/storagePersistenceStore";

export interface StoragePersistenceHandle {
  refresh(): Promise<boolean>;
  requestProtection(): Promise<boolean>;
  dispose(): void;
}

export function setupMobileStoragePersistence({
  clientType,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
}: {
  clientType?: string;
  documentRef?: Document | null;
  windowRef?: Window | null;
  navigatorRef?: Navigator | null;
} = {}): StoragePersistenceHandle | null {
  const store = getStoragePersistenceStore();
  store.getState().configure({
    clientType,
    navigatorRef,
    documentRef,
    windowRef,
  });
  if (clientType !== "remote") return null;

  const row = documentRef?.getElementById?.("mobile-draft-storage-row");
  const button = documentRef?.getElementById?.(
    "protect-mobile-draft-storage",
  ) as HTMLButtonElement | null | undefined;
  const status = documentRef?.getElementById?.(
    "mobile-draft-storage-status",
  );

  function syncDom() {
    const state = store.getState();
    row?.classList.toggle("hidden", state.hidden);
    if (button) {
      button.disabled = state.buttonDisabled;
      button.setAttribute("aria-busy", String(state.requesting));
      button.textContent = t(state.buttonKey);
    }
    if (status) {
      status.dataset.state = state.state;
      status.textContent = state.statusText;
    }
  }

  const unsubscribe = store.subscribe(syncDom);
  syncDom();
  const onClick = () => void store.getState().requestProtection();
  button?.addEventListener("click", onClick);
  const onLocaleChanged = () => store.getState().compute();
  windowRef?.addEventListener("zicode:locale-changed", onLocaleChanged);
  const onVisibilityChange = () => {
    if (documentRef?.visibilityState === "visible") {
      void store.getState().refresh();
    }
  };
  documentRef?.addEventListener("visibilitychange", onVisibilityChange);
  void store.getState().refresh();

  return {
    refresh: () => store.getState().refresh(),
    requestProtection: () => store.getState().requestProtection(),
    dispose() {
      unsubscribe();
      button?.removeEventListener("click", onClick);
      windowRef?.removeEventListener("zicode:locale-changed", onLocaleChanged);
      documentRef?.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    },
  };
}
