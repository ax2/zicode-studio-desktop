import type { Notebook } from "./notesLogic";

const PREFIX = "zicode.notes-layout.v1:";
export function readNotebookLayout(scope: string) {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + scope) ?? "{}");
    const ids = (input: unknown) => Array.isArray(input) ? [...new Set(input.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256))].slice(0, 4096) : [];
    return { notebookOrder: ids(value.order), expandedNotebookIds: new Set(ids(value.expanded)) };
  } catch { return { notebookOrder: [] as string[], expandedNotebookIds: new Set<string>() }; }
}
export function writeNotebookLayout(scope: string, order: string[], expanded: Set<string>) {
  try { localStorage.setItem(PREFIX + scope, JSON.stringify({ order, expanded: [...expanded] })); } catch { /* UI preferences stay usable for this session if storage is unavailable. */ }
}
export function orderNotebooks(notebooks: Notebook[], order: string[]) {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...notebooks].sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
export function reorderNotebooks(notebooks: Notebook[], sourceId: string, targetId: string, after: boolean) {
  const source = notebooks.find(book => book.id === sourceId), target = notebooks.find(book => book.id === targetId);
  if (!source || !target || sourceId === targetId || (source.parentId ?? null) !== (target.parentId ?? null)) return notebooks;
  const result = notebooks.filter(book => book.id !== sourceId);
  result.splice(result.findIndex(book => book.id === targetId) + Number(after), 0, source);
  return result;
}
