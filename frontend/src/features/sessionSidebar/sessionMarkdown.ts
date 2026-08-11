import { t } from "../../shared/i18n";

interface SessionMessageBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
}

interface SessionMessage {
  role?: string;
  model?: string;
  content?: SessionMessageBlock[];
}

/**
 * Render a session transcript (the `read_session_messages` payload) as a
 * readable Markdown document: one section per user/assistant exchange, with
 * thinking blocks quoted and tool calls listed compactly.
 */
export function renderSessionMarkdown(messages: unknown[]): string {
  const lines: string[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as SessionMessage;
    const role = message.role;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const texts: string[] = [];
    const thinking: string[] = [];
    const tools: string[] = [];
    for (const block of blocks) {
      if (block?.type === "thinking" && block.thinking) {
        thinking.push(block.thinking);
      } else if (block?.type === "toolCall" && block.name) {
        tools.push(`- \`${block.name}\``);
      } else if (block?.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
    if (texts.length === 0 && thinking.length === 0 && tools.length === 0) {
      continue;
    }
    if (role === "user") {
      lines.push(`## ${t("User")}`);
      for (const text of texts) lines.push("", text);
    } else {
      lines.push(`## ${t("Assistant")}${message.model ? ` · ${message.model}` : ""}`);
      if (thinking.length > 0) {
        lines.push("", `> **${t("Thinking")}**`, ">");
        for (const block of thinking) {
          for (const line of block.split("\n")) lines.push(`> ${line}`);
        }
      }
      for (const text of texts) lines.push("", text);
      if (tools.length > 0) {
        lines.push("", `**${t("Tools")}**`, ...tools);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** A filesystem-safe Markdown filename derived from the session title. */
export function sessionMarkdownFileName(
  name: string | undefined,
  sessionId: string,
): string {
  const base =
    (name || "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() ||
    t("Conversation");
  const safe = base.slice(0, 60);
  return `${safe}-${sessionId.slice(0, 8)}.md`;
}
