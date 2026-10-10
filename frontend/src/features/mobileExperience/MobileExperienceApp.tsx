import type { StoreApi, UseBoundStore } from "zustand";
import { t } from "../../shared/i18n";

export type MobileConnectionState = "offline" | "reconnecting" | "stalled" | "connected";

export interface MobileExperienceStore {
  connectionState: MobileConnectionState;
  connectionMessage: string;
  modeVisible: boolean;
  retryVisible: boolean;
  installVisible: boolean;
  installIos: boolean;
  installTitle: string;
  installHint: string;
  installButtonLabel: string;
  dismissLabel: string;
}

export type MobileExperienceStoreHook = UseBoundStore<
  StoreApi<MobileExperienceStore>
>;

export function MobileExperienceApp({
  store,
  onRetry,
  onInstall,
  onDismiss,
}: {
  store: MobileExperienceStore;
  onRetry(): void;
  onInstall(): void;
  onDismiss(): void;
}) {
  return (
    <>
      <div
        className="mobile-connection-status"
        data-state={store.connectionState}
      >
        <span className="mobile-connection-message" role="status" aria-live="polite">
          {store.connectionMessage}
        </span>
        <span
          className="mobile-connection-mode"
          hidden={!store.modeVisible}
          role="img"
          aria-label={t("Direct connection")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </span>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm mobile-connection-retry"
          hidden={!store.retryVisible}
          onClick={onRetry}
        >
          {t("Retry")}
        </button>
      </div>
      <aside
        className="mobile-install-card"
        hidden={!store.installVisible}
        aria-labelledby="mobile-install-title"
      >
        <div className="mobile-install-copy">
          <strong id="mobile-install-title">{store.installTitle}</strong>
          <span>{store.installHint}</span>
        </div>
        <div className="mobile-install-actions">
          <button type="button" className="ui-button ui-button--primary ui-button--sm" onClick={onInstall}>
            {store.installButtonLabel}
          </button>
          <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={onDismiss}>
            {store.dismissLabel}
          </button>
        </div>
      </aside>
    </>
  );
}

export function MobileExperienceBridge({
  store,
  onRetry,
  onInstall,
  onDismiss,
}: {
  store: MobileExperienceStoreHook;
  onRetry(): void;
  onInstall(): void;
  onDismiss(): void;
}) {
  const state = store((value) => value);
  return (
    <MobileExperienceApp
      store={state}
      onRetry={onRetry}
      onInstall={onInstall}
      onDismiss={onDismiss}
    />
  );
}
