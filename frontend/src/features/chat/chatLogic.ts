import { t } from "../../shared/i18n";

export interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  mimeType?: string;
}

export function describeModelError(message: { errorMessage?: string; error?: string } = {}) {
  const raw = String(message?.errorMessage || message?.error || "");
  const quotaFailure = /insufficient_user_quota|预扣费额度失败|insufficient\s+(?:user\s+)?quota/i.test(
    raw,
  );
  const available = raw.match(/用户剩余额度\s*[:：]\s*[＄$]?\s*([\d.]+)/i)?.[1];
  const required = raw.match(/需要预扣费额度\s*[:：]\s*[＄$]?\s*([\d.]+)/i)?.[1];

  if (quotaFailure) {
    return {
      kind: "quota",
      title: t("QVeris quota is insufficient"),
      summary: t("The model service could not reserve enough balance for this request."),
      suggestion: t(
        "Try a less expensive model, start a new conversation to reduce context, or top up QVeris.",
      ),
      metrics: [
        available ? { label: t("Available balance"), value: `$${available}` } : null,
        required ? { label: t("Required reservation"), value: `$${required}` } : null,
      ].filter(Boolean),
    };
  }

  if (/\b401\b|unauthorized|invalid[_ -]?api[_ -]?key|authentication/i.test(raw)) {
    return {
      kind: "authentication",
      title: t("Model authentication failed"),
      summary: t("The model gateway rejected the configured credential."),
      suggestion: t("Update the API key in the current scene and try again."),
      metrics: [],
    };
  }

  if (/\b429\b|rate[_ -]?limit|too many requests/i.test(raw)) {
    return {
      kind: "rate-limit",
      title: t("The model service is busy"),
      summary: t("The request was rate limited by the model gateway."),
      suggestion: t("Wait a moment, then try again or choose another model."),
      metrics: [],
    };
  }

  if (
    /context[_ -]?(?:length|window|size).*(?:exceed|too (?:long|large)|full)|prompt is too long|maximum context/i.test(
      raw,
    )
  ) {
    return {
      kind: "context-length",
      title: t("Conversation is too long for this model"),
      summary: t("The request exceeded the model's context window."),
      suggestion: t("Start a new conversation or compact the context, then try again."),
      metrics: [],
    };
  }

  return {
    kind: "generic",
    title: t("Model request failed"),
    summary: t("The model did not return a usable response."),
    suggestion: t("Check the current scene's model channel, then try again."),
    metrics: [],
  };
}

export function cleanChatTranscript(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const lineRe = /^- (?:\[[\dT:.Z+-]+\] )?\[uid:[^\]]+\] ([^:]+): (.*)$/;
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const parsed = lines.map((l) => {
    const m = l.match(lineRe);
    return m ? { name: m[1].trim(), text: m[2] } : null;
  });
  if (parsed.some((p) => p === null)) return null;
  const names = [...new Set(parsed.map((p) => p?.name))];
  if (names.length === 1) {
    return parsed.map((p) => p?.text).join("\n");
  }
  return parsed.map((p) => `**${p?.name}**: ${p?.text}`).join("\n\n");
}

export function splitStreamingContent(content: unknown): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };
  let text = "";
  let thinking = "";
  for (const block of content as ContentBlock[]) {
    if (block?.type === "text") text += block.text ?? "";
    else if (block?.type === "thinking") thinking += block.thinking ?? "";
  }
  return { text, thinking };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getArgsPreview(_toolName: string, args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  if (args.path) return String(args.path);
  if (args.command) return String(args.command).substring(0, 80);
  if (args.query) return String(args.query).substring(0, 60);
  if (args.url) return String(args.url);
  for (const val of Object.values(args)) {
    if (typeof val === "string" && val.length > 0) {
      return val.substring(0, 60);
    }
  }
  return "";
}

export function formatJson(obj: unknown): string {
  try {
    if (obj && typeof obj === "object" && Object.keys(obj as Record<string, unknown>).length === 0) {
      return "";
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function formatResult(result: unknown): string {
  if (!result) return "";
  const record = result as {
    content?: Array<{ type?: string; text?: string }>;
  };
  if (record.content && Array.isArray(record.content)) {
    return record.content
      .map((block) => {
        if (block.type === "text") return block.text ?? "";
        return JSON.stringify(block);
      })
      .join("\n");
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Maps known tool-runtime errors to a friendly, localized message so a failed
 * tool call does not surface a raw `[runtime_stopped] …` string to the user.
 * Returns null when no friendly mapping exists; callers then fall back to the
 * original output.
 */
export function friendlyToolError(output: unknown): string | null {
  const raw = String(output ?? "").trim();
  if (!raw) return null;
  if (/runtime[_ -]?stopped|broker token.*no longer active/i.test(raw)) {
    return t("The session runtime stopped before the tool finished. Retry to run it again.");
  }
  if (/broker[_ -]?token.*(invalid|expired)|broker_token_invalid/i.test(raw)) {
    return t("The tool session expired. Retry to run it again.");
  }
  if (/tool[_ -]?unavailable|tool.*(missing|disabled)/i.test(raw)) {
    return t("This tool is unavailable in the current scene.");
  }
  return null;
}

export interface DiffLine {
  kind: "removed" | "added";
  text: string;
}

export function renderDiffData(oldText: string, newText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const line of oldText.split("\n")) {
    lines.push({ kind: "removed", text: `- ${line}` });
  }
  for (const line of newText.split("\n")) {
    lines.push({ kind: "added", text: `+ ${line}` });
  }
  return lines;
}
