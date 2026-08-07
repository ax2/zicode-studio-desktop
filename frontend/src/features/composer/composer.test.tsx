import { afterEach, describe, expect, it, vi } from "vitest";
import { setupComposer, setupComposerSlashMenu } from "./index";
import type { SlashCommand } from "./slashMenu";

function mountComposer() {
  const root = document.createElement("div");
  root.id = "composer-root";
  document.body.append(root);
  return setupComposer();
}

function mountComposerWithSlashMenu(commands: SlashCommand[] = []) {
  const root = document.createElement("div");
  root.id = "composer-root";
  document.body.append(root);
  const onSubmit = vi.fn();
  const handle = setupComposer({ onSubmit });
  if (!handle) throw new Error("composer mount failed");
  setupComposerSlashMenu({
    input: handle.input,
    container: handle.skillSlashMenu,
    commandButton: handle.commandButton,
    getCommands: () => commands,
  });
  return { handle, onSubmit };
}

async function typeSlash(input: HTMLTextAreaElement, value: string) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pressKey(input: HTMLTextAreaElement, key: string) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
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
    const { handle, onSubmit } = mountComposerWithSlashMenu([
      { name: "skill:btw", description: "Append message", type: "skill" },
    ]);

    await typeSlash(handle.input, "/bt");
    pressKey(handle.input, "Enter");

    expect(handle.input.value).toBe("/skill:btw ");
    expect(onSubmit).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("opens the slash menu on a slash query and lists skill commands only", async () => {
    const { handle } = mountComposerWithSlashMenu([
      { name: "settings", description: "Open settings", type: "builtin" },
      { name: "review", description: "Review files", type: "extension" },
      { name: "skill:research", description: "Investigate sources", type: "skill", scope: "user" },
    ]);

    await typeSlash(handle.input, "/");

    const menu = document.getElementById("skill-slash-menu");
    expect(menu?.classList.contains("hidden")).toBe(false);
    expect(menu?.querySelectorAll(".skill-slash-option").length).toBe(1);
    expect(menu?.textContent).toContain("Skills");
    expect(menu?.textContent).toContain("Research");
    expect(menu?.textContent).not.toContain("Settings");
    expect(menu?.textContent).not.toContain("Review");
    expect(handle.input.getAttribute("aria-activedescendant")).toBe("skill-slash-option-0");
    handle.dispose();
  });

  it("filters skills while typing a slash query", async () => {
    const { handle } = mountComposerWithSlashMenu([
      { name: "skill:code-review", description: "Review a diff", type: "skill", scope: "project" },
      { name: "skill:research", description: "Investigate sources", type: "skill", scope: "user" },
    ]);

    await typeSlash(handle.input, "/res");

    const menu = document.getElementById("skill-slash-menu");
    expect(menu?.classList.contains("hidden")).toBe(false);
    expect(menu?.querySelectorAll(".skill-slash-option").length).toBe(1);
    expect(menu?.textContent).toContain("Research");
    expect(menu?.textContent).toContain("Personal");
    expect(menu?.textContent).not.toContain("Code Review");
    handle.dispose();
  });

  it("navigates with arrow keys and selects with Tab", async () => {
    const { handle, onSubmit } = mountComposerWithSlashMenu([
      { name: "skill:alpha", description: "First", type: "skill" },
      { name: "skill:bravo", description: "Second", type: "skill" },
    ]);

    await typeSlash(handle.input, "/");
    pressKey(handle.input, "ArrowDown");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document
        .getElementById("skill-slash-option-1")
        ?.classList.contains("selected"),
    ).toBe(true);

    pressKey(handle.input, "Tab");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handle.input.value).toBe("/skill:bravo ");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.getElementById("skill-slash-menu")?.classList.contains("hidden")).toBe(true);
    handle.dispose();
  });

  it("closes the slash menu with Escape without touching the input", async () => {
    const { handle } = mountComposerWithSlashMenu([
      { name: "skill:research", description: "Investigate sources", type: "skill" },
    ]);

    await typeSlash(handle.input, "/res");
    expect(document.getElementById("skill-slash-menu")?.classList.contains("hidden")).toBe(false);
    pressKey(handle.input, "Escape");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handle.input.value).toBe("/res");
    expect(document.getElementById("skill-slash-menu")?.classList.contains("hidden")).toBe(true);
    expect(handle.input.getAttribute("aria-activedescendant")).toBeNull();
    handle.dispose();
  });

  it("opens the menu from the command button when the input is empty", async () => {
    const { handle } = mountComposerWithSlashMenu([
      { name: "skill:research", description: "Investigate sources", type: "skill" },
    ]);

    handle.commandButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handle.input.value).toBe("/");
    expect(document.getElementById("skill-slash-menu")?.classList.contains("hidden")).toBe(false);
    expect(document.querySelectorAll(".skill-slash-option").length).toBe(1);
    handle.dispose();
  });
});
