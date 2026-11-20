import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { NotesContent, NotesNav } from "./NotesApp";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const handles: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => { cleanup(); for (const store of handles.splice(0)) store.getState().destroy(); localStorage.removeItem('zicode.notes-layout.v1:["programming","layout-v2"]'); });
const books = [{ id: "a", title: "A notebook with a very long complete title" }, { id: "b", title: "B notebook" }];
const note = { id: "one", notebookId: "a", title: "Note title stretches to the edge", content: "Body", tags: [], version: 1 };
async function fixture(overrides: Partial<NotesGatewayLike> = {}) {
  const del = vi.fn(async () => ({}));
  const store = createNotesStore({
    getTarget: () => ({ sceneId: "programming", workspaceId: "layout-v2" }),
    gateway: {
      list: async () => ({ snapshot: { notebooks: books, notes: [note], tags: [] } }),
      get: async () => ({ note }), delete: del, knowledge: async () => ({ snapshot: {} }), listTrash: async () => ({ trash: [] }),
      ...overrides,
    } as unknown as NotesGatewayLike,
    draftRepository: { put: async () => {}, remove: async () => {}, list: async () => ({ drafts: [], unreadable: 0 }) },
  });
  handles.push(store); await store.getState().load(); return { store, del };
}
it("migrates a legacy ranking once and keeps expansions local across authoritative reloads", async () => {
  const key = 'zicode.notes-layout.v1:["programming","layout-v2"]';
  localStorage.setItem(key, JSON.stringify({ order: ["b", "gone", "a"], expanded: ["a"] }));
  let saved: string[] | null = null;
  const saveNotebookOrder = vi.fn(async (_scene: string, _workspace: string, expected: string[] | null, ids: string[]) => {
    expect(expected).toEqual(saved);
    saved = ids;
  });
  const { store } = await fixture({
    list: async () => ({ snapshot: { notebooks: books, notes: [note], tags: [], notebookOrder: saved } }) as Awaited<ReturnType<NotesGatewayLike["list"]>>,
    saveNotebookOrder,
  });
  await waitFor(() => expect(saved).toEqual(["b", "a"]));
  expect(JSON.parse(localStorage.getItem(key) ?? "{}")).toEqual({ expanded: ["a"], order: [] });
  saved = ["a", "b"];
  await store.getState().load();
  expect(store.getState().snapshot.notebooks.map(book => book.id)).toEqual(saved);
  expect([...store.getState().expandedNotebookIds]).toEqual(["a"]);
  store.getState().reorderNotebook("b", "a");
  store.getState().reorderNotebook("a", "b");
  await waitFor(() => expect(saveNotebookOrder).toHaveBeenCalledTimes(3));
  expect(saved).toEqual(["a", "b"]);
});
it("discards queued writes after another window wins and reloads its ranking", async () => {
  const remote = ["a", "b"];
  const list = vi.fn(async () => ({ snapshot: { notebooks: books, notes: [note], tags: [], notebookOrder: remote } }) as Awaited<ReturnType<NotesGatewayLike["list"]>>);
  const saveNotebookOrder = vi.fn(async () => { throw Object.assign(new Error("order changed"), { code: "notebook_order_changed" }); });
  const { store } = await fixture({ list, saveNotebookOrder });
  store.getState().reorderNotebook("b", "a");
  store.getState().reorderNotebook("a", "b");
  remote.reverse();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(saveNotebookOrder).toHaveBeenCalledTimes(1);
  expect(store.getState().snapshot.notebooks.map(book => book.id)).toEqual(["b", "a"]);
});
it("starts collapsed and restores notebook expansion and custom order in a new store", async () => {
  const { store } = await fixture();
  expect(store.getState().expandedNotebookIds.size).toBe(0);
  store.getState().toggleNotebookExpanded("a", true);
  store.getState().reorderNotebook("b", "a");
  const { store: restored } = await fixture();
  expect([...restored.getState().expandedNotebookIds]).toEqual(["a"]);
  expect(restored.getState().snapshot.notebooks.map(book => book.id)).toEqual(["b", "a"]);
  restored.getState().toggleNotebookExpanded("a", false);
  const { store: collapsed } = await fixture();
  expect(collapsed.getState().expandedNotebookIds.size).toBe(0);
});
it("reorders the notebook tree through its drop handler without changing hierarchy", async () => {
  const { store } = await fixture();
  const view = render(<NotesNav store={store} />);
  const target = view.container.querySelector('[data-notebook-id="a"] > summary');
  if (!target) throw new Error("Missing notebook summary");
  fireEvent.drop(target, { dataTransfer: { getData: () => "b" }, clientY: 0 });
  expect([...view.container.querySelectorAll('.notes-notebook-branch')].map(e => (e as HTMLElement).dataset.notebookId)).toEqual(["b", "a"]);
  expect(view.container.querySelector('.notes-notebook-summary small')).toBeNull();
});
it("offers pin and management on note rows, with deletion only inside management", async () => {
  const { store, del } = await fixture();
  await store.getState().selectNote(note);
  const nav = render(<NotesNav store={store} />);
  const content = render(<NotesContent store={store} />);
  expect(content.container.querySelector('.notes-delete')).toBeNull();
  expect(content.container.lastElementChild?.getAttribute('aria-label')).toBe(t("Local note recovery"));
  const manage = nav.container.querySelector('.notes-manage-btn');
  if (!manage) throw new Error("Missing note management");
  expect(nav.container.querySelector('.notes-tree-note .notes-drag-handle')).toBeNull();
  expect(nav.container.querySelector('.notes-tree-note .notes-move-btn')).toBeNull();
  fireEvent.click(manage);
  fireEvent.click(content.getByRole('menuitem', { name: t('Delete note') }));
  expect(del).not.toHaveBeenCalled();
  fireEvent.click(content.getByRole('menuitem', { name: t('Confirm delete') }));
  await waitFor(() => expect(del).toHaveBeenCalledWith('programming', 'layout-v2', expect.objectContaining({ id: note.id, version: 1 })));
});
