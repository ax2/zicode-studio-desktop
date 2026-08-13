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
