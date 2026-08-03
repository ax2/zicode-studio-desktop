import { t } from "../../i18n.js";
import { isLoopbackHost } from "./remote-auth.js";

let activeKind = "session";
let expiryTimer = null;
let lanQrUrl = "";
let latestData = null;
let lastFocusedElement = null;
let requestSequence = 0;

const lanQrBtn = document.getElementById("lan-qr-btn");
const lanQrModal = document.getElementById("lan-qr-modal");
const lanQrModalBackdrop = document.getElementById("lan-qr-modal-backdrop");
const lanQrModalClose = document.getElementById("lan-qr-modal-close");
const lanQrLoading = document.getElementById("lan-qr-loading");
const lanQrImage = document.getElementById("lan-qr-image");
const lanQrHint = document.getElementById("lan-qr-hint");
const lanQrAddress = document.getElementById("lan-qr-address");
const lanQrMeta = document.getElementById("lan-qr-meta");
const lanQrRefresh = document.getElementById("lan-qr-refresh");
const lanQrOpenLink = document.getElementById("lan-qr-open-link");
const lanQrTabs = [...document.querySelectorAll("[data-lan-qr-kind]")];

function updateLanQrButton(url = "") {
  if (!lanQrBtn) return;
  lanQrBtn.classList.toggle("hidden", !url);
}

function clearExpiryTimer() {
  if (!expiryTimer) return;
  globalThis.clearInterval(expiryTimer);
  expiryTimer = null;
}

function updateTabs() {
  for (const tab of lanQrTabs) {
    const selected = tab.dataset.lanQrKind === activeKind;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function resetQrState() {
  clearExpiryTimer();
  latestData = null;
  lanQrUrl = "";
  lanQrLoading?.classList.remove("hidden");
  if (lanQrLoading) lanQrLoading.textContent = t("Generating QR code…");
  lanQrImage?.classList.add("hidden");
  lanQrAddress?.classList.add("hidden");
  lanQrMeta?.classList.add("hidden");
  lanQrMeta?.classList.remove("is-fingerprint");
  lanQrMeta?.replaceChildren();
  lanQrRefresh?.classList.add("hidden");
  lanQrOpenLink?.classList.add("hidden");
}

function renderHint() {
  if (!lanQrHint) return;
  lanQrHint.textContent = t(
    activeKind === "setup"
      ? "First-time phone: scan to install and trust the local certificate."
      : "Already trusted this computer? Scan to pair and open the current chat.",
  );
}

function renderMetadata() {
  if (!latestData || !lanQrMeta) return;
  if (activeKind === "setup") {
    const label = document.createElement("span");
    label.textContent = `${t("CA fingerprint")}:`;
    const fingerprint = document.createElement("code");
    fingerprint.className = "lan-qr-fingerprint";
    const groups = String(latestData.caFingerprint || t("Unavailable")).split(":");
    for (let index = 0; index < groups.length; index += 8) {
      const line = document.createElement("span");
      line.textContent = groups.slice(index, index + 8).join(":");
      fingerprint.append(line);
    }
    lanQrMeta.classList.add("is-fingerprint");
    lanQrMeta.replaceChildren(label, fingerprint);
    lanQrMeta.classList.remove("hidden");
    if (lanQrAddress && lanQrUrl) {
      lanQrAddress.textContent = lanQrUrl;
      lanQrAddress.classList.remove("hidden");
    }
    return;
  }
  const expiresAt = Number(latestData.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
  lanQrMeta.classList.remove("is-fingerprint");
  const seconds = Math.max(0, Math.ceil(expiresAt - Date.now() / 1000));
  if (seconds === 0) {
    lanQrMeta.textContent = t("This QR code expired. Refresh to create a new one.");
    lanQrRefresh?.classList.remove("hidden");
    clearExpiryTimer();
  } else {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    lanQrMeta.textContent = t("One-time link expires in {time}").replace(
      "{time}",
      `${minutes}:${remainder}`,
    );
  }
  lanQrMeta.classList.remove("hidden");
}

async function loadLanQr(kind) {
  activeKind = kind === "setup" ? "setup" : "session";
  const sequence = ++requestSequence;
  updateTabs();
  resetQrState();
  renderHint();
  try {
    const params = new URLSearchParams({ kind: activeKind });
    if (activeKind === "session") params.set("path", window.location.pathname);
    const response = await fetch(`/v2/lan-qr?${params}`);
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    if (sequence !== requestSequence || lanQrModal?.classList.contains("hidden")) return;
    latestData = data;
    if (lanQrImage && data.dataUrl) {
      lanQrImage.src = data.dataUrl;
      lanQrImage.alt = t(
        activeKind === "setup" ? "QR code for phone certificate setup" : "QR code for current chat",
      );
      lanQrImage.classList.remove("hidden");
    }
    if (typeof data.url === "string" && data.url) {
      lanQrUrl = data.url;
      lanQrOpenLink?.classList.remove("hidden");
    }
    lanQrLoading?.classList.add("hidden");
    renderMetadata();
    if (activeKind === "session" && Number(data.expiresAt) > 0) {
      expiryTimer = globalThis.setInterval(renderMetadata, 1_000);
    }
  } catch {
    if (sequence !== requestSequence) return;
    if (lanQrLoading) lanQrLoading.textContent = t("QR code unavailable");
  }
}

function openLanQrModal() {
  if (!lanQrModal) return;
  lastFocusedElement = document.activeElement;
  lanQrModal.classList.remove("hidden");
  void loadLanQr("session");
  lanQrModalClose?.focus();
}

function closeLanQrModal() {
  requestSequence += 1;
  clearExpiryTimer();
  lanQrModal?.classList.add("hidden");
  lastFocusedElement?.focus?.();
  lastFocusedElement = null;
}

export async function refreshLanQrButton({
  locationRef = globalThis.location,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!isLoopbackHost(locationRef?.hostname)) {
    updateLanQrButton("");
    return;
  }
  try {
    const response = await fetchImpl("/health");
    if (!response.ok) {
      updateLanQrButton("");
      return;
    }
    const data = await response.json();
    updateLanQrButton(typeof data?.lanUrl === "string" ? data.lanUrl : "");
  } catch {
    updateLanQrButton("");
  }
}

export function setupLanQr({ control } = {}) {
  lanQrBtn?.addEventListener("click", openLanQrModal);
  lanQrModalBackdrop?.addEventListener("click", closeLanQrModal);
  lanQrModalClose?.addEventListener("click", closeLanQrModal);
  for (const tab of lanQrTabs) {
    tab.addEventListener("click", () => void loadLanQr(tab.dataset.lanQrKind));
  }
  lanQrRefresh?.addEventListener("click", () => void loadLanQr(activeKind));
  lanQrOpenLink?.addEventListener("click", () => {
    if (!lanQrUrl) return;
    if (control) {
      control.openExternal(lanQrUrl).catch((error) => {
        console.error("[LAN QR] Failed to open link externally:", error);
        window.open(lanQrUrl, "_blank", "noopener,noreferrer");
      });
      return;
    }
    window.open(lanQrUrl, "_blank", "noopener,noreferrer");
  });
  window.addEventListener("zicode:locale-changed", () => {
    renderHint();
    renderMetadata();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && lanQrModal && !lanQrModal.classList.contains("hidden")) {
      closeLanQrModal();
      return;
    }
    if (event.key !== "Tab" || !lanQrModal || lanQrModal.classList.contains("hidden")) return;
    const focusable = [...lanQrModal.querySelectorAll("button:not([disabled])")].filter(
      (element) => !element.closest(".hidden"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || !lanQrModal.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
