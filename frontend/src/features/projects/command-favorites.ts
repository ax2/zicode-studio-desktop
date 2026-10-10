import type { TaskCatalog } from "./project-runner";

const STORAGE_KEY = "zicode.project-command-favorites.v1";
const MAX_SCOPES = 64;
const MAX_COMMANDS = 32;
const MAX_ID_LENGTH = 512;

type Task = TaskCatalog["tasks"][number];
type Document = { version: 1; scopes: Record<string, string[]> };

function empty(): Document {
  return { version: 1, scopes: {} };
}

function readDocument(storage: Storage, strict = false): Document {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return empty();
  if (raw.length > 256 * 1024) {
    if (strict) throw new Error("command_favorite_unavailable");
    return empty();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !((parsed as Document).version === 1))
      throw new Error("command_favorite_invalid");
    const source = (parsed as Document).scopes;
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new Error("command_favorite_invalid");
    if (strict && Object.keys(source).length > MAX_SCOPES)
      throw new Error("command_favorite_invalid");
    const scopes: Record<string, string[]> = Object.create(null);
    for (const [scope, ids] of Object.entries(source).slice(-MAX_SCOPES)) {
      if (
        scope.length > 4096 ||
        !Array.isArray(ids) ||
        ids.length > MAX_COMMANDS ||
        !ids.every((id) => typeof id === "string" && id.length <= MAX_ID_LENGTH) ||
        (strict && new Set(ids).size !== ids.length)
      ) {
        if (strict) throw new Error("command_favorite_invalid");
        continue;
      }
      scopes[scope] = [...new Set(ids)].slice(-MAX_COMMANDS);
    }
    return { version: 1, scopes };
  } catch {
    if (strict) throw new Error("command_favorite_unavailable");
    return empty();
  }
}

export function commandFavoriteStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function favoriteScope(workspaceId: string, directory: string): string {
  return JSON.stringify([workspaceId, directory]);
}

export function commandFavoriteId(task: Task): string {
  return task.id ?? JSON.stringify([task.source ?? "", task.manager ?? "", task.name]);
}

export function readCommandFavorites(storage: Storage | null, scope: string): string[] {
  if (!storage) return [];
  try {
    return readDocument(storage).scopes[scope] ?? [];
  } catch {
    return [];
  }
}

export function toggleCommandFavorite(
  storage: Storage | null,
  scope: string,
  id: string,
): string[] {
  if (!storage || !scope || scope.length > 4096 || !id || id.length > MAX_ID_LENGTH)
    throw new Error("command_favorite_unavailable");
  const document = readDocument(storage, true);
  const current = document.scopes[scope] ?? [];
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  if (next.length > MAX_COMMANDS) throw new Error("command_favorite_limit");
  delete document.scopes[scope];
  if (next.length) document.scopes[scope] = next;
  const keys = Object.keys(document.scopes);
  if (keys.length > MAX_SCOPES) delete document.scopes[keys[0]];
  storage.setItem(STORAGE_KEY, JSON.stringify(document));
  return next;
}

export function mergeCommandFavorites(
  storage: Storage | null,
  scope: string,
  ids: string[],
): string[] {
  if (
    !storage ||
    !scope ||
    scope.length > 4096 ||
    ids.length > MAX_COMMANDS ||
    ids.some((id) => !id || id.length > MAX_ID_LENGTH)
  )
    throw new Error("command_favorite_unavailable");
  const document = readDocument(storage, true);
  const merged = [...new Set([...(document.scopes[scope] ?? []), ...ids])];
  if (merged.length > MAX_COMMANDS) throw new Error("command_favorite_limit");
  delete document.scopes[scope];
  if (merged.length) document.scopes[scope] = merged;
  const keys = Object.keys(document.scopes);
  if (keys.length > MAX_SCOPES) delete document.scopes[keys[0]];
  storage.setItem(STORAGE_KEY, JSON.stringify(document));
  return merged;
}

export const COMMAND_FAVORITES_STORAGE_KEY = STORAGE_KEY;
