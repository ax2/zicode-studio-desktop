import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import {
  isRpivTodoCommandNotify,
  isRpivTodoDetails,
  isRpivTodoWidgetRequest,
  RpivTodoMirrorPanel,
  replayRpivTodoFromMessages,
} from "../react/rpiv-todo-mirror.js";

describe("rpiv todo mirror", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
  });
  afterEach(() => setLocale("en"));
  it("recognizes rpiv-todo snapshots", () => {
    expect(
      isRpivTodoDetails({
        tasks: [{ id: 1, subject: "Implement sync", status: "in_progress" }],
        nextId: 2,
      }),
    ).toBe(true);
    expect(
      isRpivTodoDetails({ tasks: [{ id: 1, subject: "bad", status: "open" }], nextId: 2 }),
    ).toBe(false);
  });

  it("replays the last todo tool result from messages", () => {
    const state = replayRpivTodoFromMessages([
      {
        role: "toolResult",
        toolName: "todo",
        details: { tasks: [{ id: 1, subject: "Old", status: "pending" }], nextId: 2 },
      },
      {
        role: "toolResult",
        toolName: "bash",
        details: { tasks: [{ id: 99, subject: "Ignored", status: "pending" }], nextId: 100 },
      },
      {
        role: "toolResult",
        toolName: "todo",
        details: { tasks: [{ id: 1, subject: "Done", status: "completed" }], nextId: 2 },
      },
    ]);

    expect(state).toEqual({ tasks: [{ id: 1, subject: "Done", status: "completed" }], nextId: 2 });
  });

  it("detects rpiv-todo extension UI requests", () => {
    expect(isRpivTodoWidgetRequest({ method: "setWidget", widgetKey: "rpiv-todos" })).toBe(true);
    expect(isRpivTodoWidgetRequest({ method: "setWidget", widgetKey: "other" })).toBe(false);
    expect(isRpivTodoCommandNotify("3/3 completed\n── Completed ──\n  ✓ #1 Done")).toBe(true);
    expect(isRpivTodoCommandNotify("regular message")).toBe(false);
  });

  it("renders a native panel from tool result details", () => {
    document.body.innerHTML = '<div class="input-area"><form></form></div>';
    const panel = new RpivTodoMirrorPanel({ container: document.querySelector(".input-area") });

    panel.applyToolResult({
      details: {
        tasks: [
          { id: 1, subject: "Build panel", status: "in_progress", activeForm: "building panel" },
          { id: 2, subject: "Deleted", status: "deleted" },
        ],
        nextId: 3,
      },
    });

    const element = document.querySelector(".rpiv-todo-panel");
    expect(element.classList.contains("hidden")).toBe(false);
    expect(element.textContent).toContain("Tasks");
    expect(element.textContent).toContain("0/1");
    expect(element.textContent).toContain("Build panel");
    expect(element.textContent).not.toContain("Deleted");
    panel.dispose();
  });

  it("renders a touch and keyboard operable collapsed control", () => {
    document.body.innerHTML = '<div class="input-area"><form></form></div>';
    const panel = new RpivTodoMirrorPanel({ container: document.querySelector(".input-area") });

    panel.applyToolResult({
      details: {
        tasks: [{ id: 1, subject: "Build panel", status: "pending" }],
        nextId: 2,
      },
    });

    const element = document.querySelector(".rpiv-todo-panel");
    const toggle = element.querySelector(".rpiv-todo-panel__header");
    expect(element.classList.contains("is-collapsed")).toBe(true);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toContain("Show task details");
    expect(toggle.getAttribute("aria-controls")).toBe(
      element.querySelector(".rpiv-todo-panel__list").id,
    );
    expect(element.querySelector(".rpiv-todo-panel__list").getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(element.querySelector(".rpiv-todo-panel__list").hasAttribute("inert")).toBe(true);
    toggle.click();
    expect(element.classList.contains("is-expanded")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toContain("Hide task details");
    expect(element.querySelector(".rpiv-todo-panel__list").getAttribute("aria-hidden")).toBe(
      "false",
    );
    expect(element.querySelector(".rpiv-todo-panel__list").hasAttribute("inert")).toBe(false);
    toggle.click();
    expect(element.classList.contains("is-expanded")).toBe(false);
    expect(element.querySelector(".rpiv-todo-panel__list").textContent).toContain("Build panel");
    panel.dispose();
  });

  it("updates labels when the application language changes", async () => {
    document.body.innerHTML = '<div class="input-area"><form></form></div>';
    const panel = new RpivTodoMirrorPanel({ container: document.querySelector(".input-area") });
    panel.applyToolResult({
      details: {
        tasks: [{ id: 1, subject: "移动端检查", status: "in_progress" }],
        nextId: 2,
      },
    });

    setLocale("zh-CN");

    const element = document.querySelector(".rpiv-todo-panel");
    await vi.waitFor(() =>
      expect(element.getAttribute("aria-label")).toBe("Pi 任务进度"),
    );
    expect(element.querySelector(".rpiv-todo-panel__title").textContent).toBe("任务");
    await vi.waitFor(() =>
      expect(
        element.querySelector(".rpiv-todo-panel__header").getAttribute("aria-label"),
      ).toContain("展开任务详情"),
    );
    expect(element.querySelector(".rpiv-todo-panel__task").title).toBe("进行中");

    panel.dispose();
  });
});
