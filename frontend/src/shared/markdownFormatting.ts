/**
 * Pure Markdown editing helpers shared by the Notes and Articles editors.
 * Each helper returns the next value and where to place the cursor so the
 * caller only needs to apply the edit and restore focus/selection.
 */

export interface MarkdownEdit {
  next: string;
  cursor: number;
  selection?: { start: number; end: number };
}

export function wrapMarkdownSelection(
  value: string,
  start: number,
  end: number,
  wrapper: string,
): MarkdownEdit {
  const selected = value.slice(start, end);
  const next = `${value.slice(0, start)}${wrapper}${selected}${wrapper}${value.slice(end)}`;
  return {
    next,
    cursor: selected
      ? start + wrapper.length + selected.length
      : start + wrapper.length,
    selection: selected
      ? { start: start + wrapper.length, end: start + wrapper.length + selected.length }
      : undefined,
  };
}

export function wrapMarkdownCodeBlock(
  value: string,
  start: number,
  end: number,
): MarkdownEdit {
  const selected = value.slice(start, end);
  const body = selected || "\n";
  const next = `${value.slice(0, start)}\`\`\`\n${body}\n\`\`\`${value.slice(end)}`;
  return {
    next,
    cursor: start + (selected ? selected.length + 4 : 4),
  };
}

export function insertMarkdownLinePrefix(
  value: string,
  cursor: number,
  prefix: string,
): MarkdownEdit {
  const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = value.indexOf("\n", cursor);
  const lineEndIndex = lineEnd === -1 ? value.length : lineEnd;
  const line = value.slice(lineStart, lineEndIndex);
  const nextLine = line.trimStart().startsWith(prefix.trim())
    ? line
    : `${prefix}${line}`;
  const next = `${value.slice(0, lineStart)}${nextLine}${value.slice(lineEndIndex)}`;
  return { next, cursor: cursor + (nextLine.length - line.length) };
}

export function insertMarkdownTable(
  value: string,
  cursor: number,
  columnLabels: [string, string],
): MarkdownEdit {
  const table = `| ${columnLabels[0]} | ${columnLabels[1]} |\n|---|---|\n|  |  |`;
  const next = `${value.slice(0, cursor)}${table}${value.slice(cursor)}`;
  return { next, cursor };
}

export function insertMarkdownLink(
  value: string,
  start: number,
  end: number,
): MarkdownEdit {
  const selected = value.slice(start, end);
  const insertion = selected ? `[${selected}](url)` : "[](url)";
  const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  const cursor = start + insertion.indexOf("url");
  return {
    next,
    cursor,
    selection: { start: cursor, end: cursor + 3 },
  };
}

export function replaceSelection(
  value: string,
  start: number,
  end: number,
  replacement: string,
): MarkdownEdit {
  const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  return { next, cursor: start + replacement.length };
}

/**
 * Convert simple CSV text (comma-separated rows, first row as headers) into a
 * Markdown table. Handles ragged rows by padding to the widest row and escapes
 * pipe characters. Returns "" when the input has no rows.
 */
export function csvToMarkdownTable(csv: string): string {
  const rows = String(csv ?? "")
    .split(/\r?\n/)
    .map((row) => row.split(",").map((cell) => cell.trim()))
    .filter((row) => row.length > 0 && row.some((cell) => cell !== ""));
  if (rows.length === 0) return "";
  const columns = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const cells = [...row];
    while (cells.length < columns) cells.push("");
    return cells;
  });
  const header = normalized[0];
  const escapeCell = (cell: string) => String(cell).replace(/\|/g, "\\|");
  const lines = [
    `| ${header.map(escapeCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalized
      .slice(1)
      .map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ];
  return lines.join("\n");
}
