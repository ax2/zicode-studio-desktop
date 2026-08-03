import { afterEach, describe, expect, it, vi } from "vitest";

function render() {
  document.body.innerHTML = `
    <div id="messages">
      <button type="button" id="trigger">View image</button>
      <img class="message-image" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="sample" />
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("image lightbox focus management", () => {
  async function freshLightbox() {
    vi.resetModules();
    return await import("./image-lightbox.js");
  }

  it("moves focus to the close button on open and restores it on close", async () => {
    const { initImageLightbox } = await freshLightbox();
    render();
    const container = document.getElementById("messages");
    initImageLightbox(container);
    const trigger = document.getElementById("trigger");
    trigger.focus();
    container.querySelector("img.message-image").click();
    const overlay = document.querySelector(".image-lightbox-overlay");
    expect(overlay.classList.contains("open")).toBe(true);
    expect(document.activeElement?.classList.contains("image-lightbox-close")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.classList.contains("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab focus on the close button while open", async () => {
    const { initImageLightbox } = await freshLightbox();
    render();
    const container = document.getElementById("messages");
    initImageLightbox(container);
    container.querySelector("img.message-image").click();
    const closeBtn = document.querySelector(".image-lightbox-close");
    const outside = document.createElement("button");
    outside.id = "outside";
    document.body.append(outside);
    outside.focus();
    closeBtn.focus();

    closeBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(closeBtn);
    expect(document.activeElement).not.toBe(outside);
  });
});
