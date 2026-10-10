import { useState } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
// @ts-expect-error plain JS module without type declarations
import { copyText } from "../../../../public/ui/copy.js";
import { t } from "../../shared/i18n";
import {
  fingerprintLines,
  hintKey,
  imageAltKey,
  type LanQrKind,
} from "./lanQrLogic";

export interface LanQrStore {
  kind: LanQrKind;
  open: boolean;
  status: "loading" | "ready" | "error";
  dataUrl: string | null;
  url: string;
  caFingerprint: string | null;
  expiryText: string;
  expired: boolean;
}

export type LanQrStoreHook = UseBoundStore<StoreApi<LanQrStore>>;

export function LanQrModalApp({
  store,
  onTabClick,
  onClose,
  onBackdropClick,
  onRefresh,
  onOpenLink,
}: {
  store: LanQrStore;
  onTabClick(kind: LanQrKind): void;
  onClose(): void;
  onBackdropClick(): void;
  onRefresh(): void;
  onOpenLink(): void;
}) {
  const kind = store.kind;
  const [copied, setCopied] = useState(false);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop click-catcher closes the dialog (vanilla behavior) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes on click only; Escape is handled on the document */}
      <div className="lan-qr-modal-backdrop" id="lan-qr-modal-backdrop" onClick={onBackdropClick}></div>
      <div className="lan-qr-modal-content">
        <div className="lan-qr-modal-header">
          <span className="lan-qr-modal-title">{t("Open on Mobile")}</span>
          <button
            type="button"
            className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost lan-qr-modal-close icon-btn"
            id="lan-qr-modal-close"
            aria-label={t("Close")}
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="lan-qr-modal-body">
          <div className="lan-qr-tabs" role="tablist" aria-label={t("Mobile connection step")}>
            <button
              type="button"
              className={`lan-qr-tab${kind === "session" ? " active" : ""}`}
              id="lan-qr-tab-session"
              role="tab"
              aria-selected={kind === "session"}
              data-lan-qr-kind="session"
              onClick={() => onTabClick("session")}
            >
              {t("Open this chat")}
            </button>
            <button
              type="button"
              className={`lan-qr-tab${kind === "setup" ? " active" : ""}`}
              id="lan-qr-tab-setup"
              role="tab"
              aria-selected={kind === "setup"}
              data-lan-qr-kind="setup"
              onClick={() => onTabClick("setup")}
            >
              {t("First-time setup")}
            </button>
          </div>
          {store.status === "loading" ? (
            <div className="lan-qr-loading" id="lan-qr-loading">
              {t("Generating QR code…")}
            </div>
          ) : store.status === "error" ? (
            <div className="lan-qr-loading" id="lan-qr-loading">
              {t("QR code unavailable")}
            </div>
          ) : null}
          <img
            className={`lan-qr-image${store.dataUrl ? "" : " hidden"}`}
            id="lan-qr-image"
            src={store.dataUrl ?? undefined}
            alt={t(imageAltKey(kind))}
          />
          <div className="lan-qr-hint" id="lan-qr-hint">
            {t(hintKey(kind))}
          </div>
          <code className={`lan-qr-address${store.url ? "" : " hidden"}`} id="lan-qr-address">
            {store.url}
          </code>
          <button
            type="button"
            className={`ui-button ui-button--secondary ui-button--sm lan-qr-copy${
              store.url ? "" : " hidden"
            }`}
            id="lan-qr-copy"
            onClick={() => {
              void copyText(store.url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? t("Copied") : t("Copy link")}
          </button>
          <div
            className={`lan-qr-meta${store.expiryText ? "" : " hidden"}${
              kind === "setup" ? " is-fingerprint" : ""
            }`}
            id="lan-qr-meta"
          >
            {kind === "setup" ? (
              <>
                <span>{`${t("CA fingerprint")}:`}</span>
                <code className="lan-qr-fingerprint">
                  {fingerprintLines(store.caFingerprint).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </code>
              </>
            ) : (
              store.expiryText
            )}
          </div>
          <button
            type="button"
            className={`ui-button ui-button--secondary ui-button--sm lan-qr-refresh${
              store.expired ? "" : " hidden"
            }`}
            id="lan-qr-refresh"
            onClick={onRefresh}
          >
            {t("Refresh QR code")}
          </button>
          <button
            type="button"
            className={`ui-button ui-button--primary ui-button--sm lan-qr-open-link${
              store.url ? "" : " hidden"
            }`}
            id="lan-qr-open-link"
            onClick={onOpenLink}
          >
            {t("Open link")}
          </button>
        </div>
      </div>
    </>
  );
}

export function LanQrModalBridge({
  store,
  onTabClick,
  onClose,
  onBackdropClick,
  onRefresh,
  onOpenLink,
}: {
  store: LanQrStoreHook;
  onTabClick(kind: LanQrKind): void;
  onClose(): void;
  onBackdropClick(): void;
  onRefresh(): void;
  onOpenLink(): void;
}) {
  const state = store((value) => value);
  return (
    <LanQrModalApp
      store={state}
      onTabClick={onTabClick}
      onClose={onClose}
      onBackdropClick={onBackdropClick}
      onRefresh={onRefresh}
      onOpenLink={onOpenLink}
    />
  );
}
