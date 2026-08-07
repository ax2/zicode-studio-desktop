import { describe, expect, it, vi } from "vitest";
import {
  createHistoryLoadedStatus,
  createHistoryWindow,
  createHistoryWindowNotice,
} from "../react/history-window.js";

function messages(count) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 3 === 0 ? "user" : index % 3 === 1 ? "assistant" : "toolResult",
    content: `message-${index}`,
  }));
}

describe("progressive history window", () => {
  it("starts with a bounded recent suffix aligned to a user turn", () => {
    const history = createHistoryWindow({ batchSize: 5 });
    history.setMessages(messages(15));

    expect(history.hiddenCount).toBe(9);
    expect(history.visibleMessages[0].role).toBe("user");
    expect(history.visibleMessages.at(-1).content).toBe("message-14");
  });

  it("reveals earlier complete turns without dropping the visible suffix", () => {
    const source = messages(18);
    const history = createHistoryWindow({ batchSize: 5 });
    history.setMessages(source);
    const previousVisible = history.visibleMessages;

    expect(history.revealPrevious()).toBe(true);
    expect(history.visibleMessages.slice(-previousVisible.length)).toEqual(previousVisible);
    expect(history.visibleMessages[0].role).toBe("user");
  });

  it("preserves the revealed amount when an authoritative snapshot replaces the source", () => {
    const history = createHistoryWindow({ batchSize: 5 });
    history.setMessages(messages(18));
    history.revealPrevious();
    const previousVisibleCount = history.visibleMessages.length;

    history.setMessages(messages(19));

    expect(history.visibleMessages.length).toBeGreaterThanOrEqual(previousVisibleCount);
    expect(history.visibleMessages.at(-1).content).toBe("message-18");
  });

  it("can reveal the full source for conversation search", () => {
    const source = messages(18);
    const history = createHistoryWindow({ batchSize: 5 });
    history.setMessages(source);

    history.revealAll();

    expect(history.hiddenCount).toBe(0);
    expect(history.visibleMessages).toEqual(source);
  });

  it("renders an accessible load action and a focusable completion status", () => {
    const onReveal = vi.fn();
    const notice = createHistoryWindowNotice({ hiddenCount: 10, onReveal });
    document.body.replaceChildren(notice);

    expect(notice.getAttribute("aria-label")).toMatch(/Earlier|更早/);
    notice.querySelector("button").click();
    expect(onReveal).toHaveBeenCalledOnce();

    const status = createHistoryLoadedStatus();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.tabIndex).toBe(-1);
    expect(status.textContent).toMatch(/loaded|加载/);
  });
});
