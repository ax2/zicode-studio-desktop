/**
 * Shared tool classification used by the result panel (file changes) and the
 * work-mode guard (Ask must not modify files).
 */
export function isFileWritingTool(toolName) {
  const lower = String(toolName || "").toLowerCase();
  return ["write", "edit", "create", "patch", "append"].some((token) =>
    lower.includes(token),
  );
}

export function toolFilePath(args = {}) {
  return String(
    args.path || args.file_path || args.filePath || args.target || "",
  ).trim();
}

/**
 * Extracts before/after content for a file-writing tool call so the result
 * panel can render a per-file diff. Edit/patch tools carry both sides in their
 * arguments; write/create/append tools only carry the new content, so `before`
 * stays empty and the diff shows the written lines as additions.
 */
export function toolChangeInfo(toolName, args = {}) {
  const lower = String(toolName || "").toLowerCase();
  const a = args || {};
  const content =
    a.content !== undefined
      ? stringifyValue(a.content)
      : a.text !== undefined
        ? stringifyValue(a.text)
        : a.newText !== undefined
          ? stringifyValue(a.newText)
          : "";
  if (/(edit|patch|modify|replace)/.test(lower)) {
    const before = stringifyValue(a.oldText ?? a.old_text ?? "");
    const after = stringifyValue(a.newText ?? a.new_text ?? "");
    return {
      kind: "edit",
      before,
      after,
      hasDiff: Boolean(before || after),
    };
  }
  if (/append/.test(lower)) {
    return { kind: "append", before: "", after: content, hasDiff: Boolean(content) };
  }
  if (/(create|write|save)/.test(lower)) {
    return { kind: "write", before: "", after: content, hasDiff: Boolean(content) };
  }
  return { kind: "other", before: "", after: "", hasDiff: false };
}

function stringifyValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
