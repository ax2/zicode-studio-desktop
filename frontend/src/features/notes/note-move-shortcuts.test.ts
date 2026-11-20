import { afterEach, expect, it, vi } from "vitest";
import type { Note } from "./notesLogic";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";
import {
  applyShortcutChange,
  emptyShortcuts,
  type NoteShortcuts,
  type ShortcutRepository,
} from "./shortcut-repository";

const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.getState().destroy(); });
const scope = (workspace: string) => JSON.stringify(["programming", workspace]);
const original = { id: "note", notebookId: "a" };
const copy = { id: "note", notebookId: "c" };
const moved = { id: "note", notebookId: "b" };

async function fixture() {
  let workspace = "move-alpha";
  const records = new Map<string, NoteShortcuts>([
    [scope(workspace), { version: 1, recent: [original, copy], pinned: [original, copy] }],
    [scope("move-beta"), { version: 1, recent: [copy], pinned: [copy] }],
  ]);
  let failStorage = false;
  const repository: ShortcutRepository = {
    read: vi.fn(async key => structuredClone(records.get(key) ?? emptyShortcuts())),
    change: vi.fn(async (key, action) => {
      if (failStorage) throw new Error("storage unavailable");
      const saved = applyShortcutChange(records.get(key) ?? emptyShortcuts(), action);
      records.set(key, structuredClone(saved));
      return structuredClone(saved);
    }),
  };
  const notes: Note[] = [original, copy].map(ref => ({ ...ref, title: ref.notebookId, content: "body", tags: [], version: 1 }));
  const move = vi.fn(async (_scene: string, _workspace: string, request: { notebookId: string; noteId: string; targetNotebookId: string }) => {
    const note = notes.find(n => n.id === request.noteId && n.notebookId === request.notebookId);
    if (!note) throw new Error("missing source");
    note.notebookId = request.targetNotebookId;
    return { note: structuredClone(note) };
  });
  const gateway = {
    list: async () => ({ snapshot: { notebooks: ["a", "b", "c"].map(id => ({ id, title: id })), notes: structuredClone(notes), tags: [] } }),
    get: async (_scene: string, _workspace: string, book: string, id: string) => {
      const note = notes.find(n => n.id === id && (n.notebookId === book || n.previousNotebookIds?.includes(book)));
      if (!note) throw new Error("missing note");
      return { note: structuredClone(note) };
    },
    moveNote: move,
    knowledge: async () => ({ snapshot: { links: [] } }),
  } as unknown as NotesGatewayLike;
  const store = createNotesStore({ gateway, shortcutRepository: repository, getTarget: () => ({ sceneId: "programming", workspaceId: workspace }) });
  stores.push(store);
  await store.getState().load();
  await store.getState().refreshShortcuts();
  return { store, records, repository, move, notes,
    failStorage(value: boolean) { failStorage = value; },
    async switchWorkspace(value: string) { workspace = value; await store.getState().setTarget(); await store.getState().refreshShortcuts(); },
  };
}

it("keeps recent and pinned entries usable after a successful move without changing an imported same-ID copy", async () => {
  const f = await fixture();
  await f.store.getState().moveNoteTo("a", "note", "b");
  await f.store.getState().refreshShortcuts();
  expect(f.records.get(scope("move-alpha"))).toEqual({ version: 1, recent: [moved, copy], pinned: [moved, copy] });
  expect(f.store.getState().pinnedNotes.map(n => n.notebookId)).toEqual(["b", "c"]);
  expect(f.store.getState().shortcutsError).toBeNull();
});

it("does not rewrite shortcuts when the Host rejects the move", async () => {
  const f = await fixture();
  f.move.mockRejectedValueOnce(new Error("version conflict"));
  await f.store.getState().moveNoteTo("a", "note", "b");
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([original, copy]);
  expect(f.repository.change).not.toHaveBeenCalled();
});

it("persists a completed move in its originating workspace when the user switches before the response", async () => {
  const f = await fixture();
  let complete!: () => void;
  const waiting = new Promise<void>(resolve => { complete = resolve; });
  const ordinary = f.move.getMockImplementation();
  f.move.mockImplementationOnce(async (...args) => { await waiting; return ordinary?.(...args) as ReturnType<NonNullable<typeof ordinary>>; });
  const operation = f.store.getState().moveNoteTo("a", "note", "b");
  await vi.waitFor(() => expect(f.move).toHaveBeenCalledOnce());
  await f.switchWorkspace("move-beta");
  complete(); await operation;
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([moved, copy]);
  expect(f.records.get(scope("move-beta"))?.pinned).toEqual([copy]);
  expect(f.store.getState().pinnedReferences).toEqual([copy]);
  await f.switchWorkspace("move-alpha");
  expect(f.store.getState().pinnedReferences).toEqual([moved, copy]);
});

it("keeps the relocation queued when shortcut storage fails and persists it on refresh", async () => {
  const f = await fixture(); f.failStorage(true);
  await f.store.getState().moveNoteTo("a", "note", "b");
  expect(f.notes.some(n => n.id === "note" && n.notebookId === "b")).toBe(true);
  expect(f.store.getState().pinnedReferences).toEqual([moved, copy]);
  expect(f.store.getState().shortcutsStorageError).not.toBeNull();
  f.failStorage(false); await f.store.getState().refreshShortcuts();
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([moved, copy]);
  expect(f.store.getState().shortcutsStorageError).toBeNull();
});


it("recovers old pinned and recent locations only from Host-confirmed move provenance", async () => {
  const f = await fixture();
  // Host move finished before the UI could persist shortcuts (e.g. process exit).
  f.notes[0].notebookId = "b";
  f.notes[0].previousNotebookIds = ["a"];
  await f.store.getState().refreshShortcuts();
  expect(f.records.get(scope("move-alpha"))).toEqual({ version: 1, recent: [moved, copy], pinned: [moved, copy] });
  expect(f.store.getState().pinnedNotes.map(note => ({ id: note.id, notebookId: note.notebookId }))).toEqual([moved, copy]);
  expect(f.store.getState().shortcutsError).toBeNull();
});

it("retains unavailable historical references when matching IDs have no movement history", async () => {
  const f = await fixture();
  f.notes[0].notebookId = "b";
  await f.store.getState().refreshShortcuts();
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([original, copy]);
  expect(f.store.getState().shortcutsError).toBeTruthy();
  expect(f.store.getState().pinnedNotes.map(note => note.notebookId)).toEqual(["c"]);
});

it("retries failed persistence of Host-resolved historical shortcuts", async () => {
  const f = await fixture();
  f.notes[0].notebookId = "b";
  f.notes[0].previousNotebookIds = ["a"];
  f.failStorage(true);
  await f.store.getState().refreshShortcuts();
  expect(f.store.getState().shortcutsStorageError).toBeTruthy();
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([original, copy]);
  f.failStorage(false);
  await f.store.getState().refreshShortcuts();
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([moved, copy]);
});


it("collapses multiple historical shortcuts to one current entry in the same refresh", async () => {
  const f = await fixture();
  f.notes.splice(1, 1);
  f.notes[0].notebookId = "b";
  f.notes[0].previousNotebookIds = ["a", "c"];
  await f.store.getState().refreshShortcuts();
  expect(f.records.get(scope("move-alpha"))?.pinned).toEqual([moved]);
  expect(f.store.getState().pinnedNotes.map(note => note.notebookId)).toEqual(["b"]);
  expect(f.store.getState().recentNotes.map(note => note.notebookId)).toEqual(["b"]);
});
