export const DEFAULT_HISTORY_BATCH_SIZE = 80;

export interface HistoryMessage {
  role: string;
  content?: unknown;
}

export interface HistoryWindow {
  setMessages(
    nextMessages: HistoryMessage[],
    options?: { reset?: boolean },
  ): void;
  revealPrevious(): boolean;
  revealAll(): void;
  readonly hiddenCount: number;
  readonly visibleMessages: HistoryMessage[];
}

function normalizeBatchSize(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_HISTORY_BATCH_SIZE;
}

function findTurnStart(messages: HistoryMessage[], candidate: number): number {
  if (candidate <= 0) return 0;
  for (let index = Math.min(candidate, messages.length - 1); index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return 0;
}

export function createHistoryWindow({
  batchSize = DEFAULT_HISTORY_BATCH_SIZE,
}: {
  batchSize?: number;
} = {}): HistoryWindow {
  const size = normalizeBatchSize(batchSize);
  let messages: HistoryMessage[] = [];
  let start = 0;
  let initialized = false;

  function resetStart() {
    start = findTurnStart(messages, Math.max(0, messages.length - size));
  }

  return {
    setMessages(nextMessages, { reset = false } = {}) {
      const previousVisibleCount = messages.length - start;
      messages = Array.isArray(nextMessages) ? nextMessages : [];
      if (!initialized || reset) {
        initialized = true;
        resetStart();
        return;
      }
      const visibleCount = Math.max(size, previousVisibleCount);
      start = findTurnStart(messages, Math.max(0, messages.length - visibleCount));
    },
    revealPrevious() {
      if (start === 0) return false;
      const candidate = Math.max(0, start - size);
      const nextStart = findTurnStart(messages, candidate);
      start = nextStart < start ? nextStart : 0;
      return true;
    },
    revealAll() {
      start = 0;
    },
    get hiddenCount() {
      return start;
    },
    get visibleMessages() {
      return messages.slice(start);
    },
  };
}
