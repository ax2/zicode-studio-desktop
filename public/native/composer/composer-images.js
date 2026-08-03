import { t } from "../../i18n.js";
import { setupComposerImagePicker } from "./composer-image-picker.js";

const MAX_IMAGE_DIMENSION = 2048;
const VALID_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function normalizeMimeType(type) {
  return VALID_MIME_TYPES.has(type) ? type : "image/png";
}

export function defaultProcessImageFile(file) {
  return new Promise((resolve, reject) => {
    const mimeType = normalizeMimeType(file.type);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        let { width, height } = image;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);

        const outputMimeType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const quality = outputMimeType === "image/jpeg" ? 0.85 : undefined;
        const base64 = canvas.toDataURL(outputMimeType, quality).split(",")[1];
        if (!base64) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve({ type: "image", data: base64, mimeType: outputMimeType });
      };
      image.onerror = () => reject(new Error("Failed to decode image"));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function setupComposerImageAttachments({
  input,
  attachButton,
  imageInput,
  previewContainer,
  dropTarget,
  processImageFile = defaultProcessImageFile,
  onError = console.error,
  onBusyChange = () => {},
  onChange = () => {},
}) {
  if (!previewContainer) {
    return {
      async addFiles() {},
      getImages: () => [],
      setImages() {},
      clear() {},
      whenIdle: async () => {},
      dispose() {},
    };
  }

  let pendingImages = [];
  let pendingFileCount = 0;
  let processing = Promise.resolve();

  function renderPreviews() {
    previewContainer.innerHTML = "";
    const busy = pendingFileCount > 0;
    previewContainer.classList.toggle("hidden", pendingImages.length === 0 && !busy);
    previewContainer.setAttribute("aria-busy", String(busy));
    pendingImages.forEach((image, index) => {
      const preview = document.createElement("div");
      preview.className = "image-preview";

      const thumbnail = document.createElement("img");
      thumbnail.src = `data:${image.mimeType};base64,${image.data}`;
      thumbnail.alt = t("Image ready to send");

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "image-preview-remove";
      removeButton.dataset.index = String(index);
      removeButton.setAttribute("aria-label", t("Remove image"));
      removeButton.textContent = "✕";
      removeButton.addEventListener("click", () => {
        pendingImages.splice(index, 1);
        renderPreviews();
        onChange();
      });

      preview.append(thumbnail, removeButton);
      previewContainer.appendChild(preview);
    });
    if (busy) {
      const status = document.createElement("div");
      status.className = "image-preview-status";
      status.setAttribute("role", "status");
      status.textContent = t("Preparing image…");
      previewContainer.append(status);
    }
  }

  function addFiles(files) {
    const imageFiles = Array.from(files ?? []).filter((file) => file?.type?.startsWith("image/"));
    if (imageFiles.length === 0) return processing;
    pendingFileCount += imageFiles.length;
    onBusyChange(true);
    renderPreviews();
    const batch = processing.then(async () => {
      for (const file of imageFiles) {
        try {
          pendingImages.push(await processImageFile(file));
          onChange();
        } catch (error) {
          console.warn("[Composer] Image processing failed:", error);
          onError(new Error(t("Could not add this image. Try a smaller PNG or JPEG.")));
        } finally {
          pendingFileCount -= 1;
          renderPreviews();
        }
      }
    });
    processing = batch.finally(() => {
      if (pendingFileCount === 0) onBusyChange(false);
    });
    return processing;
  }

  function getImages() {
    return pendingImages.map((image) => ({ ...image }));
  }

  function setImages(images) {
    pendingImages = Array.from(images ?? []).map((image) => ({ ...image }));
    renderPreviews();
    onChange();
  }

  function clear() {
    const changed = pendingImages.length > 0;
    pendingImages = [];
    renderPreviews();
    if (changed) onChange();
  }

  const picker = setupComposerImagePicker({
    attachButton,
    galleryInput: imageInput,
    onFiles: addFiles,
  });
  const onLocaleChanged = () => renderPreviews();
  globalThis.window?.addEventListener?.("zicode:locale-changed", onLocaleChanged);
  dropTarget?.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  dropTarget?.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer?.files);
  });
  input?.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length > 0) addFiles(files);
  });
  renderPreviews();

  return {
    addFiles,
    getImages,
    setImages,
    clear,
    whenIdle: () => processing,
    dispose() {
      picker.dispose();
      globalThis.window?.removeEventListener?.("zicode:locale-changed", onLocaleChanged);
    },
  };
}
