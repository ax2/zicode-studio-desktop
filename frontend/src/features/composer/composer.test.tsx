import { afterEach, describe, expect, it } from "vitest";
import { setupComposer } from "./index";

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
});
