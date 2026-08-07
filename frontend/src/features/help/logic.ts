export const HELP_DEFAULT_PAGE = "getting-started";

export interface HelpPage {
  id: string;
  title: string;
  section?: string;
  file: string;
  summary?: string;
  keywords?: string[];
}

export interface HelpManifest {
  pages: HelpPage[];
  sections?: string[];
}

export function slugify(value: string): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function sectionIcon(section: string): string {
  const value = String(section || "").toLowerCase();
  if (
    value.includes("start") ||
    value.includes("guide") ||
    value.includes("开始") ||
    value.includes("指南")
  ) {
    return "✦";
  }
  if (value.includes("scene") || value.includes("场景") || value.includes("config")) return "◫";
  if (value.includes("plugin") || value.includes("插件")) return "◇";
  if (value.includes("note") || value.includes("笔记")) return "▤";
  if (value.includes("finance") || value.includes("金融")) return "⌁";
  if (value.includes("artifact") || value.includes("产物")) return "⬡";
  if (value.includes("workflow") || value.includes("效率") || value.includes("工作流")) return "↯";
  if (value.includes("reference") || value.includes("参考") || value.includes("support")) return "?";
  return "•";
}

export function matchesSearch(page: HelpPage, query: string): boolean {
  if (!query) return true;
  return [page.title, page.section, page.summary, ...(page.keywords || [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

export function readingMinutes(markdown: string): number {
  return Math.max(1, Math.ceil(markdown.replace(/[#*`>|[\]()_-]/g, "").length / 700));
}

export function helpLocale(locale: string): "en" | "zh-CN" {
  return locale === "en" ? "en" : "zh-CN";
}
