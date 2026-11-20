import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { NotesContent, NotesNav } from "./NotesApp";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";
import { emptyShortcuts } from "./shortcut-repository";

const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => {
  cleanup(); for (const store of stores.splice(0)) store.getState().destroy();
  setLocale("zh-CN");
});

it("keeps note previews, titles, tags and outline entries as authored across language switches", async () => {
  const note = { id: "content-note", notebookId: "content-book", title: "Settings", content: "# Settings\n\nTools\n\n`Copy`\n\n```text\nSettings\n```", tags: ["Tools"] };
  const save = vi.fn(), put = vi.fn();
  const store = createNotesStore({
    gateway: {
      list: async () => ({ snapshot: { notebooks: [{ id: note.notebookId, title: "Copy" }], notes: [note], tags: note.tags } }),
      get: async () => ({ note }), knowledge: async () => ({ snapshot: { links: [] } }), save,
    } as unknown as NotesGatewayLike,
    getTarget: () => ({ sceneId: "programming", workspaceId: "content-test" }),
    draftRepository: { list: async () => ({ drafts: [], unreadable: 0 }), put, remove: vi.fn() },
    shortcutRepository: { read: async () => emptyShortcuts(), change: async () => emptyShortcuts() },
  });
  stores.push(store);
  setLocale("en");
  await store.getState().load(); await store.getState().selectNote(note);
  store.getState().setPreview(true);
  const view = render(<><NotesNav store={store} /><NotesContent store={store} /></>);
  await waitFor(() => expect(view.container.querySelector(".notes-preview h1")?.textContent).toBe("Settings"));
  const preview = view.container.querySelector(".notes-preview");
  for (const locale of ["zh-CN", "en", "zh-CN"]) {
    await act(async () => { setLocale(locale); });
    expect(view.container.querySelector(".notes-preview")).toBe(preview);
    expect(preview?.querySelector("h1")?.textContent).toBe("Settings");
    expect(preview?.querySelector("p")?.textContent).toBe("Tools");
    expect(preview?.querySelector("code")?.textContent).toBe("Copy");
    expect(preview?.querySelector("pre code")?.textContent).toBe("Settings");
    expect(view.container.querySelector(".notes-notebook-title")?.textContent).toBe("Copy");
    expect(view.container.querySelector(".notes-tag-chip-name")?.textContent).toBe("Tools");
    const heading = view.container.querySelector(".notes-outline li button");
    expect(heading?.textContent).toBe("Settings"); expect(heading?.getAttribute("title")).toBe("Settings");
    expect(store.getState().draftContent).toBe(note.content);
    expect(store.getState().draftTitle).toBe(note.title);
  }
  expect(save).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
