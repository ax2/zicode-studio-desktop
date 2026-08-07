import { t } from "../../shared/i18n.js";

export interface ArtifactDescriptor {
  id: string;
  handle: string;
  sceneId: string;
  pluginId: string;
  kind: string;
  title: string;
  summary?: string | null;
  createdAt: string;
  mimeType: string;
  size: number;
  version: string;
  provenance?: unknown;
}

export interface ArtifactDocument extends ArtifactDescriptor {
  content?: unknown;
}

export const EMPTY_ARTIFACT_SNAPSHOT = Object.freeze({
  artifacts: [] as ArtifactDescriptor[],
  kinds: [] as string[],
  plugins: [] as string[],
});

export function pluginLabel(value: string): string {
  const labels: Record<string, string> = {
    "com.zicode.finance": t("Finance"),
    "com.zicode.notes": t("Notes"),
    "com.zicode.artifacts": t("Artifacts"),
  };
  return labels[value] ?? value;
}

export function kindLabel(value: string): string {
  const labels: Record<string, string> = {
    report: "Reports",
    chart: "Charts",
    dataset: "Datasets",
    file: "Files",
  };
  return labels[value] ?? value;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
}

export function markdownContent(artifact: ArtifactDocument): string | null {
  if (artifact.mimeType !== "text/markdown") return null;
  if (typeof artifact.content === "string") return artifact.content;
  if (typeof (artifact.content as { markdown?: unknown })?.markdown === "string") {
    return (artifact.content as { markdown: string }).markdown;
  }
  return null;
}

export function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

export function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .split("")
      .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
      .join("")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "artifact"
  );
}

export function defaultDownloadFile(fileName: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
