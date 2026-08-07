import { afterEach, describe, expect, it, vi } from "vitest";
import { setupComposer } from "./index";
// @ts-expect-error plain JS module without type declarations (public/native/composer/composer-slash-menu.js)
import { setupComposerSlashMenu } from "../../../../public/native/composer/composer-slash-menu.js";

function mountComposer() {
  const root = document.createElement("div");
  root.id = "composer-root";
  document.body.append(root);
  return setupComposer();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("composer React shell", () => {
  it("renders the composer with all expected element ids", () => {
    const elements = mountComposer();
    expect(elements).toBeTruthy();
    const expectedIds = [
      "queued-messages",
      "chat-form",
      "composer-card",
      "skill-slash-menu",
      "image-previews",
      "message-input",
      "attach-btn",
      "command-btn",
      "image-input",
      "model-dropdown",
      "model-dropdown-btn",
      "model-dropdown-label",
      "model-dropdown-menu",
      "thinking-btn",
      "mic-btn",
      "send-btn",
      "abort-btn",
    ];
    for (const id of expectedIds) {
      expect(document.getElementById(id), `missing #${id}`).toBeTruthy();
    }
    expect(elements?.input).toBe(document.getElementById("message-input"));
    expect(elements?.composerCard).toBe(document.getElementById("composer-card"));
    expect((elements?.abortButton as HTMLButtonElement)?.classList.contains("hidden")).toBe(true);
  });

  it("returns null when the composer root is absent", () => {
    expect(setupComposer()).toBeNull();
  });

  it("submits on Enter and respects IME composition", () => {
    const root = document.createElement("div");
    root.id = "composer-root";
    document.body.append(root);
    const onSubmit = vi.fn();
    const composer = setupComposer({ onSubmit });
    const input = composer?.input;
    expect(input).toBeTruthy();

    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSubmit).toHaveBeenCalledWith({ altKey: false });

    onSubmit.mockClear();
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    // The keydown handler must not treat Shift+Enter as a submit; jsdom may
    // still fire an implicit form submission with altKey false, which real
    // browsers do not for textareas.
    expect(onSubmit).not.toHaveBeenCalledWith(expect.objectContaining({ altKey: true }));

    onSubmit.mockClear();
    input?.dispatchEvent(new CompositionEvent("compositionstart"));
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSubmit).not.toHaveBeenCalledWith(expect.objectContaining({ altKey: true }));
  });

  it("renders queued messages from the feed", async () => {
    const root = document.createElement("div");
    root.id = "composer-root";
    document.body.append(root);
    const composer = setupComposer({});
    composer?.setQueue({ steering: ["steer-a"], followUp: ["follow-b"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const container = document.getElementById("queued-messages");
    expect(container?.classList.contains("hidden")).toBe(false);
    expect(container?.querySelectorAll(".queued-msg").length).toBe(2);
    expect(container?.textContent).toContain("steer-a");
    expect(container?.textContent).toContain("follow-b");
    composer?.setQueue({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById("queued-messages")?.classList.contains("hidden")).toBe(true);
  });

  it("lets an open slash menu select a command instead of submitting", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const root = document.createElement("div");
    root.id = "composer-root";
    document.body.append(root);
    const onSubmit = vi.fn();
    const handle = setupComposer({ onSubmit });
    expect(handle).toBeTruthy();
    if (!handle) throw new Error("composer mount failed");
    const controller = setupComposerSlashMenu({
      input: handle.input,
      container: handle.skillSlashMenu,
      getCommands: () => [
        { name: "skill:btw", description: "Append message", type: "skill" },
      ],
    });

    handle.input.value = "/bt";
    handle.input.setSelectionRange(handle.input.value.length, handle.input.value.length);
    await controller.update();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
      bubbles: true,
    });
    handle.input.dispatchEvent(event);

    expect(handle.input.value).toBe("/skill:btw ");
    expect(onSubmit).not.toHaveBeenCalled();
    handle.dispose();
  });
});
