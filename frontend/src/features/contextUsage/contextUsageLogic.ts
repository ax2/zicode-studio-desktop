export interface UsageLike {
  input?: number;
  cacheRead?: number;
  contextWindow?: number;
}

export type ContextSegmentKey = "cache" | "input" | "free";

export interface ContextSegment {
  key: ContextSegmentKey;
  label: string;
  tokens: number;
  color: ContextSegmentKey;
}

export interface ContextVizModel {
  segments: ContextSegment[];
  percent: number;
  totalUsed: number;
  total: number;
}

export function formatTokens(value: unknown): string {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function usageTotal(usage: UsageLike | null | undefined): number {
  if (!usage) return 0;
  return (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0);
}

export function findLatestAssistantUsage(
  messages: Array<{
    role?: string;
    usage?: UsageLike;
    content?: unknown;
  }>,
): UsageLike | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.usage) return message.usage;
  }
  return null;
}

export function normalizeUsage(
  usage: UsageLike | null | undefined,
): UsageLike | null {
  if (!usage) return null;
  return {
    ...usage,
    input: Number(usage.input) || 0,
    cacheRead: Number(usage.cacheRead) || 0,
    contextWindow: Number(usage.contextWindow) || 0,
  };
}

export function computeContextViz(
  usage: UsageLike | null | undefined,
  contextWindowSize: number,
): ContextVizModel | null {
  if (!usage || contextWindowSize <= 0) return null;
  const input = Number(usage.input) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const total = contextWindowSize;
  const totalUsed = input + cacheRead;
  const free = Math.max(0, total - totalUsed);
  const segments: ContextSegment[] = [
    { key: "cache", label: "Cached (reused)", tokens: cacheRead, color: "cache" },
    { key: "input", label: "Uncached", tokens: input, color: "input" },
    { key: "free", label: "Available", tokens: free, color: "free" },
  ];
  return {
    segments,
    percent: Math.round((totalUsed / total) * 100),
    totalUsed,
    total,
  };
}
