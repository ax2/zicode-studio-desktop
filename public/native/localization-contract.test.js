import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative) =>
  readFileSync(join(process.cwd(), relative), "utf8");

describe("vanilla UI localization contract", () => {
  it("keeps code-block copy labels inside the shared t() pipeline", () => {
    const source = read("public/ui/markdown.js");
    for (const key of [
      "Copy",
      "Copy code",
      "Copying…",
      "Copied",
      "Code copied",
      "Copy failed",
      "Scrollable table",
    ]) {
      expect(source).toContain(`t("${key}")`);
    }
    expect(source).toMatch(
      /textContent\s*=\s*t\(\s*"Unable to copy code\. Check browser clipboard permission\."\s*,?\s*\)/,
    );
    // Raw literals must not appear outside the translation call.
    expect(source).not.toMatch(/>Copy</);
    expect(source).not.toMatch(/textContent = "Copied"/);
  });

  it("keeps super-agent task panel labels inside the shared t() pipeline", () => {
    const source = read("public/components/super-agent-runtime.js");
    for (const key of [
      "Tasks",
      "All",
      "Pending",
      "Running",
      "Done",
      "Force Cancel",
      "Target",
      "Project",
      "Retry",
      "History",
      "Clear",
      "View Session",
      "Dismiss",
      "Waiting for input.",
      "Waiting for the agent session to start…",
      "Choose a project when creating this task.",
    ]) {
      expect(source).toContain(`t("${key}")`);
    }
    expect(source).not.toMatch(/>Tasks</);
    expect(source).not.toMatch(/>Force Cancel</);
  });

  it("localizes the super-agent entry and chat header labels", () => {
    expect(read("public/components/super-agent-entry.js")).toContain(
      't("Agent Inbox")',
    );
    expect(read("public/components/sa-chat-header.js")).toContain(
      't("Listening")',
    );
    expect(read("public/components/super-agent-entry.js")).not.toMatch(
      />AGENT INBOX</,
    );
  });

  it("localizes the startup failure page for Chinese users", () => {
    const html = read("public/bootstrap.html");
    expect(html).toContain("无法启动");
    expect(html).toContain("重试启动");
    expect(html).toContain("zicode-studio-locale");
  });
});
