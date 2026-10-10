import { t } from "../../shared/i18n";
import type { NoteSummary } from "./notesLogic";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REFERENCE = new RegExp(`^(${ID})/(${ID})$`, "i");

export function resolveNoteLink(
  href: string,
  notes: NoteSummary[],
  notebookId?: string,
): {
  note?: NoteSummary;
  target?: Pick<NoteSummary, "notebookId" | "id">;
  ambiguous?: boolean;
} {
  if (!href.startsWith("zicode-note://")) return {};
  let value: string;
  try {
    value = decodeURIComponent(href.slice("zicode-note://".length));
  } catch {
    return {};
  }
  const reference = REFERENCE.exec(value);
  if (reference)
    return { target: { notebookId: reference[1].toLowerCase(), id: reference[2].toLowerCase() } };
  const matches = notes.filter(
    (note) => note.title.trim().toLowerCase() === value.trim().toLowerCase(),
  );
  const local = matches.filter((note) => note.notebookId === notebookId);
  const candidates = local.length ? local : matches;
  return candidates.length === 1
    ? { note: candidates[0], target: candidates[0] }
    : { ambiguous: candidates.length > 1 };
}

export function wikilinkMarkdown(content: string): string {
  const lines = content.split("\n");
  let inlineTicks = 0;
  let fence: { character: string; length: number } | null = null;
  return lines
    .map((line) => {
      if (!line.trim()) inlineTicks = 0;
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (delimiter) {
        if (!fence) fence = { character: delimiter[1][0], length: delimiter[1].length };
        else if (
          delimiter[1][0] === fence.character &&
          delimiter[1].length >= fence.length &&
          !delimiter[2].trim()
        )
          fence = null;
        return line;
      }
      if (fence || /^( {4}|\t| {0,3}>)/.test(line)) return line;
      return line.replace(/\\.|`+|\[\[([^\]\n]+)\]\]/g, (match, target: string | undefined) => {
        if (match.startsWith("\\")) return match;
        if (match.startsWith("`")) {
          if (!inlineTicks) inlineTicks = match.length;
          else if (inlineTicks === match.length) inlineTicks = 0;
          return match;
        }
        if (inlineTicks || target === undefined) return match;
        const [name, ...alias] = target.split("|");
        const title = name.trim();
        if (!title) return match;
        const label = (alias.length ? alias.join("|").trim() : title).replace(/[\\[\]]/g, "\\$&");
        return `[${label}](zicode-note://${encodeURIComponent(title)})`;
      });
    })
    .join("\n");
}

export function markUnresolvedWikilinks(
  root: HTMLElement,
  notes: NoteSummary[],
  notebookId?: string,
): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="zicode-note://"]')) {
    const result = resolveNoteLink(anchor.getAttribute("href") ?? "", notes, notebookId);
    anchor.classList.toggle("notes-wikilink-unresolved", !result.target);
    if (!result.target)
      anchor.title = result.ambiguous
        ? t("Several notes have this title. Use a note ID link to choose the target.")
        : t("This note does not exist yet");
  }
}

export function openNoteLink(
  href: string,
  notes: NoteSummary[],
  notebookId: string,
  open: (bookId: string, noteId: string) => Promise<void>,
  notify: (message: string) => void,
): void {
  const result = resolveNoteLink(href, notes, notebookId);
  if (result.target) void open(result.target.notebookId, result.target.id);
  else
    notify(
      result.ambiguous
        ? t("Several notes have this title. Use a note ID link to choose the target.")
        : t("This note does not exist yet"),
    );
}
