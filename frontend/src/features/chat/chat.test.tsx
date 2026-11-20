import { act } from "@testing-library/react/pure";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanChatTranscript,
  describeModelError,
  formatResult,
  friendlyToolError,
  getArgsPreview,
  renderDiffData,
  splitStreamingContent,
  toolStageLabel,
} from "./chatLogic";
import { CHAT_TEMPLATES, allChatTemplates } from "./chatTemplates";
import { MessageRenderer, ToolCardRenderer } from "./index";

const roots = vi.hoisted(() => [] as Root[]);
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});

async function messageRenderer(...args: ConstructorParameters<typeof MessageRenderer>) {
  let renderer!: MessageRenderer;
  await act(async () => { renderer = new MessageRenderer(...args); });
  return renderer;
}

async function toolRenderer(...args: ConstructorParameters<typeof ToolCardRenderer>) {
  let renderer!: ToolCardRenderer;
  await act(async () => { renderer = new ToolCardRenderer(...args); });
  return renderer;
}

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  container.id = "messages-test";
  document.body.append(container);
  return container;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  try {
    globalThis.localStorage?.removeItem("zicode-chat-templates-custom");
  } catch {
    // Best effort cleanup.
  }
});

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
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
    ).toBe("此工具不可用，请检查它是否已启用并具有所需权限。");
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
    const renderer = await messageRenderer(container);
    renderer.renderWelcome({ workspacePath: "/home/test" });
    await flush();
    expect(container.querySelector(".welcome")).toBeTruthy();
    expect(container.querySelector(".welcome-workspace")).toBeNull();

    renderer.renderUserMessage({ content: "# Hello" });
    await flush();
    expect(container.querySelector(".message.user")).toBeTruthy();
    expect(container.querySelector(".welcome")).toBeNull();
    expect(container.querySelector(".message-content")?.textContent).toContain("Hello");
    expect(container.querySelector(".message-copy-btn")).toBeTruthy();
  });

  it("keeps legacy scene metadata out of the compact start page", async () => {
    const container = makeContainer();
    const renderer = await messageRenderer(container);
    renderer.renderWelcome(); await flush();
    renderer.setWelcomeScene({ id: "finance", name: "Finance", description: "Legacy configuration" }); await flush();
    expect(container.querySelector(".welcome-scene")).toBeNull();
    expect(container.querySelector(".welcome-simple")).toBeTruthy();
    expect(container.textContent).not.toContain("Legacy configuration");
  });

  it("publishes an explicit shortcut-open request from Home", async () => {
    const container = makeContainer(), opened = vi.fn();
    const renderer = await messageRenderer(container); renderer.renderWelcome(); await flush();
    window.addEventListener("zicode:open-quick-tool", opened);
    window.dispatchEvent(new CustomEvent("zicode:quick-tools-changed", { detail: { items: [{ id: "test:tool", title: "Base64" }] } }));
    await flush(); expect(opened).not.toHaveBeenCalled();
    (container.querySelector('[data-quick-tool-id="test:tool"]') as HTMLButtonElement).click();
    expect(opened.mock.calls[0][0].detail).toBe("test:tool");
    window.removeEventListener("zicode:open-quick-tool", opened);
  });

  it("keeps four direct application entries and removes redundant welcome actions", async () => {
    const container = makeContainer(), openApp = vi.fn();
    const renderer = await messageRenderer(container, { openApp }); renderer.renderWelcome(); await flush();
    expect(container.querySelectorAll(".welcome-quick-action")).toHaveLength(4);
    (container.querySelector('[data-quick-action="com.zicode.notes"]') as HTMLElement).click();
    expect(openApp).toHaveBeenCalledWith("com.zicode.notes");
    (container.querySelector('[data-quick-action="core.tools"]') as HTMLElement).click();
    expect(openApp).toHaveBeenCalledWith("core.tools");
    expect(container.querySelector('[data-quick-action="extract-memory"]')).toBeNull();
  });

  it("keeps the start page compact without template grids or tutorial blocks", async () => {
    const container = makeContainer(), renderer = await messageRenderer(container);
    renderer.renderWelcome(); await flush();
    expect(container.querySelector(".welcome-templates")).toBeNull();
    expect(container.querySelector(".welcome-orientation")).toBeNull();
    expect(container.querySelector(".welcome-quick-tools")).toBeTruthy();
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

  it("preserves stored custom templates while removing them from Home", async () => {
    const saved = JSON.stringify([{ id: "custom-qa", icon: "Q", label: "Custom QA", prompt: "Run the QA sweep and report." }]);
    localStorage.setItem("zicode-chat-templates-custom", saved);
    const container = makeContainer(), renderer = await messageRenderer(container); renderer.renderWelcome(); await flush();
    expect(container.querySelector('[data-template-id="custom-qa"]')).toBeNull();
    expect(allChatTemplates().find(template => template.id === "custom-qa")?.prompt).toBe("Run the QA sweep and report.");
    expect(localStorage.getItem("zicode-chat-templates-custom")).toBe(saved);
    localStorage.removeItem("zicode-chat-templates-custom");
  });

  it("only offers enabled apps plus the always available tool directory", async () => {
    const container = makeContainer(), openApp = vi.fn();
    const renderer = await messageRenderer(container, { openApp, getEnabledAppIds: () => ["com.zicode.notes", "com.zicode.projects"] });
    renderer.renderWelcome(); await flush();
    expect(container.querySelectorAll(".welcome-quick-action")).toHaveLength(3);
    expect(container.querySelector('[data-quick-action="com.zicode.tasks"]')).toBeNull();
    (container.querySelector('[data-quick-action="com.zicode.projects"]') as HTMLElement).click();
    expect(openApp).toHaveBeenCalledWith("com.zicode.projects");
  });

  it("renders an onboarding welcome for the Agent Inbox session", async () => {
    const container = makeContainer();
    const renderer = await messageRenderer(container);
    renderer.renderWelcome({
      workspacePath: "C:\\Users\\me\\zicode\\workspaces\\agent-inbox",
    });
    await flush();
    expect(container.querySelector('[data-welcome-kind="inbox"]')).toBeTruthy();
    expect(container.querySelector(".welcome-inbox-steps")).toBeTruthy();
    expect(container.querySelector(".welcome-workspace")).toBeNull();

    // Normal workspaces keep the generic welcome.
    const generic = makeContainer();
    const genericRenderer = await messageRenderer(generic);
    genericRenderer.renderWelcome({ workspacePath: "/home/test" });
    await flush();
    expect(generic.querySelector('[data-welcome-kind="inbox"]')).toBeNull();
    expect(generic.querySelector(".welcome")).toBeTruthy();
  });

  it("routes Agent Inbox welcome actions to settings, tasks, and help", async () => {
    const container = makeContainer();
    const openApp = vi.fn();
    const renderer = await messageRenderer(container, { openApp });
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
    const renderer = await messageRenderer(container, { onRevealHistory });
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
    const renderer = await messageRenderer(container);
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
    const renderer = await messageRenderer(container);
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
    const renderer = await messageRenderer(container);
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
    const renderer = await messageRenderer(container);
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
    const renderer = await messageRenderer(container);
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
    const tools = await toolRenderer(container);
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
    expect(container.querySelector(".tool-stage")).toBeNull();
    expect(container.querySelector(".tool-output")?.textContent).toBe("done");
  });

  it("offers only successful live plugin text results to the trusted parent", async () => {
    const container = makeContainer();
    const tools = await toolRenderer(container);
    const received = vi.fn();
    container.addEventListener("pluginresultaction", received);
    const resultRef = { schemaVersion: 1, resultId: "22222222-2222-4222-8222-222222222222", mimeType: "text/plain" };
    tools.createToolCard({ toolCallId: "plugin-1", toolName: "sql_format", args: {}, status: "pending" });
    tools.finalizeToolCard("plugin-1", { content: [{ type: "text", text: "SELECT 1" }],
      details: { ok: true, data: { text: "SELECT 1" }, studioResult: {
        resultRef, pluginId: "com.zicode.devtools.text", capabilityId: "sql.format" } } }, false);
    await flush();
    const use = container.querySelector<HTMLButtonElement>('.tool-header-right button:not(.copy-output-btn)');
    expect(use).toBeTruthy();
    use?.click();
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0].detail.resultRef).toEqual(resultRef);
    expect(container.querySelector(".tool-output")?.textContent).toBe("SELECT 1");
    tools.createToolCard({ toolCallId: "plugin-2", toolName: "sql_format", args: {}, status: "pending" });
    tools.finalizeToolCard("plugin-2", { content: [{ type: "text", text: "error" }],
      details: { ok: false, studioResult: { resultRef, pluginId: "p", capabilityId: "c" } } }, false);
    await flush();
    expect(container.querySelectorAll('.tool-header-right button:not(.copy-output-btn)')).toHaveLength(1);
  });

  it("offers a live JSON object result only with the paired version and MIME", async () => {
    const container = makeContainer();
    const tools = await toolRenderer(container);
    const received = vi.fn();
    container.addEventListener("pluginresultaction", received);
    const resultRef = { schemaVersion: 2, resultId: "22222222-2222-4222-8222-222222222222", mimeType: "application/json" };
    tools.createToolCard({ toolCallId: "json-1", toolName: "structured_tool", args: {}, status: "pending" });
    tools.finalizeToolCard("json-1", { content: [{ type: "text", text: '{"count":2}' }],
      details: { ok: true, data: { count: 2 }, studioResult: {
        resultRef, pluginId: "com.example.structured", capabilityId: "parse.object" } } }, false);
    await flush();
    container.querySelector<HTMLButtonElement>('.tool-header-right button:not(.copy-output-btn)')?.click();
    expect(received.mock.calls[0][0].detail.resultRef).toEqual(resultRef);
    tools.createToolCard({ toolCallId: "json-2", toolName: "structured_tool", args: {}, status: "pending" });
    tools.finalizeToolCard("json-2", { content: [{ type: "text", text: "bad" }],
      details: { ok: true, studioResult: { resultRef: { ...resultRef, schemaVersion: 1 },
        pluginId: "com.example.structured", capabilityId: "parse.object" } } }, false);
    await flush();
    expect(container.querySelectorAll('.tool-header-right button:not(.copy-output-btn)')).toHaveLength(1);
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
    const tools = await toolRenderer(container);
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
    const renderer = await messageRenderer(container);
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
