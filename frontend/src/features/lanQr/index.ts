import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
// @ts-expect-error plain JS module without type declarations (public/native/)
import { isLoopbackHost } from "../../../../public/native/features/remote-auth.js";
import { LanQrModalBridge } from "./LanQrModalApp";
import { expiryText, type LanQrKind } from "./lanQrLogic";

export interface LanQrControl {
  openExternal?(url: string): Promise<unknown>;
}

export interface LanQrStoreState {
  kind: LanQrKind;
  open: boolean;
  status: "loading" | "ready" | "error";
  dataUrl: string | null;
  url: string;
  caFingerprint: string | null;
  expiryText: string;
  expired: boolean;
  localeVersion: number;
}

function createLanQrStore() {
  return create<LanQrStoreState>()(() => ({
    kind: "session",
    open: false,
    status: "loading",
    dataUrl: null,
    url: "",
    caFingerprint: null,
    expiryText: "",
    expired: false,
    localeVersion: 0,
  }));
}

export function setupLanQr({
  control,
  desktopToken = "",
}: { control?: LanQrControl | null; desktopToken?: string } = {}): void {
  const modal = document.getElementById("lan-qr-modal");
  if (!modal) return;
  const activeModal = modal;
  const button = document.getElementById("lan-qr-btn");

  let expiryTimer: ReturnType<typeof setInterval> | null = null;
  let requestSequence = 0;
  let lanQrUrl = "";
  let lastFocusedElement: Element | null = null;

  const store = createLanQrStore();

  const commit = (patch: Partial<LanQrStoreState>) => {
    store.setState(patch);
    flushSync(() => {});
  };

  let root: Root | null = null;
  flushSync(() => {
    root = createRoot(activeModal);
    root.render(
        createElement(LanQrModalBridge, {
        store,
        onTabClick: (kind) => void loadLanQr(kind),
        onClose: closeLanQrModal,
        onBackdropClick: closeLanQrModal,
        onRefresh: () => void loadLanQr(store.getState().kind),
        onOpenLink: () => {
          if (!lanQrUrl) return;
          if (control?.openExternal) {
            control
              .openExternal(lanQrUrl)
              .catch((error: unknown) => {
                console.error("[LAN QR] Failed to open link externally:", error);
                globalThis.window?.open(lanQrUrl, "_blank", "noopener,noreferrer");
              });
            return;
          }
          globalThis.window?.open(lanQrUrl, "_blank", "noopener,noreferrer");
        },
      }),
    );
  });

  function clearExpiryTimer() {
    if (expiryTimer) {
      globalThis.clearInterval(expiryTimer);
      expiryTimer = null;
    }
  }

  function renderMetadata(data: { expiresAt?: number; caFingerprint?: string }) {
    const state = store.getState();
    if (state.kind === "setup") {
      commit({
        caFingerprint: data.caFingerprint ?? null,
        expiryText: "",
        expired: false,
      });
      return;
    }
    const result = expiryText(data.expiresAt);
    commit({
      expiryText: result.text,
      expired: result.expired,
      caFingerprint: null,
    });
    if (result.expired) clearExpiryTimer();
  }

  async function loadLanQr(kind: LanQrKind): Promise<void> {
    const activeKind: LanQrKind = kind === "setup" ? "setup" : "session";
    const sequence = ++requestSequence;
    clearExpiryTimer();
    commit({
      kind: activeKind,
      status: "loading",
      dataUrl: null,
      url: "",
      caFingerprint: null,
      expiryText: "",
      expired: false,
    });
    try {
      const params = new URLSearchParams({ kind: activeKind });
      if (activeKind === "session") {
        params.set("path", globalThis.location?.pathname ?? "/");
      }
      const response = await globalThis.fetch(`/v2/lan-qr?${params}`, {
        headers: { "x-zicode-desktop-token": desktopToken },
      });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      if (sequence !== requestSequence || store.getState().open === false) return;
      lanQrUrl = typeof data.url === "string" ? data.url : "";
      commit({
        status: "ready",
        dataUrl: typeof data.dataUrl === "string" ? data.dataUrl : null,
        url: lanQrUrl,
      });
      renderMetadata(data);
      if (
        activeKind === "session" &&
        Number(data.expiresAt) > 0 &&
        expiryTimer === null
      ) {
        expiryTimer = globalThis.setInterval(() => {
          renderMetadata({
            expiresAt: Number(data.expiresAt),
            caFingerprint: data.caFingerprint,
          });
        }, 1000);
      }
    } catch {
      if (sequence !== requestSequence) return;
      commit({ status: "error" });
    }
  }

  function openLanQrModal() {
    lastFocusedElement = document.activeElement;
    commit({ open: true });
    activeModal.classList.remove("hidden");
    void loadLanQr("session");
    document.getElementById("lan-qr-modal-close")?.focus();
  }

  function closeLanQrModal() {
    requestSequence += 1;
    clearExpiryTimer();
    commit({ open: false });
    activeModal.classList.add("hidden");
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  button?.addEventListener("click", openLanQrModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !activeModal.classList.contains("hidden")) {
      closeLanQrModal();
      return;
    }
    if (event.key !== "Tab" || activeModal.classList.contains("hidden")) return;
    const focusable = [...activeModal.querySelectorAll<HTMLElement>("button:not([disabled])")].filter(
      (element) => !element.closest(".hidden"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || !activeModal.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  globalThis.window?.addEventListener("zicode:locale-changed", () => {
    commit({ localeVersion: store.getState().localeVersion + 1 });
  });
}

export async function refreshLanQrButton({
  locationRef = globalThis.location,
  fetchImpl = globalThis.fetch,
  desktopToken = "",
}: {
  locationRef?: Location;
  fetchImpl?: typeof fetch;
  desktopToken?: string;
} = {}): Promise<void> {
  const button = document.getElementById("lan-qr-btn");
  const update = (url: string) => button?.classList.toggle("hidden", !url);
  if (!desktopToken || !isLoopbackHost(locationRef?.hostname)) {
    update("");
    return;
  }
  try {
    const response = await fetchImpl("/health");
    if (!response.ok) {
      update("");
      return;
    }
    const data = await response.json();
    update(typeof data?.lanUrl === "string" ? data.lanUrl : "");
  } catch {
    update("");
  }
}
