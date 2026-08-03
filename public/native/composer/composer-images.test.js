import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupComposerImageAttachments } from "./composer-images.js";

describe("composer image attachments", () => {
  let dom;
  let input;
  let attachButton;
  let imageInput;
  let previews;
  let dropTarget;

  beforeEach(() => {
    dom = new JSDOM(`
      <textarea id="message-input"></textarea>
      <button id="attach-btn" type="button"></button>
      <input id="image-input" type="file" />
      <div id="composer-card"></div>
      <div id="image-previews" class="hidden"></div>
    `);
    globalThis.document = dom.window.document;
    globalThis.File = dom.window.File;
    input = document.getElementById("message-input");
    attachButton = document.getElementById("attach-btn");
    imageInput = document.getElementById("image-input");
    previews = document.getElementById("image-previews");
    dropTarget = document.getElementById("composer-card");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
    delete globalThis.document;
    delete globalThis.File;
  });

  it("opens the file picker from the attach button and tracks previews", async () => {
    const clickPicker = vi.spyOn(imageInput, "click").mockImplementation(() => {});
    const onChange = vi.fn();
    const controller = setupComposerImageAttachments({
      input,
      attachButton,
      imageInput,
      previewContainer: previews,
      dropTarget,
      onChange,
      processImageFile: async (file) => ({
        type: "image",
        data: `encoded-${file.name}`,
        mimeType: "image/png",
      }),
    });

    attachButton.click();
    await controller.addFiles([new File(["fake"], "screen.png", { type: "image/png" })]);

    expect(clickPicker).toHaveBeenCalledOnce();
    expect(controller.getImages()).toEqual([
      { type: "image", data: "encoded-screen.png", mimeType: "image/png" },
    ]);
    expect(previews.classList.contains("hidden")).toBe(false);
    expect(previews.querySelectorAll(".image-preview")).toHaveLength(1);
    expect(onChange).toHaveBeenCalledOnce();
    previews.querySelector(".image-preview-remove").click();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(controller.getImages()).toEqual([]);
    controller.dispose();
  });

  it("shows progress and keeps submission busy until a phone photo is ready", async () => {
    let finishProcessing;
    const onBusyChange = vi.fn();
    const controller = setupComposerImageAttachments({
      input,
      attachButton,
      imageInput,
      previewContainer: previews,
      dropTarget,
      onBusyChange,
      processImageFile: () =>
        new Promise((resolve) => {
          finishProcessing = resolve;
        }),
    });

    const processing = controller.addFiles([
      new File(["large-photo"], "camera.jpg", { type: "image/jpeg" }),
    ]);
    expect(previews.getAttribute("aria-busy")).toBe("true");
    expect(previews.textContent).toMatch(/Preparing image|正在处理图片/);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    await Promise.resolve();
    finishProcessing({ type: "image", data: "camera", mimeType: "image/jpeg" });
    await processing;
    await controller.whenIdle();

    expect(controller.getImages()).toHaveLength(1);
    expect(previews.getAttribute("aria-busy")).toBe("false");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });
});
