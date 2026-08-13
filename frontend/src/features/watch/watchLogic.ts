// Shared helpers for the Web Watch feature.

export interface WatchItem {
  id: string;
  name: string;
  url: string;
  lastHash?: string;
  lastCheckedAt?: string;
  changeCount: number;
  createdAt: string;
}

export interface WatchCheckResult {
  id: string;
  changed: boolean;
  hash: string;
  contentLength: number;
  checkedAt: string;
  previousHash?: string;
  title?: string;
}

export function formatTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
