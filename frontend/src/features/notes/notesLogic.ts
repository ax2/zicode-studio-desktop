import { t } from "../../shared/i18n";

export const NOTES_PLUGIN_ID = "com.zicode.notes";
export const DEFAULT_NOTEBOOK_ICON = "📓";
export const DEFAULT_NOTE_ICON = "📝";
export const AUTOSAVE_DELAY_MS = 2500;

export interface NoteSummary {
  id: string;
  notebookId: string;
  title: string;
  icon?: string;
  updatedAt?: string;
  source?: { url?: string };
  version?: number;
  tags?: string[];
}

export interface Note extends NoteSummary {
  content: string;
  tags: string[];
  createdAt?: string;
}

export interface Notebook {
  id: string;
  title: string;
  icon?: string;
  parentId?: string | null;
  noteCount?: number;
}

export interface NotesSnapshot {
  notebooks: Notebook[];
  notes: NoteSummary[];
  tags: string[];
}

export type NotesMode = "library" | "new-notebook" | "capture" | "trash";

export interface TrashEntry {
  notebookId: string;
  notebookTitle?: string;
  note: NoteSummary;
  deletedAt: string;
}

export const BUILTIN_TAGS: Array<[string, string]> = [
  ["inbox", "📥"],
  ["idea", "💡"],
  ["todo", "✅"],
  ["important", "⭐"],
  ["chat", "💬"],
  ["captured", "🌐"],
  ["web-clip", "🌐"],
  ["project", "🚀"],
  ["question", "❓"],
  ["reference", "📚"],
  ["meeting", "🗓️"],
  ["reading", "📖"],
];
export const TAG_ICON_FALLBACK = "🏷️";

const TAG_ICONS = new Map(BUILTIN_TAGS);

export function tagIcon(name: string): string {
  return TAG_ICONS.get(String(name).trim().toLowerCase()) ?? TAG_ICON_FALLBACK;
}

export function builtinTagNames(): string[] {
  return BUILTIN_TAGS.map(([name]) => name);
}

export function allTagSuggestions(existingTags: string[] | undefined): string[] {
  return [...new Set([...(existingTags || []), ...builtinTagNames()])];
}

export const EMOJI_GROUPS: Array<[string, string[]]> = [
  [
    "Smileys",
    ["😀","😁","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😜","🤪","😎","🤓","🥳","😏","😒","😞","😔","😢","😭","😤","😡","🤯","😳","🥺","😱","🤔","🤗","🤫","🤭","😴","🤤","😷","🤒","🤕","🤑","🤠","👻","💀","👽","🤖","🎃"],
  ],
  [
    "Hand gestures",
    ["👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤝","💪","👏","🙌","👐","🤲","🙏","💅","🤳"],
  ],
  [
    "Animals",
    ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐴","🦄","🐝","🦋","🐌","🐞","🐜","🐢","🐍","🦎","🐙","🦑","🦀","🐳","🐬","🐟","🐠","🦈","🐊"],
  ],
  [
    "Food",
    ["🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🥑","🥦","🥬","🥒","🌽","🥕","🥔","🍠","🥐","🥯","🍞","🥖","🧀","🥚","🍳","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🥪","🌮","🌯","🍜","🍝","🍣","🍤","🍚","🍙","🍦","🍨","🍰","🎂","🍫","🍬","🍭","🍿","☕","🍵","🧃","🥤","🍺","🍻","🥂","🍷"],
  ],
  [
    "Activities",
    ["⚽","🏀","🏈","⚾","🎾","🏐","🏓","🏸","⛳","🏹","🎣","🥊","🥋","🎽","⛸️","🥌","🛷","🎿","🏂","🏋️","🤸","🤺","🏇","🧘","🏄","🏊","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎫","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎻","🎲","🎯","🎳","🎮","🎰","🧩"],
  ],
  [
    "Travel",
    ["🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🚚","🚛","🚜","🛵","🏍️","🚲","🛴","🚨","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩️","💺","🛰️","🚀","🛸","🚁","🛶","⛵","🚤","🛥️","🛳️","⛴️","🚢","⚓","🗺️","🗿","🗼","🏰","🏯","🏟️","🎡","🎢","🎠","⛲","⛱️","🏖️","🏝️","🏜️","🌋","⛰️","🏔️","🗻","🏕️","🏠","🏡","🏘️","🏭","🏢","🏬","🏥","🏦","🏨","🏪","🏫","🏩","💒","🏛️","⛪","🕌","🕍","🛕"],
  ],
  [
    "Objects",
    ["⌚","📱","💻","⌨️","🖥️","🖨️","🖱️","📷","📸","📹","🎥","📞","☎️","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋","🔌","💡","🔦","🕯️","💸","💵","💴","💶","💷","💰","💳","💎","⚖️","🧰","🔧","🔨","⚒️","🛠️","⛏️","🔩","⚙️","🧱","⛓️","🧲","🔪","🗡️","⚔️","🛡️","🔮","🔭","🔬","💊","💉","🩹","🩺","🌡️","🧻","🧹","🧺","🧽","🧼","🛁","🛏️","🛋️","🪑","🚪","🧳","🛒","🎁","🎈","🎏","🎀","🎊","🎉","🎎","🏮","🎐","🧧","✉️","📩","📨","📧","💌","📥","📤","📦","🏷️","📜","📃","📄","📑","🧾","📊","📈","📉","🗒️","🗓️","📆","📅","🗑️","📇","🗃️","🗳️","📁","📂","🗂️","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🔗","📎","📏","📌","📍","✂️","🖊️","🖋️","✒️","🖌️","🖍️","📝","✏️","🔍","🔎","🔏","🔐","🔒","🔓"],
  ],
  [
    "Symbols",
    ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","💕","💞","💓","💗","💖","💘","💝","🔴","🟠","🟡","🟢","🔵","🟣","🟤","⚫","⚪","🟥","🟧","🟨","🟩","🟦","🟪","🟫","⬛","⬜","🔺","🔻","🔸","🔹","🔶","🔷","♦️","♠️","♣️","♥️","☮️","☯️","✡️","☸️","🕉️","☪️","✝️","☦️","🛐","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","⛎","✅","❎","⭕","❌","❗","❓","💯","💢","💬","💭","💤","⭐","🌟","✨","⚡","🔥","💧","☀️","🌈","☁️","⛈️","🌧️","❄️","⛄","🌙","🌍","🌎","🌏","🌊","🌌","🪐","💠","🌐","🎵","🎶","🔔","🔕","📢","📣","🛑","🚫","♻️","🆗","🆕","🆙","🆒","🔝","🔚","🔙","🔛","🔜","🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛"],
  ],
];

export const ICONS: Record<string, string> = {
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2-7 7-2.8.8.8-2.8 7-7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  preview:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  chat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H8l-3.5 2.5V11H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  attach:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 4.5v6a1.75 1.75 0 0 0 3.5 0v-6.5a3 3 0 0 0-6 0v7a4.2 4.2 0 0 0 8.4 0V5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  save: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h8l2.5 2.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 13V9h5v4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  download:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7M5 6.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 12.5h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  copy:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 4.5H3.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1H10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  duplicate:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  trash:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.5 4.5l.7 8.2a1 1 0 0 0 1 .8h3.6a1 1 0 0 0 1-.8l.7-8.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  globe:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 8h11M8 2.5c1.8 1.6 2.7 3.4 2.7 5.5S9.8 11.9 8 13.5C6.2 11.9 5.3 10.1 5.3 8S6.2 4.1 8 2.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  pencil:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.8l2.4 2.4-6.6 6.6-3 .6.6-3 6.6-6.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  close:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5l4 4-1.5 1.5-2.5-.5-3.5 3.5v2L3 16l-.5-3H0l4-4-.5-2.5L5 2.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};

export function parseTags(value: string): string[] {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
}

export function formatDate(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Relative "time ago" for the editor footer; falls back to formatDate. */
export function formatRelativeTime(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
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
  return formatDate(value);
}

/** Rough reading-time estimate for the editor footer (chars → minutes). */
export function estimateReadingMinutes(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.max(1, Math.round(charCount / 400));
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

export interface OutlineEntry {
  id: string;
  level: number;
  text: string;
}

/**
 * Assign stable ids to h1-h3 headings inside a rendered preview and return
 * the heading outline. Duplicate headings get unique ids via an occurrence
 * suffix.
 */
export function buildHeadingOutline(root: ParentNode): OutlineEntry[] {
  const headings = Array.from(
    root.querySelectorAll("h1, h2, h3"),
  ) as HTMLElement[];
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const raw = (heading.textContent ?? "").trim();
    const base = raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "heading";
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    const id = occurrence === 0 ? base : `${base}-${occurrence + 1}`;
    heading.id = id;
    return { id, level: Number(heading.tagName.slice(1)), text: raw };
  });
}

/**
 * Pick the outline entry whose heading is currently nearest the reading line
 * (default 80px from the viewport top). Falls back to the first entry when no
 * heading has crossed the line yet.
 */
export function findActiveOutlineId(
  items: Array<{ id: string; top: number }>,
  viewportTop: number,
  line = 80,
): string | null {
  if (items.length === 0) return null;
  let active: { id: string; top: number } | null = null;
  for (const item of items) {
    if (item.top <= viewportTop + line) {
      if (!active || item.top >= active.top) active = item;
    }
  }
  return active?.id ?? items[0].id;
}

/** Split `text` into highlighted/normal segments for a case-insensitive query. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle || !text) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const hit = haystack.indexOf(needle, index);
    if (hit === -1) {
      segments.push({ text: text.slice(index), match: false });
      break;
    }
    if (hit > index) {
      segments.push({ text: text.slice(index, hit), match: false });
    }
    segments.push({ text: text.slice(hit, hit + needle.length), match: true });
    index = hit + needle.length;
  }
  return segments;
}

export function conversationNoteTitle(value: string): string {
  const line = String(value)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (!line) return t("Conversation");
  const title = line.replace(/^#{1,6}\s+/, "");
  return title.length > 60 ? `${title.slice(0, 60)}…` : title;
}

export function safeFileName(value: string): string {
  return String(value || "notes")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Minimal YAML frontmatter for a portable single-note Markdown export. */
export function noteFrontmatter(title: string, tags: string[], source?: string): string {
  const lines = ["---", `title: ${JSON.stringify(title)}`];
  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) lines.push(`  - ${tag}`);
  }
  if (source) {
    lines.push(`source: ${JSON.stringify(source)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function buildChildrenByParent(notebooks: Notebook[]): Map<string | null, Notebook[]> {
  const childrenByParent = new Map<string | null, Notebook[]>();
  for (const notebook of notebooks) {
    const key = notebook.parentId ?? null;
    const siblings = childrenByParent.get(key) ?? [];
    siblings.push(notebook);
    childrenByParent.set(key, siblings);
  }
  return childrenByParent;
}
