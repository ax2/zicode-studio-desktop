import { t } from "../../shared/i18n";
import type { NoteSummary } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";
import {
  applyShortcutChange,
  emptyShortcuts,
  type NoteReference,
  type NoteShortcuts,
  referenceKey,
  type ShortcutChange,
  type ShortcutRepository,
} from "./shortcut-repository";

export interface NoteShortcutState {
  shortcutsScope: string;
  shortcutsLoading: boolean;
  shortcutsError: string | null;
  shortcutsStorageError: string | null;
  olderShortcutsAvailable: boolean;
  pinnedReferences: NoteReference[];
  refreshShortcuts(force?: boolean): Promise<void>;
  importOlderShortcuts(): Promise<void>;
  clearShortcuts(list: "recent" | "pinned"): Promise<void>;
}
function legacyIds(key: string, limit: number): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256,
            ),
          ),
        ].slice(0, limit)
      : [];
  } catch {
    return [];
  }
}
export function createNoteShortcuts({
  get,
  set,
  capture,
  gateway,
  repository,
  notify,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  capture(): NotesOperationScope;
  gateway: NotesGatewayLike;
  repository: ShortcutRepository;
  notify(message: string): void;
}) {
  let owner = capture();
  let record = emptyShortcuts();
  let sequence = 0;
  let mutation = 0;
  let importing = false;
  let queue = Promise.resolve();
  const cache = new Map<string, NoteShortcuts>();
  const pending = new Map<string, ShortcutChange[]>();
  const scopeKey = (scope: NotesOperationScope) =>
    JSON.stringify([scope.sceneId, scope.workspaceId]);
  const legacy = () => ({
    recent: legacyIds("zicode-notes-recent", 8),
    pinned: legacyIds("zicode-notes-pinned", 16),
  });
  const hasLegacy = () => {
    const old = legacy();
    return old.recent.length + old.pinned.length > 0;
  };
  function publish() {
    cache.set(scopeKey(owner), record);
    set({
      recentNoteIds: record.recent.map((note) => note.id),
      pinnedNoteIds: record.pinned.map((note) => note.id),
      pinnedReferences: record.pinned,
    });
  }
  async function resolve(force = false) {
    const scope = owner;
    if (!scope.isCurrent()) return;
    const request = ++sequence;
    const current = () => scope.isCurrent() && request === sequence;
    const snapshot = record;
    const refs = [
      ...new Map(
        [...snapshot.recent, ...snapshot.pinned].map((note) => [referenceKey(note), note]),
      ).values(),
    ];
    set({
      shortcutsLoading: refs.length > 0,
      shortcutsError: null,
      recentNotes: [],
      pinnedNotes: [],
    });
    const found = new Map<string, NoteSummary>();
    let failed = false;
    if (!force) {
      for (const note of get().snapshot.notes) found.set(referenceKey(note), note);
      const note = get().selectedNote;
      if (note)
        found.set(referenceKey(note), {
          id: note.id,
          notebookId: note.notebookId,
          title: note.title,
          icon: note.icon,
          updatedAt: note.updatedAt,
          version: note.version,
        });
    }
    const missing = refs.filter((note) => !found.has(referenceKey(note)));
    for (let index = 0; index < missing.length; index += 4) {
      if (!current()) return;
      const batch = missing.slice(index, index + 4);
      const results = await Promise.allSettled(
        batch.map((note) =>
          gateway.get(scope.sceneId, scope.workspaceId, note.notebookId, note.id),
        ),
      );
      for (const [offset, result] of results.entries()) {
        const reference = batch[offset];
        if (
          result.status !== "fulfilled" ||
          result.value.note.id !== reference.id ||
          result.value.note.notebookId !== reference.notebookId
        ) {
          failed = true;
          continue;
        }
        const note = result.value.note;
        found.set(referenceKey(note), {
          id: note.id,
          notebookId: note.notebookId,
          title: note.title,
          icon: note.icon,
          updatedAt: note.updatedAt,
          version: note.version,
        });
      }
    }
    if (!current()) return;
    const summaries = (refs: NoteReference[]) =>
      refs
        .map((note) => found.get(referenceKey(note)))
        .filter((note): note is NoteSummary => Boolean(note));
    set({
      recentNotes: summaries(snapshot.recent),
      pinnedNotes: summaries(snapshot.pinned),
      shortcutsLoading: false,
      shortcutsError: failed
        ? t("Some note shortcuts could not be loaded. Their references are kept; refresh to retry.")
        : null,
    });
  }
  async function persist(key: string) {
    const actions = pending.get(key) ?? [];
    let saved: NoteShortcuts | null = null;
    while (actions.length) {
      saved = await repository.change(key, actions[0]);
      actions.shift();
    }
    pending.delete(key);
    return saved;
  }
  function change(action: ShortcutChange) {
    const scope = owner;
    if (!scope.isCurrent() || !scope.workspaceId) return Promise.resolve();
    const revision = ++mutation;
    const key = scopeKey(scope);
    const actions = pending.get(key) ?? [];
    actions.push(action);
    pending.set(key, actions);
    record = applyShortcutChange(record, action);
    publish();
    void resolve();
    queue = queue.then(async () => {
      try {
        const saved = await persist(key);
        if (!scope.isCurrent() || revision !== mutation) return;
        const latest = saved ?? (await repository.read(key));
        if (!scope.isCurrent() || revision !== mutation) return;
        record = latest;
        publish();
        set({ shortcutsStorageError: null });
        void resolve();
      } catch {
        if (scope.isCurrent())
          set({
            shortcutsStorageError: t(
              "Note shortcuts could not be saved on this device. Current choices remain available in this session.",
            ),
          });
      }
    });
    return queue;
  }
  const actions: NoteShortcutState = {
    shortcutsScope: scopeKey(owner),
    shortcutsLoading: false,
    shortcutsError: null,
    shortcutsStorageError: null,
    pinnedReferences: [],
    olderShortcutsAvailable: hasLegacy(),
    clearShortcuts: (list) => change({ kind: "clear", list }),
    async refreshShortcuts(force = true) {
      const scope = owner;
      const revision = mutation;
      const request = ++sequence;
      if (!scope.isCurrent()) return;
      set({ shortcutsLoading: true });
      await queue;
      if (!scope.isCurrent() || revision !== mutation || request !== sequence) return;
      try {
        // Recovery writes join the same queue as ordinary edits.
        let saved: NoteShortcuts | null = null;
        const operation = queue.then(async () => {
          await persist(scopeKey(scope));
          saved = await repository.read(scopeKey(scope));
        });
        queue = operation.catch(() => {});
        await operation;
        if (!scope.isCurrent() || revision !== mutation || request !== sequence) return;
        if (saved) {
          record = saved;
          publish();
          set({ shortcutsStorageError: null });
        }
      } catch {
        if (scope.isCurrent())
          set({
            shortcutsStorageError: t(
              "Note shortcuts could not be saved on this device. Current choices remain available in this session.",
            ),
          });
      }
      if (scope.isCurrent() && revision === mutation && request === sequence) await resolve(force);
    },
    async importOlderShortcuts() {
      const scope = owner;
      if (importing || !scope.isCurrent()) return;
      importing = true;
      try {
        const response = await gateway.list(scope.sceneId, scope.workspaceId, {});
        if (!scope.isCurrent()) return;
        const byId = new Map<string, NoteReference[]>();
        for (const note of response.snapshot?.notes ?? [])
          byId.set(note.id, [
            ...(byId.get(note.id) ?? []),
            { id: note.id, notebookId: note.notebookId },
          ]);
        const old = legacy();
        const match = (ids: string[]) =>
          ids.flatMap((id) => (byId.get(id)?.length === 1 ? (byId.get(id) ?? []) : []));
        await change({ kind: "import", recent: match(old.recent), pinned: match(old.pinned) });
        if (scope.isCurrent())
          notify(
            t(
              "Only older shortcuts uniquely matched in the current note list were recovered. The old records are kept.",
            ),
          );
      } catch {
        if (scope.isCurrent())
          set({
            shortcutsError: t("Could not recover older note shortcuts. Refresh and try again."),
          });
      } finally {
        if (scope.isCurrent()) importing = false;
      }
    },
  };
  return {
    actions,
    remember(note: NoteReference) {
      void change({ kind: "recent", note: { id: note.id, notebookId: note.notebookId } });
    },
    togglePinned(id: string, notebookId?: string) {
      if (!owner.isCurrent()) return;
      const candidates = [
        get().selectedNote,
        ...get().snapshot.notes,
        ...get().recentNotes,
        ...get().pinnedNotes,
      ].filter(
        (note): note is NoteSummary =>
          !!note && note.id === id && (!notebookId || note.notebookId === notebookId),
      );
      const refs = [...new Map(candidates.map((note) => [referenceKey(note), note])).values()];
      if (refs.length !== 1) return;
      const note = { id, notebookId: refs[0].notebookId };
      void change({
        kind: "toggle",
        note,
        pinned: !record.pinned.some((entry) => referenceKey(entry) === referenceKey(note)),
      });
    },
    resolve,
    reset() {
      sequence += 1;
      mutation += 1;
      owner = capture();
      record = cache.get(scopeKey(owner)) ?? emptyShortcuts();
      importing = false;
      cache.set(scopeKey(owner), record);
      set({
        shortcutsScope: scopeKey(owner),
        recentNoteIds: record.recent.map((note) => note.id),
        pinnedNoteIds: record.pinned.map((note) => note.id),
        pinnedReferences: record.pinned,
        recentNotes: [],
        pinnedNotes: [],
        shortcutsLoading: false,
        shortcutsError: null,
        shortcutsStorageError: null,
        olderShortcutsAvailable: hasLegacy(),
      });
    },
    listen() {
      const refresh = () => {
        void actions.refreshShortcuts();
      };
      window.addEventListener("focus", refresh);
      return () => window.removeEventListener("focus", refresh);
    },
  };
}
