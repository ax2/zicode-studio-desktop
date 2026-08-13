// Shared helpers for the Clipboard inbox feature.

export interface ClipboardItem {
  id: string;
  text: string;
  kind: string;
  source: string;
  createdAt: string;
}

export function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
