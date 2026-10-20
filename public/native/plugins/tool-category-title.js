import { t } from "i18n";

// tool.directory.v1 taxonomy; unknown provider IDs remain visible as declared.
const CATEGORY_TITLES = {
  text: "Text tools", data: "Data tools", web: "Web tools", code: "Code tools",
  files: "File tools", media: "Media tools", system: "System tools", ai: "AI tools",
  knowledge: "Knowledge tools", automation: "Automation tools", security: "Security tools",
  other: "Other tools", uncategorized: "Uncategorized tools",
};

export function toolCategoryName(id) {
  return Object.hasOwn(CATEGORY_TITLES, id) ? CATEGORY_TITLES[id] : id;
}

export function toolCategoryTitle(id) {
  return t(toolCategoryName(id));
}
