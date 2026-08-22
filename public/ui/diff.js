/**
 * Shared line-level diff used by the chat tool cards and the result-panel
 * "Changes" view. Computes an add/remove edit script with a capped LCS table
 * so huge files degrade to a simple before/after listing instead of hanging.
 */

const MAX_LCS_LINES = 2000;

export function diffLines(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length === 0) {
    return newLines.map((text) => ({ kind: "added", text: `+ ${text}` }));
  }
  if (newLines.length === 0) {
    return oldLines.map((text) => ({ kind: "removed", text: `- ${text}` }));
  }
  if (oldLines.length > MAX_LCS_LINES || newLines.length > MAX_LCS_LINES) {
    return [
      ...oldLines.map((text) => ({ kind: "removed", text: `- ${text}` })),
      ...newLines.map((text) => ({ kind: "added", text: `+ ${text}` })),
    ];
  }

  const table = Array.from({ length: oldLines.length + 1 }, () =>
    new Array(newLines.length + 1).fill(0),
  );
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: "removed", text: `- ${oldLines[i]}` });
      i += 1;
    } else {
      result.push({ kind: "added", text: `+ ${newLines[j]}` });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    result.push({ kind: "removed", text: `- ${oldLines[i]}` });
    i += 1;
  }
  while (j < newLines.length) {
    result.push({ kind: "added", text: `+ ${newLines[j]}` });
    j += 1;
  }
  return result;
}

function splitLines(text) {
  const source = String(text ?? "");
  if (source === "") return [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  // A trailing newline produces a final "" line; drop it so "a\n" diffs as
  // one line instead of surfacing a phantom empty addition/removal.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
