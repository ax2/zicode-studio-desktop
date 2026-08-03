import { takeMobileShareImages } from "./mobile-share-inbox.js";

export const MOBILE_SHARE_TARGET_KEY = "zicode-mobile-share-target";
export const MOBILE_SHARE_TARGET_MAX_AGE_MS = 10 * 60 * 1000;
const MOBILE_SHARE_IMAGE_READ_TIMEOUT_MS = 5_000;

function normalizedField(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: "unavailable", files: [] }), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export function formatMobileShareTarget(payload = {}) {
  const parts = [
    normalizedField(payload.title, 512),
    normalizedField(payload.text, 32_768),
    normalizedField(payload.url, 2_048),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  return parts.join("\n\n");
}

export async function consumeMobileShareTarget({
  clientType,
  input,
  storage = globalThis.sessionStorage,
  now = () => Date.now(),
  EventCtor = globalThis.Event,
  takeSharedImages = takeMobileShareImages,
  addImageFiles,
  imageReadTimeoutMs = MOBILE_SHARE_IMAGE_READ_TIMEOUT_MS,
} = {}) {
  if (clientType !== "remote" || !input || !storage) return { status: "ignored" };

  let serialized = "";
  try {
    serialized = storage.getItem(MOBILE_SHARE_TARGET_KEY) || "";
    if (serialized) storage.removeItem(MOBILE_SHARE_TARGET_KEY);
  } catch {
    return { status: "invalid" };
  }
  if (!serialized) return { status: "empty" };

  try {
    const payload = JSON.parse(serialized);
    const createdAt = Number(payload?.createdAt);
    const age = now() - createdAt;
    const text = formatMobileShareTarget(payload);
    const imageShareId = typeof payload?.imageShareId === "string" ? payload.imageShareId : "";
    if (
      !Number.isFinite(createdAt) ||
      age < -60_000 ||
      age > MOBILE_SHARE_TARGET_MAX_AGE_MS ||
      (!text && !imageShareId)
    ) {
      return { status: "invalid" };
    }

    if (text) {
      const currentDraft = String(input.value || "").trimEnd();
      input.value = currentDraft ? `${currentDraft}\n\n${text}` : text;
      input.dispatchEvent(new EventCtor("input", { bubbles: true }));
    }

    let imageCount = 0;
    let imageFailed = Boolean(payload?.imageError);
    if (imageShareId) {
      const result = await withTimeout(
        takeSharedImages(imageShareId, { now }),
        imageReadTimeoutMs,
      );
      if (result.status === "imported" && result.files.length > 0 && addImageFiles) {
        await addImageFiles(result.files);
        imageCount = result.files.length;
      } else {
        imageFailed = true;
      }
    }

    if (!text && imageCount === 0) return { status: "invalid" };
    input.focus();
    input.setSelectionRange?.(input.value.length, input.value.length);
    return {
      status: imageFailed ? "partial" : "imported",
      text,
      imageCount,
    };
  } catch {
    return { status: "invalid" };
  }
}
