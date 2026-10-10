import type { ProjectStorageReport } from "./ProjectStoragePanel";

export interface StorageChange {
  path: string;
  bytes: number | null;
  files: number | null;
  reason: "complete" | "incomplete" | "not-observed";
}

/** Compares observations only; logical bytes do not establish reclaimed volume space. */
export function compareProjectStorage(
  previous: ProjectStorageReport,
  current: ProjectStorageReport,
): StorageChange[] {
  if (previous.directory !== current.directory) throw new Error("project_storage_scope_changed");
  const before = new Map(previous.entries.map((entry) => [entry.path, entry]));
  const after = new Map(current.entries.map((entry) => [entry.path, entry]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((path): StorageChange => {
      const left = before.get(path);
      const right = after.get(path);
      if (!left || !right) return { path, bytes: null, files: null, reason: "not-observed" };
      if (left.status !== "complete" || right.status !== "complete")
        return { path, bytes: null, files: null, reason: "incomplete" };
      return {
        path,
        bytes: right.bytes - left.bytes,
        files: right.files - left.files,
        reason: "complete",
      };
    })
    .sort((left, right) => {
      if (left.bytes === null && right.bytes !== null) return 1;
      if (left.bytes !== null && right.bytes === null) return -1;
      return (
        Math.abs(right.bytes ?? 0) - Math.abs(left.bytes ?? 0) ||
        left.path.localeCompare(right.path)
      );
    });
}
