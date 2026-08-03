import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupComposerImagePicker } from "./composer-image-picker.js";

function setup({ mobile = true } = {}) {
  document.body.innerHTML = `
    <button id="attach" type="button">Attach</button>
    <input id="gallery" type="file" accept="image/*" multiple>
  `;
  history.replaceState({}, "", "/app/chat");
  const listeners = new Set();
  const media = {
    matches: mobile,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const windowRef = Object.create(window);
  windowRef.matchMedia = () => media;
  const attachButton = document.getElementById("attach");
  const galleryInput = document.getElementById("gallery");
  const onFiles = vi.fn();
  const picker = setupComposerImagePicker({
    attachButton,
    galleryInput,
    onFiles,
    windowRef,
  });
  return { attachButton, galleryInput, media, listeners, onFiles, picker };
}

describe("composer mobile image picker", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    history.replaceState({}, "", "/app/chat");
  });

  it("offers camera and photo library actions on mobile", () => {
    const view = setup();
    const galleryClick = vi.spyOn(view.galleryInput, "click").mockImplementation(() => {});

    view.attachButton.click();

    const sheet = document.querySelector(".composer-image-picker");
    expect(sheet.hidden).toBe(false);
    expect(sheet.textContent).toMatch(/Take photo|拍照/);
    expect(document.querySelector('input[capture="environment"]')).not.toBeNull();
    sheet.querySelector(".composer-image-picker-actions button:last-child").click();
    expect(galleryClick).toHaveBeenCalledOnce();
    expect(sheet.hidden).toBe(true);
    view.picker.dispose();
  });

  it("dismisses the software keyboard when the bottom sheet opens", () => {
    const view = setup();
    const composer = document.createElement("textarea");
    document.body.prepend(composer);
    composer.focus();
    expect(document.activeElement).toBe(composer);

    view.attachButton.click();

    const sheet = document.querySelector(".composer-image-picker");
    expect(sheet.hidden).toBe(false);
    expect(document.activeElement).not.toBe(composer);
    expect(
      document.activeElement === sheet.querySelector(".composer-image-picker-actions button"),
    ).toBe(true);
    view.picker.dispose();
  });

  it("keeps the direct file picker behavior on desktop", () => {
    const view = setup({ mobile: false });
    const galleryClick = vi.spyOn(view.galleryInput, "click").mockImplementation(() => {});

    view.attachButton.click();

    expect(galleryClick).toHaveBeenCalledOnce();
    expect(document.querySelector(".composer-image-picker").hidden).toBe(true);
    view.picker.dispose();
  });

  it("forwards files selected from the photo library", () => {
    const view = setup();
    const photo = new File(["photo"], "camera.jpg", { type: "image/jpeg" });
    Object.defineProperty(view.galleryInput, "files", { configurable: true, value: [photo] });

    view.galleryInput.dispatchEvent(new Event("change"));

    expect(view.onFiles).toHaveBeenCalledOnce();
    expect(Array.from(view.onFiles.mock.calls[0][0])).toEqual([photo]);
    expect(view.galleryInput.value).toBe("");
    view.picker.dispose();
  });

  it("closes the mobile sheet before browser Back leaves the conversation", async () => {
    const view = setup();
    view.attachButton.click();
    expect(document.querySelector(".composer-image-picker").hidden).toBe(false);

    history.back();
    await vi.waitFor(() =>
      expect(document.querySelector(".composer-image-picker").hidden).toBe(true),
    );

    expect(location.pathname).toBe("/app/chat");
    expect(document.activeElement).toBe(view.attachButton);
    view.picker.dispose();
  });
});
