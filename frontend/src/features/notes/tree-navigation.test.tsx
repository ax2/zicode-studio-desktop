import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NotesNav } from "./NotesApp";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const handles: ReturnType<typeof createNotesStore>[] = [];
const workspace = "nested-tree-navigation";
afterEach(() => {
  cleanup();
  for (const store of handles.splice(0)) store.getState().destroy();
  localStorage.removeItem(`zicode.notes-layout.v1:["programming","${workspace}"]`);
});

async function fixture(openRoots = false) {
  const books = [
    { id: "a", title: "A root" },
    { id: "b", title: "B child", parentId: "a" },
    { id: "c", title: "C grandchild", parentId: "b" },
    { id: "z", title: "Z root" },
    { id: "zz", title: "Z child", parentId: "z" },
  ];
  const notes = ["b", "c", "zz"].map(id => ({ id: `note-${id}`, notebookId: id, title: `Note ${id}`, content: "Body", tags: [], version: 1 }));
  const store = createNotesStore({
    getTarget: () => ({ sceneId: "programming", workspaceId: workspace }),
    gateway: {
      list: async () => ({ snapshot: { notebooks: books, notes, tags: [] } }),
      get: async (_scene: string, _workspace: string, _book: string, id: string) => ({ note: notes.find(note => note.id === id) }),
      knowledge: async () => ({ snapshot: {} }),
      listTrash: async () => ({ trash: [] }),
    } as unknown as NotesGatewayLike,
    draftRepository: { put: async () => {}, remove: async () => {}, list: async () => ({ drafts: [], unreadable: 0 }) },
  });
  handles.push(store);
  await store.getState().load();
  store.setState({ expandedNotebookIds: new Set(openRoots ? ["a", "b", "c", "z", "zz"] : ["b", "c", "zz"]) });
  const view = render(<NotesNav store={store} />);
  const summary = (id: string) => view.container.querySelector<HTMLElement>(`[data-notebook-id="${id}"] > summary`)!;
  return { store, view, summary };
}

it.each([
  ["a", "ArrowDown", "z"],
  ["z", "ArrowUp", "a"],
  ["a", "End", "z"],
])("moves %s with %s to visible %s instead of an expanded descendant of a closed book", async (from, key, to) => {
  const { summary } = await fixture();
  summary(from).focus();
  fireEvent.keyDown(summary(from), { key });
  expect(document.activeElement).toBe(summary(to));
});

it("restores nested keyboard traversal when a collapsed ancestor opens again", async () => {
  const { store, summary, view } = await fixture();
  await act(async () => store.getState().toggleNotebookExpanded("a", true));
  summary("a").focus();
  fireEvent.keyDown(summary("a"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(summary("b"));
  fireEvent.keyDown(summary("b"), { key: "ArrowDown" });
  expect(document.activeElement?.classList.contains("notes-tree-note")).toBe(true);
  expect(document.activeElement?.textContent).toContain("Note b");
  expect(view.container.querySelector<HTMLDetailsElement>('[data-notebook-id="c"]')?.open).toBe(true);
});
