import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotesContent } from "./NotesApp";
import type { NoteDraft, NoteDraftRepository } from "./draft-repository";
import type { Note } from "./notesLogic";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.getState().destroy();
});
const conflict = () => Object.assign(new Error("Note changed; reload before saving"), { code: "version_conflict" });

async function fixture() {
  let saved: Note = { id: "conflict-note", notebookId: "conflict-book", title: "Original", content: "Original", tags: [], version: 1 };
  const records = new Map<string, NoteDraft>();
  const repository: NoteDraftRepository = {
    list: vi.fn(async () => ({ drafts: [...records.values()], unreadable: 0 })),
    put: vi.fn(async (draft) => { records.set(draft.id, structuredClone(draft)); }),
    remove: vi.fn(async (id, revision) => { if (records.get(id)?.revision === revision) records.delete(id); }),
  };
  const get = vi.fn(async () => ({ note: structuredClone(saved) }));
  const save = vi.fn(async (_scene: string, _workspace: string, note: Note) => {
    if (note.version !== saved.version) throw conflict();
    saved = { ...note, version: Number(saved.version) + 1 };
    return { note: structuredClone(saved) };
  });
  const gateway = {
    list: async () => ({ snapshot: { notebooks: [{ id: saved.notebookId, title: "Conflict book" }], notes: [saved], tags: [] } }),
    get, save, knowledge: async () => ({ snapshot: { links: [] } }),
    create: vi.fn(async (_scene: string, _workspace: string, notebookId: string, params: Partial<Note>) => ({ note: { ...saved, ...params, notebookId, id: "copy-note", version: 1 } })),
  } as unknown as NotesGatewayLike;
  const notify = vi.fn();
  const store = createNotesStore({ gateway, draftRepository: repository, notify, getTarget: () => ({ sceneId: "programming", workspaceId: "conflict-workspace" }) });
  stores.push(store);
  await store.getState().load();
  await store.getState().selectNote(saved);
  store.getState().setPreview(false);
  store.getState().setDraft({ title: "My title", content: "My unsaved 中文 edits", tags: ["local"], icon: "🌱" });
  store.getState().cancelAutosave();
  saved = { ...saved, title: "Elsewhere", content: "Saved elsewhere", tags: ["remote"], version: 2 };
  await store.getState().saveEditor(true);
  expect(store.getState().dirty).toBe(true);
  expect((store.getState().error as Error & { code?: string }).code).toBe("version_conflict");
  return { store, get, save, records, repository, notify, gateway, saved: () => saved };
}

it("reloads a conflicted dirty note from its banner and keeps an independent recovery copy", async () => {
  const { store, records, saved } = await fixture();
  const view = render(<NotesContent store={store} />);
  const button = view.container.querySelector(".notes-error-banner button") as HTMLButtonElement;
  expect(button).toBeTruthy();
  fireEvent.click(button);
  await waitFor(() => expect(store.getState().selectedNote?.version).toBe(2));
  expect(store.getState().draftContent).toBe("Saved elsewhere");
  expect(store.getState().dirty).toBe(false);
  expect(store.getState().error).toBeNull();
  expect(store.getState().editorLocked).toBe(false);
  const retained = [...records.values()].find((draft) => draft.content === "My unsaved 中文 edits");
  if (!retained) throw new Error("Expected retained conflict draft");
  expect(retained).toMatchObject({ title: "My title", icon: "🌱", tags: ["local"], note: { version: 1 } });
  await act(async () => {
    store.getState().setDraft({ content: "New edits on latest version" });
    store.getState().cancelAutosave();
    await store.getState().saveEditor(true);
  });
  expect(saved()).toMatchObject({ content: "New edits on latest version", version: 3 });
  await store.getState().refreshDrafts();
  expect(records.get(retained.id)?.content).toBe("My unsaved 中文 edits");
  expect(store.getState().recoveryDrafts.some((draft) => draft.id === retained.id)).toBe(true);
});

it("keeps the dirty editor intact when local recovery cannot be written and supports retry", async () => {
  const { store, repository, get } = await fixture();
  const originalPut = repository.put;
  repository.put = vi.fn(async () => { throw new Error("disk full"); });
  await store.getState().reloadConflictedNote();
  expect(store.getState()).toMatchObject({ dirty: true, editorLocked: false, draftContent: "My unsaved 中文 edits", selectedNote: { version: 1 } });
  expect((store.getState().error as Error & { code?: string }).code).toBe("version_conflict");
  expect(get).toHaveBeenCalledTimes(2);
  repository.put = originalPut;
  await store.getState().reloadConflictedNote();
  expect(store.getState()).toMatchObject({ dirty: false, error: null, draftContent: "Saved elsewhere" });
});

it("keeps local edits and permits retry when the saved note is unavailable", async () => {
  const { store, get, records } = await fixture();
  get.mockRejectedValueOnce(new Error("offline"));
  await store.getState().reloadConflictedNote();
  expect(store.getState()).toMatchObject({ dirty: true, editorLocked: false, draftContent: "My unsaved 中文 edits", selectedNote: { version: 1 } });
  expect([...records.values()].filter((draft) => draft.id.includes('"conflict"'))).toHaveLength(0);
  await store.getState().reloadConflictedNote();
  expect(store.getState()).toMatchObject({ dirty: false, error: null, selectedNote: { version: 2 } });
});

it("deduplicates reloads and prevents typing or blur saves while recovery is being secured", async () => {
  const { store, get, save } = await fixture();
  let finish!: (value: { note: Note }) => void;
  get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const reload = store.getState().reloadConflictedNote();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(store.getState().editorLocked).toBe(true);
  await store.getState().reloadConflictedNote();
  store.getState().setDraft({ content: "Must not replace locked editor" });
  await store.getState().saveIfDirty();
  expect(save).toHaveBeenCalledTimes(1);
  expect(store.getState().draftContent).toBe("My unsaved 中文 edits");
  finish({ note: { id: "conflict-note", notebookId: "conflict-book", title: "Elsewhere", content: "Saved elsewhere", tags: [], version: 2 } });
  await reload;
  expect(get).toHaveBeenCalledTimes(2);
  expect(store.getState().editorLocked).toBe(false);
});

it("waits for an existing save before reloading instead of racing the saved version", async () => {
  const { store, gateway, get } = await fixture();
  let finish!: () => void;
  gateway.save = vi.fn(() => new Promise<{ note: Note }>((_resolve, reject) => { finish = () => reject(conflict()); }));
  const save = store.getState().saveEditor(true);
  await waitFor(() => expect(gateway.save).toHaveBeenCalledTimes(1));
  const reload = store.getState().reloadConflictedNote();
  expect(get).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([save, reload]);
  expect(get).toHaveBeenCalledTimes(2);
  expect(store.getState()).toMatchObject({ dirty: false, editorLocked: false, selectedNote: { version: 2 } });
});

it("never replaces a different editor if the active note changes during the read", async () => {
  const { store, get } = await fixture();
  let finish!: (value: { note: Note }) => void;
  get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const reload = store.getState().reloadConflictedNote();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  store.setState({ selectedNote: { id: "other", notebookId: "other-book", title: "Other", content: "Other", tags: [] }, draftContent: "Other edits" });
  finish({ note: { id: "conflict-note", notebookId: "conflict-book", title: "Elsewhere", content: "Saved elsewhere", tags: [], version: 2 } });
  await reload;
  expect(store.getState()).toMatchObject({ selectedNote: { id: "other" }, draftContent: "Other edits", editorLocked: false });
});

it("rejects a mismatched response without replacing the conflicted note", async () => {
  const { store, get } = await fixture();
  get.mockResolvedValueOnce({ note: { id: "wrong", notebookId: "wrong", title: "Wrong", content: "Wrong", tags: [] } });
  await store.getState().reloadConflictedNote();
  expect(store.getState()).toMatchObject({ dirty: true, editorLocked: false, draftContent: "My unsaved 中文 edits", selectedNote: { version: 1 } });
});

it("can save retained edits as a separate note without overwriting the saved version", async () => {
  const { store, records, saved, gateway } = await fixture();
  await store.getState().reloadConflictedNote();
  const retained = [...records.values()].find((draft) => draft.content === "My unsaved 中文 edits");
  if (!retained) throw new Error("Expected retained conflict draft");
  await store.getState().recoverDraft(retained.id, true);
  expect(gateway.create).toHaveBeenCalledWith("programming", "conflict-workspace", "conflict-book", { title: "My title", content: "My unsaved 中文 edits", icon: "🌱", tags: ["local"] });
  expect(saved()).toMatchObject({ version: 2, content: "Saved elsewhere" });
  expect(store.getState()).toMatchObject({ selectedNote: { id: "copy-note" }, draftContent: "My unsaved 中文 edits", dirty: false });
});

it("serializes saves requested in the same event turn", async () => {
  const { store, gateway } = await fixture();
  const selected = store.getState().selectedNote;
  if (!selected) throw new Error("Expected selected note");
  const current = { ...selected, version: 2 };
  store.setState({ selectedNote: current, error: null });
  let finish!: () => void;
  gateway.save = vi.fn(() => new Promise<{ note: Note }>((resolve) => { finish = () => resolve({ note: { ...current, content: "My unsaved 中文 edits", version: 3 } }); }));
  const first = store.getState().saveEditor(true);
  const second = store.getState().saveEditor(true);
  await waitFor(() => expect(gateway.save).toHaveBeenCalled());
  expect(gateway.save).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
  expect(gateway.save).toHaveBeenCalledTimes(1);
  expect(store.getState().dirty).toBe(false);
});
