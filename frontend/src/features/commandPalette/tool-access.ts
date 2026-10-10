import type { PaletteCommand } from "./commandPaletteLogic";

export interface ToolAccessScope { sceneId: string; workspaceId: string }
export interface ToolAccessState {
  schemaVersion: 1;
  revision: number;
  favorites: string[];
  recent: { id: string; usedAt: number }[];
}
export type ToolAccessMutation =
  | { kind: "favoriteSet"; id: string; enabled: boolean }
  | { kind: "recentRecord"; id: string }
  | { kind: "recentClear" };
export interface ToolAccessStore {
  read(scope: ToolAccessScope): Promise<ToolAccessState>;
  mutate(scope: ToolAccessScope, mutation: ToolAccessMutation): Promise<ToolAccessState>;
}
export const emptyAccess = (): ToolAccessState => ({ schemaVersion: 1, revision: 0, favorites: [], recent: [] });

export function accessCommands(commands: PaletteCommand[], state: ToolAccessState, view: "all" | "favorites" | "recent"): PaletteCommand[] {
  if (view === "all") return commands;
  const byId = new Map(commands.filter(command => command.id).map(command => [command.id, command]));
  const ids = view === "favorites" ? state.favorites : state.recent.map(entry => entry.id);
  return ids.flatMap(id => byId.has(id) ? [byId.get(id) as PaletteCommand] : []);
}

/** Action must exist, resolve successfully, and not signal cancellation with false. */
export async function runWithRecent(command: PaletteCommand, store?: ToolAccessStore, scope?: ToolAccessScope) {
  if (command.disabled || !command.action) return;
  const result = await command.action();
  if (result !== false && command.id && store && scope) {
    try {
      await store.mutate(scope, { kind: "recentRecord", id: command.id });
    } catch {
      throw new Error("Command completed, but recent history could not be saved.");
    }
  }
}
