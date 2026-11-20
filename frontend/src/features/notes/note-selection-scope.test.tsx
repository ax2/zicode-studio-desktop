import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { NotesNav } from "./NotesApp";
import type { Note } from "./notesLogic";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";
import { applyShortcutChange, emptyShortcuts, referenceKey } from "./shortcut-repository";

const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.getState().destroy(); });
async function fixture() {
  setLocale("en");
  const notes: Note[] = [{ id: "same-note", notebookId: "a", title: "Original", content: "original body", tags: [], version: 1 },
    { id: "same-note", notebookId: "c", title: "Conflict copy", content: "cloud body", tags: [], version: 1 }];
  const remove = vi.fn(async (_scene: string, _workspace: string, note: { notebookId: string; id: string }) => {
    const index = notes.findIndex(item => item.id === note.id && item.notebookId === note.notebookId);
    if (index < 0) throw Error("missing note"); notes.splice(index, 1); return {};
  });
  const move = vi.fn(async (_scene: string, _workspace: string, request: { notebookId: string; noteId: string; targetNotebookId: string }) => {
    const note = notes.find(item => item.id === request.noteId && item.notebookId === request.notebookId);
    if (!note) throw Error("missing note"); note.notebookId = request.targetNotebookId; return {};
  });
  const save = vi.fn();
  const gateway = { list: async () => ({ snapshot: { notebooks: ["a", "b", "c"].map(id => ({ id, title: id })), notes: structuredClone(notes), tags: [] } }),
    get: async (_scene: string, _workspace: string, book: string, id: string) => ({ note: structuredClone(notes.find(note => note.notebookId === book && note.id === id)) }),
    knowledge: async () => ({ snapshot: { links: [] } }), listTrash: async () => ({ trash: [] }), delete: remove, moveNote: move, save } as unknown as NotesGatewayLike;
  const store = createNotesStore({ gateway, getTarget: () => ({ sceneId: "programming", workspaceId: "synthetic-selection" }),
    shortcutRepository: { read: async () => emptyShortcuts(), change: async (_scope, action) => applyShortcutChange(emptyShortcuts(), action) },
    draftRepository: { list: async () => ({ drafts: [], unreadable: 0 }), put: async () => {}, remove: async () => {} } });
  stores.push(store); await store.getState().load();
  store.setState({ selectMode: true, expandedNotebookIds: new Set(["a", "c"]) });
  const view = render(<NotesNav store={store} />);
  function row(title: string) { return view.getByText(title).closest(".notes-tree-note") as HTMLElement; }
  return { store, notes, remove, move, save, view, row };
}

it("selects and deletes only the original when its conflict copy has the same note ID", async () => {
  const f = await fixture(); fireEvent.click(f.row("Original"));
  expect(f.row("Original").getAttribute("aria-pressed")).toBe("true");
  expect(f.row("Conflict copy").getAttribute("aria-pressed")).toBe("false");
  await act(async () => { await f.store.getState().deleteSelectedNotes(); });
  expect(f.remove).toHaveBeenCalledOnce(); expect(f.remove.mock.calls[0][2]).toMatchObject({ notebookId: "a", id: "same-note" });
  expect(f.notes).toEqual([expect.objectContaining({ notebookId: "c", content: "cloud body" })]);
});
it("moves only the selected copy and keeps the original note open", async () => {
  const f = await fixture();
  act(() => { f.store.setState({ selectedNote: structuredClone(f.notes[0]), selectedNotebookId: "a", draftContent: "original body" }); });
  expect(f.row("Conflict copy").classList.contains("active")).toBe(false);
  fireEvent.click(f.row("Conflict copy"));
  await act(async () => { await f.store.getState().moveSelectedNotes("b"); });
  expect(f.move).toHaveBeenCalledOnce(); expect(f.move.mock.calls[0][2]).toMatchObject({ notebookId: "c", noteId: "same-note", targetNotebookId: "b" });
  expect(f.notes.find(note => note.notebookId === "a")?.content).toBe("original body");
  expect(f.store.getState().selectedNote?.notebookId).toBe("a"); expect(f.store.getState().draftContent).toBe("original body");
});
it("retains the exact failed selection when another same-ID copy was deleted successfully", async () => {
  const f = await fixture(); f.remove.mockRejectedValueOnce(Error("synthetic refusal"));
  fireEvent.click(f.row("Original")); fireEvent.click(f.row("Conflict copy"));
  await act(async () => { await f.store.getState().deleteSelectedNotes(); });
  expect(f.remove).toHaveBeenCalledTimes(2);
  expect(f.store.getState().selectedNoteIds).toEqual([referenceKey({ notebookId: "a", id: "same-note" })]);
  expect(f.notes).toEqual([expect.objectContaining({ notebookId: "a", content: "original body" })]);
});
it("keyboard selection identifies the notebook as well as the note", async () => {
  const f = await fixture(); fireEvent.keyDown(f.row("Conflict copy"), { key: "Enter" });
  expect(f.store.getState().selectedNoteIds).toEqual([referenceKey({ notebookId: "c", id: "same-note" })]);
  expect(f.row("Original").getAttribute("aria-pressed")).toBe("false");
});
