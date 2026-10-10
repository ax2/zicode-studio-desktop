import type { ProjectTarget } from "./logic";

export function directoryScope(target: ProjectTarget | null): string {
  return JSON.stringify([
    target?.sceneId ?? "programming",
    target?.workspaceId ?? "",
    target?.cwd || target?.projectPath || "",
  ]);
}

export function validProjectDirectory(directory: string): boolean {
  if (
    directory.length > 2048 ||
    directory.includes("\\") ||
    directory.includes(":") ||
    directory.includes("\0")
  )
    return false;
  return (
    directory === "" ||
    directory.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Window-local navigation state. Host validation remains authoritative. */
export function createDirectoryContext() {
  const selections = new Map<string, string>();
  return {
    read(target: ProjectTarget | null) {
      const scope = directoryScope(target);
      const selected = selections.get(scope) ?? "";
      if (selected) {
        selections.delete(scope);
        selections.set(scope, selected);
      }
      return selected;
    },
    select(target: ProjectTarget | null, directory: string) {
      if (!target?.workspaceId || !validProjectDirectory(directory)) return false;
      const scope = directoryScope(target);
      selections.delete(scope);
      if (directory) selections.set(scope, directory);
      if (selections.size > 64) selections.delete(selections.keys().next().value as string);
      return true;
    },
  };
}
