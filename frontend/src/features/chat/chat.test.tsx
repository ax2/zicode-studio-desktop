import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanChatTranscript,
  describeModelError,
  friendlyToolError,
  formatResult,
  getArgsPreview,
  renderDiffData,
  splitStreamingContent,
  toolStageLabel,
} from "./chatLogic";
import { MessageRenderer, ToolCardRenderer } from "./index";
import { CHAT_TEMPLATES } from "./chatTemplates";

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  container.id = "messages-test";
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  try {
    globalThis.localStorage?.removeItem("zicode-chat-templates-custom");
  } catch {
    // Best effort cleanup.
  }
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chat logic", () => {
  it("describes model errors by kind", () => {
    expect(describeModelError({ error: "insufficient_user_quota" }).kind).toBe("quota");
    expect(describeModelError({ error: "401 unauthorized" }).kind).toBe("authentication");
    expect(describeModelError({ error: "429 too many requests" }).kind).toBe("rate-limit");
    expect(
      describeModelError({ error: "maximum context length exceeded" }).kind,
    ).toBe("context-length");
    expect(describeModelError({ errorMessage: "prompt is too long" }).kind).toBe(
      "context-length",
    );
    expect(describeModelError({ error: "boom" }).kind).toBe("generic");
  });

  it("maps known tool-runtime errors to friendly messages", () => {
    expect(
      friendlyToolError("[runtime_stopped] The runtime that owns this broker token is no longer active"),
    ).toBe("会话运行时在工具完成前已停止。请重试以再次运行。");
    expect(
      friendlyToolError("Runtime broker token is invalid or expired"),
    ).toBe("工具会话已过期。请重试以再次运行。");
    expect(
      friendlyToolError("The tool is missing, disabled, or not granted for this scene"),
    ).toBe("当前场景中此工具不可用。");
    expect(friendlyToolError("some other failure")).toBeNull();
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

  it("offers desktop quick actions that open apps or focus the composer", async () => {
    const container = makeContainer();
    const input = document.createElement("textarea");
    input.id = "message-input";
    document.body.append(input);
    const focusSpy = vi.spyOn(input, "focus");
    const openApp = vi.fn();
    const renderer = new MessageRenderer(container, { openApp });
    renderer.renderWelcome();
    await flush();

    const actions = container.querySelectorAll(".welcome-quick-action");
    expect(actions.length).toBeGreaterThanOrEqual(5);

    (container.querySelector('[data-quick-action="com.zicode.notes"]') as HTMLElement | null)?.click();
    expect(openApp).toHaveBeenCalledWith("com.zicode.notes");

    (container.querySelector('[data-quick-action="new-chat"]') as HTMLElement | null)?.click();
    expect(focusSpy).toHaveBeenCalled();

    const dispatched = vi.fn();
    window.addEventListener("zicode:extract-memory", dispatched);
    (
      container.querySelector('[data-quick-action="extract-memory"]') as HTMLElement | null
    )?.click();
    expect(dispatched).toHaveBeenCalledTimes(1);
    window.removeEventListener("zicode:extract-memory", dispatched);
  });

  it("renders starter templates that prefill the composer", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderWelcome();
    await flush();

    const templates = container.querySelectorAll(".welcome-template");
    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector(".welcome-templates-heading")?.textContent).toBe(
      "从模板开始",
    );

    const prefill = vi.fn();
    container.addEventListener("zicode:composer-prefill", prefill);
    (
      container.querySelector('[data-template-id="write-blog"]') as HTMLElement | null
    )?.click();
    expect(prefill).toHaveBeenCalledTimes(1);
    const detail = prefill.mock.calls[0][0].detail as { text: string };
    expect(detail.text).toContain("技术博客");
    expect(detail.text).toContain("结构清晰");
    container.removeEventListener("zicode:composer-prefill", prefill);
  });

  it("keeps starter template ids unique and prompts non-empty", () => {
    const ids = CHAT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of CHAT_TEMPLATES) {
      expect(template.label.trim().length).toBeGreaterThan(0);
      expect(template.prompt.trim().length).toBeGreaterThan(0);
      expect(template.icon.length).toBeGreaterThan(0);
    }
  });

  it("renders custom starter templates from storage and prefills them", async () => {
    globalThis.localStorage?.setItem(
      "zicode-chat-templates-custom",
      JSON.stringify([
        {
          id: "custom-qa",
          icon: "🔥",
          label: "Custom QA",
          prompt: "Run the QA sweep and report.",
        },
      ]),
    );
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderWelcome();
    await flush();

    const custom = container.querySelector('[data-template-id="custom-qa"]');
    expect(custom).not.toBeNull();
    expect(custom?.textContent).toContain("Custom QA");

    const prefill = vi.fn();
    container.addEventListener("zicode:composer-prefill", prefill);
    (custom as HTMLElement | null)?.click();
    expect(prefill).toHaveBeenCalledTimes(1);
    const detail = prefill.mock.calls[0][0].detail as { text: string };
    expect(detail.text).toBe("Run the QA sweep and report.");
    container.removeEventListener("zicode:composer-prefill", prefill);
    globalThis.localStorage?.removeItem("zicode-chat-templates-custom");
  });

  it("filters welcome quick actions to enabled applications", async () => {
    const container = makeContainer();
    const openApp = vi.fn();
    const renderer = new MessageRenderer(container, {
      openApp,
      getEnabledAppIds: () => [
        "core.chat",
        "com.zicode.notes",
        "com.zicode.translate",
        "com.zicode.finance",
        "com.zicode.idphoto",
        "com.zicode.projects",
      ],
    });
    renderer.renderWelcome();
    await flush();

    expect(
      container.querySelector('[data-quick-action="com.zicode.notes"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-quick-action="com.zicode.translate"]'),
    ).not.toBeNull();
    // Only the first four enabled applications are shown; disabled
    // Tasks/Automation and Projects (outside the top four) stay hidden.
    expect(
      container.querySelector('[data-quick-action="com.zicode.projects"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-quick-action="com.zicode.tasks"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-quick-action="com.zicode.automation"]'),
    ).toBeNull();
    expect(container.querySelectorAll(".welcome-quick-action").length).toBe(6);

    (
      container.querySelector(
        '[data-quick-action="com.zicode.translate"]',
      ) as HTMLElement | null
    )?.click();
    expect(openApp).toHaveBeenCalledWith("com.zicode.translate");
  });

  it("renders an onboarding welcome for the Agent Inbox session", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderWelcome({
      workspacePath: "C:\\Users\\me\\zicode\\workspaces\\agent-inbox",
    });
    await flush();
    expect(container.querySelector('[data-welcome-kind="inbox"]')).toBeTruthy();
    expect(container.querySelector(".welcome-inbox-steps")).toBeTruthy();
    expect(container.querySelector(".welcome-workspace")).toBeNull();

    // Normal workspaces keep the generic welcome.
    const generic = makeContainer();
    const genericRenderer = new MessageRenderer(generic);
    genericRenderer.renderWelcome({ workspacePath: "/home/test" });
    await flush();
    expect(generic.querySelector('[data-welcome-kind="inbox"]')).toBeNull();
    expect(generic.querySelector(".welcome")).toBeTruthy();
  });

  it("routes Agent Inbox welcome actions to settings, tasks, and help", async () => {
    const container = makeContainer();
    const openApp = vi.fn();
    const renderer = new MessageRenderer(container, { openApp });
    renderer.renderWelcome({
      workspacePath: "/Users/me/zicode/workspaces/agent-inbox",
    });
    await flush();

    const settingsSpy = vi.fn();
    container.addEventListener("openinboxsettings", settingsSpy);
    (
      container.querySelector('[data-inbox-action="settings"]') as HTMLElement | null
    )?.click();
    expect(settingsSpy).toHaveBeenCalledTimes(1);

    (
      container.querySelector('[data-inbox-action="tasks"]') as HTMLElement | null
    )?.click();
    expect(openApp).toHaveBeenCalledWith("com.zicode.tasks");

    const helpSpy = vi.fn();
    window.addEventListener("zicode:open-help", helpSpy);
    (
      container.querySelector('[data-inbox-action="help"]') as HTMLElement | null
    )?.click();
    expect(helpSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { pageId: "inbox" } }),
    );
    window.removeEventListener("zicode:open-help", helpSpy);
  });

  it("renders history window notices and loaded status from the feed", async () => {
    const container = makeContainer();
    const onRevealHistory = vi.fn();
    const renderer = new MessageRenderer(container, { onRevealHistory });
    renderer.appendHistoryWindowNotice(10);
    renderer.appendHistoryLoadedStatus();
    await flush();

    const notice = container.querySelector(".history-window-notice");
    expect(notice?.getAttribute("aria-label")).toMatch(/Earlier|更早/);
    expect(notice?.textContent).toMatch(/folded|收起/);
    (container.querySelector(".history-window-load") as HTMLElement | null)?.click();
    expect(onRevealHistory).toHaveBeenCalledTimes(1);

    const status = container.querySelector("p.history-window-loaded");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("tabindex")).toBe("-1");
    expect(status?.textContent).toMatch(/loaded|加载/);
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
    // The accumulated answer survives finalization even though the
    // message_start skeleton carried no content of its own.
    expect(container.querySelector(".message.assistant")?.textContent).toContain("Hello");
    expect(container.querySelector(".message-usage")?.textContent).toBe("$0.5000");
    expect(container.querySelector(".message-copy-btn")).toBeTruthy();
  });

  it("makes the thinking disclosure keyboard-operable", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    const handle = renderer.renderAssistantMessage({ id: "a1", content: "Hi" }, true);
    if (!handle) throw new Error("missing streaming handle");
    renderer.finalizeStreamingMessage(handle, { cost: { total: 0 } }, "internal reasoning");
    await flush();

    const toggle = container.querySelector(".thinking-toggle");
    expect(toggle?.getAttribute("role")).toBe("button");
    expect(toggle?.getAttribute("tabindex")).toBe("0");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    toggle?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".thinking-toggle.expanded")).toBeTruthy();

    toggle?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await flush();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the answer text when a reasoning response finalizes with thinking", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    const handle = renderer.renderAssistantMessage({ id: "r1", content: [] }, true);
    if (!handle) throw new Error("missing streaming handle");
    renderer.updateStreamingMessage(handle, [
      { type: "thinking", thinking: "the user wants a short reply" },
      { type: "text", text: "OK" },
    ]);
    renderer.finalizeStreamingMessage(handle, { cost: { total: 0 } });
    await flush();
    const message = container.querySelector(".message.assistant");
    expect(message?.querySelector(".thinking-content")?.textContent).toContain(
      "the user wants a short reply",
    );
    expect(message?.textContent).toContain("OK");
  });

  it("renders the organize-to-note action and dispatches its request", async () => {
    const container = makeContainer();
    const renderer = new MessageRenderer(container);
    renderer.renderAssistantMessage({ id: "a1", content: "Summary" }, false);
    await flush();

    const button = container.querySelector(".message-organize-btn") as HTMLElement | null;
    expect(button).toBeTruthy();
    const listener = vi.fn();
    container.addEventListener("organizechattonotes", listener);
    button?.click();
    expect(listener).toHaveBeenCalledTimes(1);
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
    expect(container.querySelector(".tool-stage")?.textContent).toBe("正在读取文件");
    tools.updateToolCard({
      toolCallId: "tc-1",
      toolName: "read",
      args: {},
      status: "streaming",
      output: "content",
    });
    await flush();
    expect(container.querySelector(".tool-status")?.textContent).toBe("运行中");
    expect(container.querySelector(".tool-output")?.textContent).toBe("content");
    tools.finalizeToolCard("tc-1", { content: [{ type: "text", text: "done" }] }, false);
    await flush();
    expect(container.querySelector(".tool-status")?.textContent).toBe("完成");
    expect(container.querySelector(".tool-output")?.textContent).toBe("done");
  });

  it("maps tool names to human-friendly stage labels", () => {
    expect(toolStageLabel("bash")).toBe("Running a command");
    expect(toolStageLabel("shell_command")).toBe("Running a command");
    expect(toolStageLabel("read_file")).toBe("Reading a file");
    expect(toolStageLabel("edit")).toBe("Editing files");
    expect(toolStageLabel("apply_patch")).toBe("Editing files");
    expect(toolStageLabel("write_file")).toBe("Writing files");
    expect(toolStageLabel("web_search")).toBe("Searching");
    expect(toolStageLabel("open_page")).toBe("Opening a page");
    expect(toolStageLabel("write_memory")).toBe("Working with memory");
    expect(toolStageLabel("WebSearch")).toBe("Searching");
    expect(toolStageLabel("mystery_tool_xyz")).toBe("");
  });

  it("computes a minimal line diff for edit content", () => {
    expect(renderDiffData("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "removed", text: "- b" },
      { kind: "added", text: "+ d" },
    ]);
    expect(renderDiffData("same", "same")).toEqual([]);
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
