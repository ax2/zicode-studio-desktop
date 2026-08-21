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
