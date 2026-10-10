export interface CommandFavoritesTransfer {
  projectName: string;
  directory: string;
  ids: string[];
}

const invalidMessage = "Invalid pinned commands file.";

export async function readCommandFavoritesFile(file: File): Promise<CommandFavoritesTransfer> {
  if (file.size > 256 * 1024) throw new Error("Pinned commands file exceeds 256 KiB.");
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error(invalidMessage);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(invalidMessage);
  const record = value as Record<string, unknown>;
  if (
    record.format !== "zicode-command-favorites" ||
    record.version !== 1 ||
    typeof record.projectName !== "string" ||
    !record.projectName.trim() ||
    record.projectName.length > 1024 ||
    typeof record.directory !== "string" ||
    record.directory.length > 4096 ||
    !Array.isArray(record.ids) ||
    record.ids.length > 32 ||
    !record.ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 512) ||
    new Set(record.ids).size !== record.ids.length
  )
    throw new Error(invalidMessage);
  return {
    projectName: record.projectName,
    directory: record.directory,
    ids: [...record.ids],
  };
}

export function downloadCommandFavorites(copy: CommandFavoritesTransfer): void {
  if (typeof URL.createObjectURL !== "function")
    throw new Error("Pinned command downloads are unavailable in this view.");
  const content = JSON.stringify(
    {
      format: "zicode-command-favorites",
      version: 1,
      projectName: copy.projectName,
      directory: copy.directory,
      exportedAt: new Date().toISOString(),
      ids: copy.ids,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([`${content}\n`], { type: "application/json" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zicode-command-favorites-${Date.now()}.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
