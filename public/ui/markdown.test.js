import { afterEach, describe, expect, it, vi } from "vitest";
import { initCodeCopyDelegation, renderMarkdown, renderStreamingMarkdown } from "./markdown.js";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("renderStreamingMarkdown", () => {
  it("renders complete markdown identically to renderMarkdown", () => {
    const text = "# Title\n\nSome **bold** and `code`.\n\n```js\nconst a = 1;\n```";
    expect(renderStreamingMarkdown(text)).toBe(renderMarkdown(text));
  });

  it("closes unterminated bold mid-stream", () => {
    const html = renderStreamingMarkdown("hello **bold te");
    expect(html).toContain("<strong>bold te</strong>");
    expect(html).not.toContain("**");
  });

  it("closes unterminated inline code mid-stream", () => {
    const html = renderStreamingMarkdown("run `npm inst");
    expect(html).toContain("<code>npm inst</code>");
  });

  it("renders an unterminated code fence as a code block", () => {
    const html = renderStreamingMarkdown("```js\nconst a = 1;\nconst b");
    expect(html).toContain("code-block-wrapper");
    expect(html).toContain("const a = 1;");
    expect(html).not.toContain("```");
  });

  it("handles a fence with no newline yet", () => {
    const html = renderStreamingMarkdown("```js");
    expect(html).toContain("code-block-wrapper");
  });

  it("shows only the label for a link whose URL is still streaming", () => {
    const html = renderStreamingMarkdown("see [the docs](https://exa");
    expect(html).toContain("the docs");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("streamdown:incomplete-link");
  });

  it("does not leak code block placeholders for a fenced block in a list item", () => {
    const markdown = "- ```js\nconst answer = 42;\n```";
    const html = renderStreamingMarkdown(markdown);

    expect(html).toContain("code-block-wrapper");
    expect(html).toContain("const answer = 42;");
    expect(html).not.toContain("%%CODEBLOCK_");
  });

  it("returns empty string for empty input", () => {
    expect(renderStreamingMarkdown("")).toBe("");
    expect(renderStreamingMarkdown(null)).toBe("");
  });
});

describe("renderMarkdown", () => {
  it("makes wide tables keyboard-scrollable and labeled", () => {
    const template = document.createElement("template");
    template.innerHTML = renderMarkdown("| Name | Value |\n| --- | --- |\n| Mobile | Ready |");
    const wrapper = template.content.querySelector(".table-wrapper");

    expect(wrapper.getAttribute("tabindex")).toBe("0");
    expect(wrapper.getAttribute("role")).toBe("region");
    expect(wrapper.getAttribute("aria-label")).toBe("Scrollable table");
  });

  it("renders an accessible code copy action", () => {
    const template = document.createElement("template");
    template.innerHTML = renderMarkdown("```js\nconst answer = 42;\n```");
    const button = template.content.querySelector("[data-copy-code]");

    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Copy code");
    expect(template.content.querySelector(".code-copy-status").getAttribute("role")).toBe("status");
  });

  it("announces successful code copies and restores the action", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown("```sh\necho mobile\n```");
    initCodeCopyDelegation(container);

    const button = container.querySelector("[data-copy-code]");
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("echo mobile");
    expect(button.textContent).toBe("Copied");
    expect(button.classList.contains("copied")).toBe(true);
    expect(container.querySelector(".code-copy-status").textContent).toBe("Code copied");
    vi.runAllTimers();
    expect(button.textContent).toBe("Copy");
    expect(button.disabled).toBe(false);
  });

  it("shows a friendly state when clipboard permission is denied", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) },
    });
    const container = document.createElement("div");
    container.innerHTML = renderMarkdown("```sh\necho private\n```");
    initCodeCopyDelegation(container);

    const button = container.querySelector("[data-copy-code]");
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(button.textContent).toBe("Copy failed");
    expect(button.classList.contains("failed")).toBe(true);
    expect(container.querySelector(".code-copy-status").textContent).toContain(
      "Check browser clipboard permission",
    );
    vi.runAllTimers();
  });

  it("loads inline images near the viewport and suppresses referrer metadata", () => {
    const html = renderMarkdown("![Architecture](https://images.example.test/diagram.png)");
    const template = document.createElement("template");
    template.innerHTML = html;
    const image = template.content.querySelector(".inline-image");

    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.alt).toBe("Architecture");
  });

  it("renders fenced code blocks whose language contains a hyphen", () => {
    const html = renderMarkdown('```acceptance-report\n{"criteriaSatisfied": []}\n```');

    expect(html).toContain("code-block-wrapper");
    expect(html).toContain("acceptance-report");
    expect(html).toContain("&quot;criteriaSatisfied&quot;");
    expect(html).not.toContain("```acceptance-report");
  });

  it("does not leak code block placeholders for unordered or ordered list items", () => {
    for (const marker of ["-", "1."]) {
      const html = renderMarkdown(`${marker} \`\`\`sh\necho ok\n\`\`\``);

      expect(html).toContain("code-block-wrapper");
      expect(html).toContain("echo ok");
      expect(html).not.toContain("%%CODEBLOCK_");
    }
  });
});
