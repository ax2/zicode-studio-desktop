import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRenderer } from "./message-renderer.js";

describe("MessageRenderer streaming markdown preview", () => {
  let container;
  let renderer;

  beforeEach(() => {
    container = document.createElement("div");
    renderer = new MessageRenderer(container);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });

  it("renders markdown live during streaming updates", () => {
    const el = renderer.renderAssistantMessage({ content: "" }, true);
    renderer.updateStreamingMessage(el, "hello **bold te");

    const content = el.querySelector(".message-content");
    expect(content.innerHTML).toContain("<strong>bold te</strong>");
  });

  it("finalizes from the raw text, not the rendered DOM", () => {
    const el = renderer.renderAssistantMessage({ content: "" }, true);
    renderer.updateStreamingMessage(el, "a **bold** word and `code`");
    renderer.finalizeStreamingMessage(el);

    const content = el.querySelector(".message-content");
    expect(content.innerHTML).toContain("<strong>bold</strong>");
    expect(content.innerHTML).toContain("<code>code</code>");
  });

  it("does not add a copy footer to empty finalized streaming messages", () => {
    const el = renderer.renderAssistantMessage({ content: "" }, true);

    renderer.finalizeStreamingMessage(el);

    expect(el.querySelector(".message-footer")).toBeNull();
    expect(el.querySelector(".message-copy-btn")).toBeNull();
  });

  it("keeps a partial code block previewing as a code block", () => {
    const el = renderer.renderAssistantMessage({ content: "" }, true);
    renderer.updateStreamingMessage(el, "```js\nconst a = 1;");

    const content = el.querySelector(".message-content");
    expect(content.querySelector(".code-block-wrapper")).not.toBeNull();
    expect(content.textContent).toContain("const a = 1;");
  });

  it("preserves the thinking block while streaming text", () => {
    const el = renderer.renderAssistantMessage({ content: "" }, true);
    renderer.updateStreamingThinking(el, "pondering...");
    renderer.updateStreamingMessage(el, "some *italic");

    expect(el.querySelector(".streaming-thinking")).not.toBeNull();
    expect(el.querySelector(".streaming-text").innerHTML).toContain("<em>italic</em>");
  });

  it("does not render raw HTML from streamed text", () => {
    const el = renderer.renderAssistantMessage({ content: "" }, true);
    renderer.updateStreamingMessage(el, "`<script>alert(1)</script>`");

    const content = el.querySelector(".message-content");
    expect(content.querySelector("script")).toBeNull();
  });

  it("copies assistant text without thinking label or content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const el = renderer.renderAssistantMessage(
      {
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "Visible answer" },
        ],
      },
      false,
      true,
    );

    el.querySelector(".message-copy-btn").click();

    expect(writeText).toHaveBeenCalledWith("Visible answer");
  });

  it("shares only the visible assistant answer through the system share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });

    const el = renderer.renderAssistantMessage(
      {
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "Visible answer" },
        ],
      },
      false,
      true,
    );

    el.querySelector(".message-share-btn").click();
    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledWith({ title: "ZiCode 回答", text: "Visible answer" });
    });
  });

  it("adds system sharing after a streamed answer finishes", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    const el = renderer.renderAssistantMessage({ content: "" }, true);
    renderer.updateStreamingMessage(el, "Streamed answer");

    renderer.finalizeStreamingMessage(el);
    el.querySelector(".message-share-btn").click();

    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledWith({ title: "ZiCode 回答", text: "Streamed answer" });
    });
  });

  it("does not render a share action when the browser has no Web Share API", () => {
    const el = renderer.renderAssistantMessage({ content: "Visible answer" }, false, true);

    expect(el.querySelector(".message-share-btn")).toBeNull();
  });

  it("copies the answer when the system share sheet fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("share unavailable"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const el = renderer.renderAssistantMessage({ content: "Fallback answer" }, false, true);

    el.querySelector(".message-share-btn").click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Fallback answer"));
    expect(el.querySelector(".message-share-btn").dataset.feedback).toBe("已复制");
  });

  it("treats closing the system share sheet as cancellation, not an error", async () => {
    const cancellation = new Error("cancelled");
    cancellation.name = "AbortError";
    const share = vi.fn().mockRejectedValue(cancellation);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const el = renderer.renderAssistantMessage({ content: "Cancelled answer" }, false, true);

    el.querySelector(".message-share-btn").click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));

    expect(writeText).not.toHaveBeenCalled();
    expect(el.querySelector(".message-share-btn").dataset.feedback).toBeUndefined();
  });

  it("renders a fork action for user messages with an entry id", () => {
    const events = [];
    container.addEventListener("messagefork", (event) => events.push(event.detail));

    renderer.renderUserMessage({ content: "Try this path", entryId: "entry-user-1" }, true);
    container.querySelector(".message-fork-btn").click();

    expect(events).toEqual([{ entryId: "entry-user-1" }]);
  });

  it("defers history image decoding without leaking a referrer", () => {
    renderer.renderUserMessage(
      {
        content: "Image context",
        images: [{ data: "AAAA", mimeType: "image/png" }],
      },
      true,
    );

    const image = container.querySelector(".message-image");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.src).toMatch(/^data:image\/png;base64,AAAA/);
  });

  it("offers one-click capture of a question and answer into Notes", () => {
    const events = [];
    container.addEventListener("savechattonotes", (event) => events.push(event.detail));
    renderer.renderUserMessage({ content: "How should we design this?" }, true);
    renderer.renderAssistantMessage({ content: "Use a two-way knowledge bridge." }, false, true);

    container.querySelector(".message-note-btn").click();

    expect(events).toEqual([
      {
        question: "How should we design this?",
        answer: "Use a two-way knowledge bridge.",
      },
    ]);
  });

  it("renders a friendly QVeris quota error with actionable details", () => {
    const opened = vi.fn();
    const retried = vi.fn();
    container.addEventListener("openmodelsettings", opened);
    container.addEventListener("retrylastrequest", retried);

    renderer.renderAssistantError({
      stopReason: "error",
      errorMessage:
        '403: {"message":"预扣费额度失败, 用户剩余额度: ＄1.326176, 需要预扣费额度: ＄2.151824","code":"insufficient_user_quota"}',
    });

    const card = container.querySelector(".model-error-card--quota");
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("QVeris 额度不足");
    expect(card.textContent).toContain("当前余额 $1.326176");
    expect(card.textContent).toContain("所需预扣 $2.151824");

    card.querySelector(".model-error-card__action").click();
    expect(opened).toHaveBeenCalledTimes(1);
    card.querySelector(".ui-button--primary").click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it("renders a safe generic fallback for unknown model errors", () => {
    renderer.renderAssistantError({ stopReason: "error", errorMessage: "upstream failed" });

    const card = container.querySelector(".model-error-card--generic");
    expect(card.textContent).toContain("模型请求失败");
    expect(card.textContent).not.toContain("upstream failed");
  });

  it("highlights keyword matches across rendered messages", () => {
    renderer.renderUserMessage({ content: "Alpha beta gamma" }, true);
    renderer.renderAssistantMessage({ content: "Beta appears twice: beta." }, false, true);

    const count = renderer.highlightSearchQuery("beta");
    const marks = container.querySelectorAll("mark");

    expect(count).toBe(3);
    expect(marks).toHaveLength(3);
    expect(marks[0].textContent.toLowerCase()).toBe("beta");
  });

  it("scrolls the first highlighted match into view", () => {
    renderer.renderAssistantMessage({ content: "jump to keyword" }, false, true);

    let scrolled = false;
    Element.prototype.scrollIntoView = () => {
      scrolled = true;
    };

    const count = renderer.highlightSearchQuery("keyword");

    expect(count).toBe(1);
    expect(scrolled).toBe(true);
  });

  it("can force-scroll after rendering session history", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => {
      callback();
      return 0;
    };
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 1200 });

    try {
      renderer.forceScrollToBottom();

      expect(container.scrollTop).toBe(1200);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  it("keeps the viewport when streaming updates arrive while the user is scrolled up", () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => {
      callback();
      return 0;
    };
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 400 });

    try {
      renderer.isNearBottom = false;
      container.scrollTop = 800;
      renderer.scrollToBottom();
      expect(container.scrollTop).toBe(800);

      renderer.isNearBottom = true;
      container.scrollTop = 800;
      renderer.scrollToBottom();
      expect(container.scrollTop).toBe(2000);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
