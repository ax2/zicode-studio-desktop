import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotesContent } from "./NotesApp";
import { type NotesGatewayLike, createNotesStore } from "./notesStore";

afterEach(cleanup);

async function openEditor() {
  const note = {
    id: "note",
    notebookId: "book",
    title: "Current",
    content: "First line\nLast line ",
    tags: [],
    updatedAt: "2026-11-26T00:00:00Z",
  };
  const target = { ...note, id: "target", title: "Reference target" };
  const gateway = {
    list: async () => ({
      snapshot: {
        notebooks: [{ id: "book", title: "Fixture" }],
        notes: [note, target],
        tags: [],
      },
    }),
    get: async () => ({ note }),
    knowledge: async () => ({ snapshot: { links: [] } }),
  } as unknown as NotesGatewayLike;
  const store = createNotesStore({ gateway, getTarget: () => ({ sceneId: "fixture", workspaceId: "isolated" }) });
  await store.getState().load();
  await store.getState().selectNote(note);
  store.getState().setPreview(false);
  const view = render(<NotesContent store={store} />);
  const editor = view.container.querySelector(".notes-content-input");
  if (!(editor instanceof HTMLTextAreaElement)) throw new Error("Expected a note textarea");
  editor.focus();
  const unfinished = `${note.content}[[Ref`;
  fireEvent.change(editor, { target: { value: unfinished } });
  const suggestion = await view.findByRole("option", { name: "Reference target" });
  return { store, view, editor, unfinished, suggestion };
}

it.each(["Enter", "Tab", "click"])("does not complete a stale wikilink suggestion on %s", async (action) => {
  const { store, view, editor, unfinished, suggestion } = await openEditor();
  try {
    const lineStart = "First line\n".length;
    if (action === "click") {
      editor.setSelectionRange(lineStart, unfinished.length);
      fireEvent.click(suggestion);
    } else {
      editor.setSelectionRange(lineStart, lineStart);
      const keydown = new KeyboardEvent("keydown", { key: action, bubbles: true, cancelable: true });
      fireEvent(editor, keydown);
      expect(keydown.defaultPrevented).toBe(action === "Tab");
    }
    expect(view.queryByRole("listbox")).toBeNull();
    expect(editor.value).toBe(action === "Tab" ? "First line\n  Last line [[Ref" : unfinished);
  } finally {
    store.getState().destroy();
  }
});

it("keeps the newer suggestion after an earlier blur delay expires", async () => {
  const { store, view, editor, unfinished } = await openEditor();
  vi.useFakeTimers();
  try {
    fireEvent.blur(editor);
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: `${unfinished}er` } });
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(view.getByRole("option", { name: "Reference target" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
    store.getState().destroy();
  }
});
