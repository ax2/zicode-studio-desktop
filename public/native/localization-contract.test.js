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
      "Agent Inbox",
      "Manage in Task app",
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

  it("keeps React feature labels inside the shared t() pipeline", () => {
    const contextLogic = read(
      "frontend/src/features/contextUsage/contextUsageLogic.ts",
    );
    for (const key of ["Cached (reused)", "Uncached", "Available"]) {
      expect(contextLogic).toContain(`t("${key}")`);
      expect(contextLogic).not.toMatch(new RegExp(`label: "${key}"`));
    }
    expect(read("frontend/src/features/contextUsage/ContextUsageApp.tsx")).toContain(
      't("% used")',
    );
    expect(read("frontend/src/features/contextUsage/index.ts")).toContain(
      't("Context usage")',
    );
    expect(read("frontend/src/features/composer/ComposerApp.tsx")).toContain(
      't("Steering")',
    );
    expect(read("frontend/src/features/composer/ComposerApp.tsx")).toContain(
      't("Follow-up")',
    );
    expect(read("frontend/src/features/notificationCenter/index.ts")).toContain(
      't("Notification")',
    );
  });

  it("localizes super-agent task events, loading, and empty states", () => {
    const taskState = read("public/super-agent/task-state.js");
    for (const key of [
      "Dispatched to project agent on port {port}.",
      "Marked ready for project-agent dispatch.",
      "Dispatched to project agent (session {session}).",
      "Child session bound: {session}.",
      "Task marked {status}.",
      "Task paused by the user.",
      "Task resumed and queued for dispatch.",
      "Task cancelled by the user.",
    ]) {
      expect(taskState).toContain(`t("${key}")`);
    }
    expect(taskState).not.toMatch(/Task paused by the user\."\s*}$/);

    const runtime = read("public/components/super-agent-runtime.js");
    expect(runtime).toContain('t("Connecting...")');
    expect(runtime).toContain('t("Tasks from external messages and automations are approved here.")');
    expect(runtime).toContain('t("Manage everything in the Task app.")');
    expect(runtime).toContain('t(\'No tasks with status "{status}"…\')');
    expect(runtime).toContain("t(event.type");
    expect(runtime).toContain("t(event.message");

    expect(read("frontend/src/features/tasks/TaskCenterApp.tsx")).toContain(
      "t(event.message || (event.status ? statusLabel(event.status) : \"event\"))",
    );
  });

  it("localizes plugin surfaces and the image lightbox", () => {
    const lightbox = read("public/ui/image-lightbox.js");
    expect(lightbox).toContain('t("Image preview")');
    expect(lightbox).toContain('t("Close")');
    expect(lightbox).not.toMatch(/setAttribute\("aria-label", "Image preview"\)/);
    expect(lightbox).not.toMatch(/setAttribute\("aria-label", "Close"\)/);

    const shell = read("public/native/plugins/plugin-shell.js");
    expect(shell).toContain("desc: t(plugin.description)");
    expect(shell).not.toMatch(/desc: plugin\.description/);
    expect(shell).toContain('t("Plugin views")');
    expect(shell).not.toMatch(/setAttribute\("aria-label", "Plugin views"\)/);
  });

  it("keeps every builtin plugin registry string in the dictionary", () => {
    const registry = read("public/native/plugins/plugin-registry.js");
    const dictionary = read("public/i18n.js");
    const keys = new Set();
    for (const match of dictionary.matchAll(
      /(?:^|\s)(?:"([^"]+)"|([A-Za-z][A-Za-z0-9 _.\-/{}%…"']*))\s*:/gm,
    )) {
      const key = (match[1] || match[2] || "").trim();
      if (key && key.length > 1) keys.add(key);
    }
    const strings = new Set(
      [...registry.matchAll(/(name|description|title|label|action|items):\s*"([^"]+)"/g)]
        .map((match) => match[2])
        .concat(
          [...registry.matchAll(/items:\s*\[([^\]]+)\]/g)].flatMap((match) =>
            [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]),
          ),
        )
        .filter((value) => /[A-Za-z]{2}/.test(value)),
    );
    const missing = [...strings].filter((value) => !keys.has(value));
    expect(missing).toEqual([]);
  });

  it("localizes session and project context menu labels", () => {
    const app = read(
      "frontend/src/features/sessionSidebar/SessionSidebarApp.tsx",
    );
    expect(app).toContain("{t(row.label)}");
    expect(app).not.toMatch(/^\s*\{row\.label\}\s*$/m);

    const sidebar = read("frontend/src/features/sessionSidebar/index.ts");
    const dictionary = read("public/i18n.js");
    const keys = new Set();
    for (const match of dictionary.matchAll(
      /(?:^|\s)(?:"([^"]+)"|([A-Za-z][A-Za-z0-9 _.\-/{}%…"']*))\s*:/gm,
    )) {
      const key = (match[1] || match[2] || "").trim();
      if (key && key.length > 1) keys.add(key);
    }
    const labels = new Set(
      [...sidebar.matchAll(/\blabel:\s*"([^"]+)"/g)].map((match) => match[1]),
    );
    const missing = [...labels].filter(
      (label) => !keys.has(label) && !label.includes("${"),
    );
    expect(missing).toEqual([]);
  });

  it("keeps dynamic service menu keys in the dictionary", () => {
    const header = read("public/components/sa-chat-header.js");
    expect(header).toContain(`t(\`\${capitalize(service)} settings\`)`);
    expect(header).toContain(
      `t(\`\${capitalize(service)} is not configured\`)`,
    );
    const dictionary = read("public/i18n.js");
    for (const key of [
      "Feishu settings",
      "Wecom settings",
      "Feishu is not configured",
      "Wecom is not configured",
    ]) {
      expect(dictionary).toContain(`"${key}"`);
    }
  });

  it("keeps every known zh-gap string translated (English must not leak into the Chinese UI)", () => {
    const dictionary = read("public/i18n.js");
    const keys = new Set();
    for (const match of dictionary.matchAll(
      /(?:^|\s)(?:"([^"]+)"|'([^']+)'|([A-Za-z][A-Za-z0-9 _.\-/{}%…"']*))\s*:/gm,
    )) {
      const key = (match[1] || match[2] || match[3] || "").trim();
      if (key && key.length > 1) keys.add(key);
    }
    for (const key of [
      "Open link",
      "Refresh QR code",
      "Organize conversation into note",
      "Save exchange to Notes",
      "There is no conversation to organize",
      "The conversation-note skill could not be loaded",
      "Use the conversation-note skill below and output only the note body in Markdown.",
      "Empty the recycle bin? {count} entries will be permanently deleted.",
      "Upcoming event",
      "Upcoming events",
    ]) {
      expect(keys.has(key)).toBe(true);
    }
  });
});
