import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanChatTranscript,
  describeModelError,
  formatResult,
  getArgsPreview,
  renderDiffData,
  splitStreamingContent,
} from "./chatLogic";
import { MessageRenderer, ToolCardRenderer } from "./index";

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  container.id = "messages-test";
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chat logic", () => {
  it("describes model errors by kind", () => {
    expect(describeModelError({ error: "insufficient_user_quota" }).kind).toBe("quota");
    expect(describeModelError({ error: "401 unauthorized" }).kind).toBe("authentication");
    expect(describeModelError({ error: "429 too many requests" }).kind).toBe("rate-limit");
    expect(describeModelError({ error: "boom" }).kind).toBe("generic");
  });

  it("splits streaming content and cleans transcripts", () => {
    expect(splitStreamingContent("hello")).toEqual({ text: "hello", thinking: "" });
    expect(
      splitStreamingContent([
        { type: "text", text: "a" },
        { type: "thinking", thinking: "t" },
      ]),
    ).toEqual({ text: "a", thinking: "t" });
    expect(cleanChatTranscript("- [uid:1] Alice: hi\n- [uid:2] Bob: yo")).toContain("Alice");
    expect(getArgsPreview("read", { path: "/tmp/x" })).toBe("/tmp/x");
    expect(formatResult({ content: [{ type: "text", text: "out" }] })).toBe("out");
    expect(renderDiffData("old", "new")).toHaveLength(2);
  });
});

describe("chat feed renderers", () => {
  it("renders the welcome screen and messages", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderWelcome({ workspacePath: "/home/test" });
    await flush();
    expect(container.querySelector(".welcome")).toBeTruthy();
    expect(container.querySelector(".welcome-workspace code")?.textContent).toBe("/home/test");

    renderer.renderUserMessage({ content: "# Hello" });
    await flush();
    expect(container.querySelector(".message.user")).toBeTruthy();
    expect(container.querySelector(".welcome")).toBeNull();
    expect(container.querySelector(".message-content")?.textContent).toContain("Hello");
    expect(container.querySelector(".message-copy-btn")).toBeTruthy();
  });

  it("updates the welcome scene card from the scene indicator feed", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderWelcome();
    await flush();
    expect(container.querySelector(".welcome-scene")?.getAttribute("data-scene")).toBe(
      "programming",
    );
    renderer.setWelcomeScene({
      id: "finance",
      name: "Finance",
      description: "Evidence-led financial analysis.",
    });
    await flush();
    expect(container.querySelector(".welcome-scene")?.getAttribute("data-scene")).toBe(
      "finance",
    );
    expect(container.querySelector("[data-scene-name]")?.textContent).toBe("金融");
    expect(container.querySelector("[data-scene-description]")?.textContent).toContain(
      "Evidence",
    );
  });

  it("opens scene settings from the welcome scene card", async () => {
    const container = makeContainer();
    const onOpenSceneSettings = vi.fn();
    const renderer = new MessageRenderer(container, { onOpenSceneSettings });
    renderer.renderWelcome();
    await flush();
    (container.querySelector(".welcome-scene") as HTMLElement | null)?.click();
    expect(onOpenSceneSettings).toHaveBeenCalledTimes(1);
  });

  it("streams and finalizes an assistant message", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    const handle = renderer.renderAssistantMessage({ id: "a1", content: "Hel" }, true);
    if (!handle) throw new Error("missing streaming handle");
    await flush();
    expect(container.querySelector(".message.assistant .message-content.streaming")).toBeTruthy();
    renderer.updateStreamingMessage(handle, "Hello");
    await flush();
    expect(container.querySelector(".message-content")?.textContent).toContain("Hello");
    renderer.finalizeStreamingMessage(handle, { cost: { total: 0.5 } });
    await flush();
    expect(container.querySelector(".message.assistant.streaming")).toBeNull();
    expect(container.querySelector(".message-usage")?.textContent).toBe("$0.5000");
    expect(container.querySelector(".message-copy-btn")).toBeTruthy();
  });

  it("renders system, error, and model error messages", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderSystemMessage("system note");
    renderer.renderError("broken");
    renderer.renderAssistantError({ errorMessage: "401 unauthorized" });
    await flush();
    expect(container.querySelector(".system-message")?.textContent).toBe("system note");
    expect(container.querySelector(".error-message")?.textContent).toContain("broken");
    expect(container.querySelector(".model-error-card--authentication")).toBeTruthy();
    expect(container.querySelector(".model-error-card__title")?.textContent).toBe(
      describeModelError({ errorMessage: "401 unauthorized" }).title,
    );
  });

  it("renders and updates tool cards", async () => {
    const container = makeContainer();
    const tools = new ToolCardRenderer(container);
    tools.createToolCard({
      toolCallId: "tc-1",
      toolName: "read",
      args: { path: "/tmp/a" },
      status: "pending",
    });
    await flush();
    expect(container.querySelector(".tool-card")).toBeTruthy();
    expect(container.querySelector(".tool-name")?.textContent).toBe("read");
    tools.updateToolCard({
      toolCallId: "tc-1",
      toolName: "read",
      args: {},
      status: "streaming",
      output: "content",
    });
    await flush();
    expect(container.querySelector(".tool-status")?.textContent).toBe("streaming");
    expect(container.querySelector(".tool-output")?.textContent).toBe("content");
    tools.finalizeToolCard("tc-1", { content: [{ type: "text", text: "done" }] }, false);
    await flush();
    expect(container.querySelector(".tool-status")?.textContent).toBe("complete");
    expect(container.querySelector(".tool-output")?.textContent).toBe("done");
  });

  it("renders history tool cards with results and supports expand/collapse", async () => {
    const container = makeContainer();
    const tools = new ToolCardRenderer(container);
    tools.createHistoryCard({ toolCallId: "tc-h", toolName: "edit", args: { oldText: "a", newText: "b" } });
    tools.addHistoryResult("tc-h", { content: [{ type: "text", text: "patched" }] }, false);
    await flush();
    expect(container.querySelector(".tool-card .tool-output")?.textContent).toBe("patched");
    tools.expandAll();
    await flush();
    await flush();
    expect(container.querySelector(".tool-card .tool-card-body.expanded")).toBeTruthy();
    tools.collapseAll();
    await flush();
    await flush();
    expect(container.querySelector(".tool-card .tool-card-body.expanded")).toBeNull();
  });

  it("clears content and appends notice elements", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderSystemMessage("x");
    const notice = document.createElement("aside");
    notice.className = "history-window-notice";
    notice.textContent = "folded";
    renderer.appendNoticeElement(notice);
    await flush();
    await flush();
    expect(container.querySelector(".history-window-notice")?.textContent).toBe("folded");
    renderer.clear();
    await flush();
    expect(container.querySelector(".system-message")).toBeNull();
    expect(container.querySelector(".history-window-notice")).toBeNull();
  });
});
