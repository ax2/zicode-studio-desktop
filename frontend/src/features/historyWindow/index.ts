import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { t } from "../../shared/i18n";
import {
  HistoryLoadedStatusContent,
  HistoryWindowNoticeContent,
} from "./HistoryWindowNotices";

export {
  createHistoryWindow,
  DEFAULT_HISTORY_BATCH_SIZE,
  type HistoryMessage,
  type HistoryWindow,
} from "./historyWindowLogic";

export function createHistoryWindowNotice({
  hiddenCount,
  onReveal,
  documentRef = document,
}: {
  hiddenCount: number;
  onReveal?: () => void;
  documentRef?: Document;
}): HTMLElement | null {
  if (!(hiddenCount > 0) || typeof onReveal !== "function") return null;
  const notice = documentRef.createElement("aside");
  notice.className = "history-window-notice";
  notice.setAttribute("aria-label", t("Earlier conversation"));
  const root = createRoot(notice);
  flushSync(() => {
    root.render(createElement(HistoryWindowNoticeContent, { onReveal }));
  });
  return notice;
}

export function createHistoryLoadedStatus({
  documentRef = document,
}: {
  documentRef?: Document;
} = {}): HTMLElement {
  const status = documentRef.createElement("p");
  status.className = "history-window-loaded";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  const root = createRoot(status);
  flushSync(() => {
    root.render(createElement(HistoryLoadedStatusContent));
  });
  return status;
}
