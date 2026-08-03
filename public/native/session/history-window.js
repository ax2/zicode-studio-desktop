import { t } from "../../i18n.js";

export const DEFAULT_HISTORY_BATCH_SIZE = 80;

function normalizeBatchSize(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_HISTORY_BATCH_SIZE;
}

function findTurnStart(messages, candidate) {
  if (candidate <= 0) return 0;
  for (let index = Math.min(candidate, messages.length - 1); index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return 0;
}

export function createHistoryWindow({ batchSize = DEFAULT_HISTORY_BATCH_SIZE } = {}) {
  const size = normalizeBatchSize(batchSize);
  let messages = [];
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

export function createHistoryWindowNotice({ hiddenCount, onReveal, documentRef = document } = {}) {
  if (!(hiddenCount > 0) || typeof onReveal !== "function") return null;

  const notice = documentRef.createElement("aside");
  notice.className = "history-window-notice";
  notice.setAttribute("aria-label", t("Earlier conversation"));

  const copy = documentRef.createElement("span");
  copy.textContent = t("Earlier messages are folded to keep this conversation fast.");

  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary history-window-load";
  button.textContent = t("Load earlier messages");
  button.addEventListener("click", onReveal);

  notice.append(copy, button);
  return notice;
}

export function createHistoryLoadedStatus({ documentRef = document } = {}) {
  const status = documentRef.createElement("p");
  status.className = "history-window-loaded";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  status.textContent = t("All earlier messages loaded.");
  return status;
}
