import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n.js";
import { ToolCardRenderer } from "./tool-card.js";

describe("ToolCardRenderer", () => {
  let container;
  let renderer;

  beforeEach(() => {
    setLocale("en");
    document.body.innerHTML = '<div id="messages"></div>';
    container = document.querySelector("#messages");
    renderer = new ToolCardRenderer(container);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
    setLocale("en");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("uses a real disclosure button with synchronized accessible state", () => {
    const card = renderer.createToolCard({
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "echo mobile" },
      status: "complete",
    });
    const toggle = card.querySelector(".tool-card-toggle");
    const body = card.querySelector(".tool-card-body");

    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(body.id);
    expect(toggle.getAttribute("aria-labelledby")).toBe(
      `${body.id}-name ${body.id}-action`,
    );
    expect(body.hidden).toBe(true);
    expect(card.querySelector(".copy-output-btn").disabled).toBe(true);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".tool-toggle-action").textContent).toBe("Collapse tool details");
    expect(body.hidden).toBe(false);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
  });

  it("synchronizes delayed automatic expansion", () => {
    vi.useFakeTimers();
    const card = renderer.createToolCard({
      toolCallId: "tool-auto",
      toolName: "read",
      args: { path: "C:/workspace/long-file.txt" },
      status: "pending",
    });

    vi.advanceTimersByTime(199);
    expect(card.querySelector(".tool-card-body").hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(card.querySelector(".tool-card-body").hidden).toBe(false);
    expect(card.querySelector(".tool-card-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("copies output and announces success", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const card = renderer.createToolCard({
      toolCallId: "tool-copy",
      toolName: "bash",
      args: { command: "echo ready" },
      status: "complete",
    });
    renderer.updateToolCard({ toolCallId: "tool-copy", status: "complete", output: "ready\n" });
    const button = card.querySelector(".copy-output-btn");

    expect(button.disabled).toBe(false);
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("ready\n");
    expect(button.classList.contains("copied")).toBe(true);
    expect(card.querySelector(".tool-copy-status").textContent).toBe("Tool output copied");
    expect(card.querySelector(".tool-copy-status").dataset.state).toBe("copied");
    vi.runAllTimers();
    expect(button.classList.contains("copied")).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("shows a recoverable state when clipboard permission is denied", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) },
    });
    const card = renderer.createToolCard({
      toolCallId: "tool-denied",
      toolName: "bash",
      args: { command: "echo private" },
      status: "complete",
    });
    renderer.updateToolCard({ toolCallId: "tool-denied", status: "complete", output: "private" });
    const button = card.querySelector(".copy-output-btn");
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(button.classList.contains("failed")).toBe(true);
    expect(card.querySelector(".tool-copy-status").textContent).toContain(
      "Check browser clipboard permission",
    );
    expect(card.querySelector(".tool-copy-status").dataset.state).toBe("failed");
    vi.advanceTimersByTime(4999);
    expect(button.classList.contains("failed")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button.classList.contains("failed")).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("expands failed tools and exposes their final output", () => {
    vi.useFakeTimers();
    const card = renderer.createToolCard({
      toolCallId: "tool-error",
      toolName: "write",
      args: { path: "C:/workspace/locked.txt" },
      status: "pending",
    });

    renderer.finalizeToolCard(
      "tool-error",
      { content: [{ type: "text", text: "Permission denied" }] },
      true,
    );

    expect(card.querySelector(".tool-status").textContent).toBe("error");
    expect(card.querySelector(".tool-card-body").hidden).toBe(false);
    expect(card.querySelector(".tool-card-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".tool-output").textContent).toBe("Permission denied");
    expect(card.querySelector(".copy-output-btn").disabled).toBe(false);
  });

  it("uses the same disclosure and copy contract for history cards", () => {
    const card = renderer.createHistoryCard({
      toolCallId: "tool-history",
      toolName: "read",
      args: { path: "C:/workspace/history.txt" },
    });
    renderer.addHistoryResult(
      "tool-history",
      { content: [{ type: "text", text: "Historical output" }] },
      false,
    );

    const toggle = card.querySelector(".tool-card-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".copy-output-btn").disabled).toBe(false);
    toggle.click();
    expect(card.querySelector(".tool-card-body").hidden).toBe(false);
  });

  it("updates all visible labels when the language changes", () => {
    const card = renderer.createToolCard({
      toolCallId: "tool-locale",
      toolName: "bash",
      args: {},
      status: "complete",
    });

    setLocale("zh-CN");

    expect(card.querySelector(".tool-toggle-action").textContent).toBe("展开工具详情");
    expect(card.querySelector(".copy-output-btn").getAttribute("aria-label")).toBe("复制输出");
    expect(card.querySelector(".tool-status").textContent).toBe("完成");
  });
});
