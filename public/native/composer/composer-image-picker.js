import { t } from "../../i18n.js";
import { MOBILE_SHELL_QUERY } from "../../ui/sidebar-toggle.js";
import { setupMobileHistoryLayer } from "../utils/mobile-history-layer.js";

function createFileInput({ capture = false } = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  if (capture) input.setAttribute("capture", "environment");
  else input.multiple = true;
  return input;
}

export function setupComposerImagePicker({
  attachButton,
  galleryInput,
  onFiles = () => {},
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  if (!attachButton || !galleryInput || !documentRef?.body) return { dispose() {} };

  const mobileMedia = windowRef.matchMedia?.(MOBILE_SHELL_QUERY);
  const isMobile = () => mobileMedia?.matches ?? windowRef.innerWidth <= 768;
  const cameraInput = createFileInput({ capture: true });
  const backdrop = documentRef.createElement("button");
  backdrop.type = "button";
  backdrop.className = "composer-image-picker-backdrop";
  backdrop.hidden = true;

  const sheet = documentRef.createElement("section");
  sheet.className = "composer-image-picker";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "composer-image-picker-title");
  sheet.hidden = true;

  const header = documentRef.createElement("header");
  const title = documentRef.createElement("strong");
  title.id = "composer-image-picker-title";
  const closeButton = documentRef.createElement("button");
  closeButton.type = "button";
  closeButton.className = "ui-icon-button ui-icon-button--ghost composer-image-picker-close";
  closeButton.textContent = "×";
  header.append(title, closeButton);

  const actions = documentRef.createElement("div");
  actions.className = "composer-image-picker-actions";
  const cameraButton = documentRef.createElement("button");
  cameraButton.type = "button";
  cameraButton.className = "ui-button ui-button--secondary";
  const galleryButton = documentRef.createElement("button");
  galleryButton.type = "button";
  galleryButton.className = "ui-button ui-button--secondary";
  actions.append(cameraButton, galleryButton);
  sheet.append(header, actions);
  documentRef.body.append(cameraInput, backdrop, sheet);

  let historyLayer = null;

  function renderLabels() {
    title.textContent = t("Add a photo");
    cameraButton.textContent = t("Take photo");
    galleryButton.textContent = t("Choose from photos");
    closeButton.setAttribute("aria-label", t("Close photo options"));
    backdrop.setAttribute("aria-label", t("Close photo options"));
  }

  function close({ restoreFocus = false, fromHistory = false, discardHistory = false } = {}) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    backdrop.hidden = true;
    attachButton.setAttribute("aria-expanded", "false");
    if (!fromHistory) historyLayer?.leave({ replace: discardHistory });
    if (restoreFocus) attachButton.focus({ preventScroll: true });
  }

  function open() {
    renderLabels();
    sheet.hidden = false;
    backdrop.hidden = false;
    attachButton.setAttribute("aria-expanded", "true");
    historyLayer?.enter();
    // Dismiss the software keyboard so the fixed bottom sheet is not hidden
    // behind it while the camera/photo-library actions are shown.
    documentRef.activeElement?.blur?.();
    cameraButton.focus({ preventScroll: true });
  }

  function choose(input) {
    close({ discardHistory: true });
    input.click();
  }

  function handleInput(input) {
    const files = input.files;
    if (files?.length) void onFiles(files);
    input.value = "";
  }

  const onAttach = () => {
    if (isMobile()) open();
    else galleryInput.click();
  };
  const onCamera = () => choose(cameraInput);
  const onGallery = () => choose(galleryInput);
  const onCameraFiles = () => handleInput(cameraInput);
  const onGalleryFiles = () => handleInput(galleryInput);
  const onClose = () => close({ restoreFocus: true });
  const onLocaleChanged = () => renderLabels();
  const onMediaChange = () => {
    if (!isMobile()) close({ discardHistory: true });
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [closeButton, cameraButton, galleryButton];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  historyLayer = setupMobileHistoryLayer({
    id: "composer-image-picker",
    isActive: () => !sheet.hidden,
    onBack: () => close({ restoreFocus: true, fromHistory: true }),
    windowRef,
  });

  attachButton.setAttribute("aria-haspopup", "dialog");
  attachButton.setAttribute("aria-expanded", "false");
  attachButton.addEventListener("click", onAttach);
  cameraButton.addEventListener("click", onCamera);
  galleryButton.addEventListener("click", onGallery);
  closeButton.addEventListener("click", onClose);
  backdrop.addEventListener("click", onClose);
  cameraInput.addEventListener("change", onCameraFiles);
  galleryInput.addEventListener("change", onGalleryFiles);
  sheet.addEventListener("keydown", onKeyDown);
  windowRef.addEventListener("zicode:locale-changed", onLocaleChanged);
  mobileMedia?.addEventListener?.("change", onMediaChange);
  renderLabels();

  return {
    close,
    dispose() {
      close({ discardHistory: true });
      historyLayer?.dispose();
      attachButton.removeEventListener("click", onAttach);
      cameraButton.removeEventListener("click", onCamera);
      galleryButton.removeEventListener("click", onGallery);
      closeButton.removeEventListener("click", onClose);
      backdrop.removeEventListener("click", onClose);
      cameraInput.removeEventListener("change", onCameraFiles);
      galleryInput.removeEventListener("change", onGalleryFiles);
      sheet.removeEventListener("keydown", onKeyDown);
      windowRef.removeEventListener("zicode:locale-changed", onLocaleChanged);
      mobileMedia?.removeEventListener?.("change", onMediaChange);
      attachButton.removeAttribute("aria-haspopup");
      attachButton.removeAttribute("aria-expanded");
      cameraInput.remove();
      backdrop.remove();
      sheet.remove();
    },
  };
}
