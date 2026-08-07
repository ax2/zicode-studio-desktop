export interface DialogPreview {
  number: string;
  label: string;
  content: string;
}

export interface DialogContent {
  header: string;
  title: string;
  body: string;
  previews: DialogPreview[];
}

export interface DialogOption {
  number: string;
  label: string;
  description: string;
}

export interface NativeDialogRequest {
  method?: string;
  title?: string;
  message?: string;
  options?: unknown[];
  prefill?: string;
  placeholder?: string;
  timeout?: number;
}

export function parsePreviewBlocks(text: string): DialogPreview[] {
  return [
    ...text.matchAll(
      /\n\n--- (\d+)\. (.+?) preview ---\n([\s\S]*?)(?=\n\n--- \d+\. .+? preview ---\n|$)/g,
    ),
  ].map((match) => ({
    number: match[1],
    label: match[2],
    content: match[3].trim(),
  }));
}

export function parseDialogContent(request: NativeDialogRequest): DialogContent {
  const rawTitle = String(request.title || "");
  const previewStart = rawTitle.search(/\n\n--- \d+\. .+? preview ---\n/);
  const visibleTitle = previewStart >= 0 ? rawTitle.slice(0, previewStart) : rawTitle;
  const previews = previewStart >= 0 ? parsePreviewBlocks(rawTitle.slice(previewStart)) : [];
  const lines = visibleTitle.split(/\n+/).map((line) => line.trim());
  const titleLine = lines.shift() || "";
  const headerMatch = titleLine.match(/^\[([^\]]+)]\s*(.*)$/);
  return {
    header: headerMatch?.[1] ?? "",
    title: headerMatch?.[2] ?? titleLine,
    body: lines.filter(Boolean).join("\n\n"),
    previews,
  };
}

export function parseOption(value: unknown): DialogOption {
  const text = String(value ?? "");
  const match = text.match(/^(\d+)\.\s+(.+?)(?:\s+[—-]\s+(.+))?$/);
  if (!match) return { number: "", label: text, description: "" };
  return {
    number: match[1],
    label: match[2],
    description: match[3] ?? "",
  };
}

export function defaultTitle(method: string | undefined): string {
  return method === "confirm" ? "Confirm" : method === "editor" ? "Editor" : "Input";
}
