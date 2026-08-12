import { describe, expect, it } from "vitest";
import { setLocale } from "../../shared/i18n";
import {
  projectMarkdownFileName,
  renderProjectSessionsMarkdown,
  renderSessionMarkdown,
  sessionMarkdownFileName,
} from "./sessionMarkdown";

describe("session Markdown export", () => {
  it("renders user and assistant exchanges with thinking quotes and tool calls", () => {
    setLocale("en");
    const markdown = renderSessionMarkdown([
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        model: "deepseek-v4-flash",
        content: [
          { type: "thinking", thinking: "first line\nsecond line" },
          { type: "toolCall", name: "notes_search", arguments: {} },
          { type: "text", text: "Hi there" },
        ],
      },
    ]);
    expect(markdown).toContain("## User");
    expect(markdown).toContain("Hello");
    expect(markdown).toContain("## Assistant · deepseek-v4-flash");
    expect(markdown).toContain("> **Thinking**");
    expect(markdown).toContain("> first line");
    expect(markdown).toContain("> second line");
    expect(markdown).toContain("- `notes_search`");
    expect(markdown).toContain("Hi there");
  });

  it("prepends an optional document title as an H1 header", () => {
    setLocale("en");
    const markdown = renderSessionMarkdown(
      [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      { title: "Planning session" },
    );
    expect(markdown.startsWith("# Planning session\n")).toBe(true);
    expect(markdown).toContain("## User");
    // No title means no H1 header.
    expect(renderSessionMarkdown([]).startsWith("# ")).toBe(false);
  });

  it("skips empty messages and trailing whitespace-only output", () => {
    setLocale("en");
    expect(renderSessionMarkdown([]).trim()).toBe("");
    expect(renderSessionMarkdown([{ role: "user", content: [] }]).trim()).toBe("");
    expect(
      renderSessionMarkdown([{ role: "assistant", content: [{ type: "text", text: "x" }] }]).trim(),
    ).toBe("## Assistant\n\nx");
  });

  it("builds a safe filename from the session title", () => {
    setLocale("zh-CN");
    expect(sessionMarkdownFileName("会议: 2026/Q3", "019fb7c9fcee7336")).toBe(
      "会议- 2026-Q3-019fb7c9.md",
    );
    expect(sessionMarkdownFileName("", "abcd1234efgh")).toContain("abcd1234");
  });

  it("joins project sessions into one document with separators", () => {
    setLocale("en");
    const markdown = renderProjectSessionsMarkdown([
      { title: "Planning", body: "## User\n\nhello" },
      { title: "Build", body: "## Assistant\n\nok" },
    ]);
    expect(markdown).toContain("# Planning");
    expect(markdown).toContain("# Build");
    expect(markdown).toContain("\n\n---\n\n");
    expect(markdown).toContain("hello");
    expect(markdown).toContain("ok");
  });

  it("skips empty project sections and sanitizes the project filename", () => {
    setLocale("zh-CN");
    expect(renderProjectSessionsMarkdown([]).trim()).toBe("");
    expect(
      renderProjectSessionsMarkdown([{ title: "Empty", body: "  " }]).trim(),
    ).toBe("");
    expect(projectMarkdownFileName("研发: 2026/Q3")).toBe("研发- 2026-Q3.md");
    expect(projectMarkdownFileName("")).toBe("项目.md");
  });
});
