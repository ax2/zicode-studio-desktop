import type { ComposerStoreHook } from "./ComposerApp";

// The desktop shell has exactly one composer; the factory registers the active
// store here so the vanilla-adjacent bridge (setupComposerSlashMenu) can push
// getCommands / openAll / update into React state after the app wires modules.
let currentStore: ComposerStoreHook | null = null;

export function setComposerStore(store: ComposerStoreHook | null): void {
  currentStore = store;
}

export function getComposerStore(): ComposerStoreHook | null {
  return currentStore;
}
