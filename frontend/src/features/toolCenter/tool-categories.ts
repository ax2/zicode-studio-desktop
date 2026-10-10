import { t } from "../../shared/i18n";

// Shared taxonomy of tool.directory.v1; no provider-specific inference from IDs.
export function toolCategoryTitle(id: string): string {
  const labels: Record<string, string> = {
    text: "Text tools", data: "Data tools", web: "Web tools", code: "Code tools",
    files: "File tools", media: "Media tools", system: "System tools", ai: "AI tools",
    knowledge: "Knowledge tools", automation: "Automation tools", security: "Security tools",
    other: "Other tools", uncategorized: "Uncategorized tools",
  };
  return Object.hasOwn(labels, id) ? t(labels[id]) : id;
}
