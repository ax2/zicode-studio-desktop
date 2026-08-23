// Conversation starter templates shown on the welcome screen.
//
// Labels and prompts are English source strings passed through the shared
// i18n pipeline (t()), so zh-CN translations live in public/i18n.js and the
// composer receives the localized text. Prompt strings must stay on a single
// line because t() collapses whitespace before dictionary lookup.

export interface ChatTemplate {
  id: string;
  icon: string;
  label: string;
  prompt: string;
}

const CUSTOM_TEMPLATES_KEY = "zicode-chat-templates-custom";

export const CHAT_TEMPLATES: readonly ChatTemplate[] = [
  {
    id: "write-blog",
    icon: "✍️",
    label: "Write a tech blog post",
    prompt:
      "Write a technical blog article. Topic: … Requirements: clear structure, concrete examples, concise professional language.",
  },
  {
    id: "translate",
    icon: "🌐",
    label: "Translate text",
    prompt:
      "Translate the text below into the target language, keeping the original meaning and natural phrasing: …",
  },
  {
    id: "organize-notes",
    icon: "📝",
    label: "Organize into notes",
    prompt:
      "Turn the content below into well-structured notes: extract the key points and keep the essential information: …",
  },
  {
    id: "review-code",
    icon: "🔍",
    label: "Review code",
    prompt:
      "Review the code below. Point out issues and suggest concrete improvements: …",
  },
  {
    id: "brainstorm",
    icon: "💡",
    label: "Brainstorm ideas",
    prompt:
      "Brainstorm around the following topic: give as many ideas as possible, then rank the most promising ones: …",
  },
  {
    id: "analyze",
    icon: "📊",
    label: "Analyze data",
    prompt:
      "Analyze the following data or problem and give conclusions and recommendations: …",
  },
];

/**
 * Read user-defined templates from localStorage. Malformed or non-array
 * payloads are ignored so a corrupt value can never break the welcome screen.
 */
export function loadCustomTemplates(): ChatTemplate[] {
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.label === "string" &&
          typeof entry.prompt === "string" &&
          entry.label.trim() &&
          entry.prompt.trim(),
      )
      .map((entry) => ({
        id: entry.id,
        icon:
          typeof entry.icon === "string" && entry.icon.trim()
            ? entry.icon.trim()
            : "📝",
        label: entry.label.trim(),
        prompt: entry.prompt.trim(),
      }));
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: ChatTemplate[]): void {
  try {
    globalThis.localStorage?.setItem(
      CUSTOM_TEMPLATES_KEY,
      JSON.stringify(templates),
    );
  } catch {
    // Storage can be unavailable (private mode / sandboxed webviews); the
    // welcome screen simply falls back to built-in templates.
  }
}

export function createTemplateId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Built-in templates first, then user-defined templates. */
export function allChatTemplates(): ChatTemplate[] {
  return [...CHAT_TEMPLATES, ...loadCustomTemplates()];
}

interface ChatTemplateBackupEntry {
  id?: string;
  icon?: string;
  label: string;
  prompt: string;
}

/**
 * Serialize custom templates for backup or cross-device migration. The
 * payload carries a version marker so future formats stay distinguishable.
 */
export function exportCustomTemplates(): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: loadCustomTemplates().map(({ id, icon, label, prompt }) => ({
        id,
        icon,
        label,
        prompt,
      })),
    },
    null,
    2,
  );
}

/**
 * Import templates from an exported payload (or a bare array). Entries whose
 * id already exists are skipped so re-imports never duplicate; malformed
 * entries are filtered out. Returns how many were added/skipped.
 */
export function importCustomTemplates(json: string): {
  added: number;
  skipped: number;
} {
  const parsed = JSON.parse(json) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { templates?: unknown })?.templates)
      ? (parsed as { templates: unknown[] }).templates
      : [];
  const incoming: ChatTemplate[] = list
    .filter(
      (entry) =>
        entry &&
        typeof entry.label === "string" &&
        typeof entry.prompt === "string" &&
        entry.label.trim() &&
        entry.prompt.trim(),
    )
    .map((entry) => ({
      id:
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : createTemplateId(),
      icon:
        typeof entry.icon === "string" && entry.icon.trim()
          ? entry.icon.trim()
          : "📝",
      label: entry.label.trim(),
      prompt: entry.prompt.trim(),
    }));
  const existing = loadCustomTemplates();
  const existingIds = new Set(existing.map((template) => template.id));
  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    if (existingIds.has(entry.id)) {
      skipped += 1;
      continue;
    }
    existing.push(entry);
    existingIds.add(entry.id);
    added += 1;
  }
  if (added > 0) saveCustomTemplates(existing);
  return { added, skipped };
}
