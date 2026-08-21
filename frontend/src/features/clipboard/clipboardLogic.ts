// Shared helpers for the Clipboard inbox feature.

import { t } from "../../shared/i18n";

export interface ClipboardItem {
  id: string;
  text: string;
  kind: string;
  source: string;
  createdAt: string;
}

export function isOpenableUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(String(text ?? "").trim());
}

export function openableUrl(text: string): string | null {
  const value = String(text ?? "").trim();
  return isOpenableUrl(value) ? value : null;
}

export function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 60 * 1000) return t("Just now");
  if (deltaMs < 60 * 60 * 1000) {
    return t("{count}m ago").replace(
      "{count}",
      String(Math.floor(deltaMs / (60 * 1000))),
    );
  }
  if (deltaMs < 24 * 60 * 60 * 1000) {
    return t("{count}h ago").replace(
      "{count}",
      String(Math.floor(deltaMs / (60 * 60 * 1000))),
    );
  }
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return t("Yesterday");
  }
  return date.toLocaleString();
}
