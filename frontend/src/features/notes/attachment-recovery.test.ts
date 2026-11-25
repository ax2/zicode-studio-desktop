import { waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NoteDraft, NoteDraftRepository } from "./draft-repository";
import type { Note } from "./notesLogic";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const firstNote = { id: "note-1", notebookId: "book-1", title: "Original", content: "Original body", tags: [] as string[], updatedAt: "2026-11-25T00:00:00Z", version: 1 };
const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.getState().destroy();
});

it("keeps a recovered attachment until the saved note includes its link", async () => {
  let saved = firstNote;
  const other = { ...firstNote, id: "other-note", title: "Other note", content: "Unrelated", version: 1 };
  const markdown = "[receipt.txt](/attachments/note-1/00000000-0000-0000-0000-000000000000.txt)";
  const records = new Map<string, NoteDraft>();
  const repository: NoteDraftRepository = {
    list: async () => ({ drafts: [...records.values()], unreadable: 0 }),
    put: async (draft) => { records.set(draft.id, structuredClone(draft)); },
    remove: async (id, revision) => {
      if (records.get(id)?.revision === revision) records.delete(id);
    },
  };
  let finishUpload!: (result: { attachment: { markdown: string } }) => void;
  const uploadAttachment = vi.fn(() => new Promise<{ attachment: { markdown: string } }>((resolve) => {
    finishUpload = resolve;
  }));
  const gateway = {
    list: async () => ({ snapshot: { notebooks: [{ id: firstNote.notebookId, title: "Fixture" }], notes: [saved, other], tags: [] } }),
    knowledge: async () => ({ snapshot: { links: [] } }),
    get: async (_scene: string, _workspace: string, _book: string, id: string) => ({ note: id === saved.id ? saved : other }),
    save: async (_scene: string, _workspace: string, note: Note) => {
      expect(note.id).toBe(saved.id);
      expect(note.version).toBe(saved.version);
      saved = { ...note, updatedAt: saved.updatedAt, version: saved.version + 1 };
      return { note: saved };
    },
    uploadAttachment,
  } as unknown as NotesGatewayLike;
  const mount = () => {
    const store = createNotesStore({
      gateway,
      draftRepository: repository,
      getTarget: () => ({ sceneId: "programming", workspaceId: "isolated-note" }),
      chooseFile: async () => new File(["synthetic"], "receipt.txt", { type: "text/plain" }),
      fileToBase64: async () => btoa("synthetic"),
    });
    stores.push(store);
    return store;
  };
  const store = mount();
  await store.getState().selectNote(saved);
  const upload = store.getState().attachFile();
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
  await store.getState().selectNote(other);
  finishUpload({ attachment: { markdown } });
  await upload;
  const [recovered] = store.getState().recoveryDrafts;
  expect(recovered).toMatchObject({ note: { id: saved.id }, attachmentMarkdown: markdown });

  await store.getState().recoverDraft(recovered.id);
  expect(store.getState().draftContent).toContain(markdown);
  store.getState().setDraft({ content: "Edited body without the link" });
  await store.getState().saveEditor();
  await store.getState().refreshDrafts();
  expect(saved.content).toBe("Edited body without the link");
  expect(records.get(recovered.id)?.attachmentMarkdown).toBe(markdown);
  store.getState().destroy();

  const reopened = mount();
  await reopened.getState().selectNote(saved);
  await reopened.getState().refreshDrafts();
  const codeOnly = "Edited body without the link\n\n" + String.fromCharCode(96) + markdown + String.fromCharCode(96);
  await reopened.getState().recoverDraft(recovered.id);
  reopened.getState().setDraft({ content: codeOnly });
  await reopened.getState().saveEditor();
  await reopened.getState().refreshDrafts();
  expect(saved.content).toBe(codeOnly);
  expect(records.get(recovered.id)?.attachmentMarkdown).toBe(markdown);

  await reopened.getState().recoverDraft(recovered.id);
  await reopened.getState().recoverDraft(recovered.id);
  expect(reopened.getState().draftContent).toBe(codeOnly + "\n\n" + markdown + "\n");
  const renamed = codeOnly + "\n\n" + markdown.replace("receipt.txt", "Renamed receipt") + "\n";
  reopened.getState().setDraft({ content: renamed });
  await reopened.getState().saveEditor();
  await reopened.getState().refreshDrafts();
  expect(saved.content).toBe(renamed);
  expect(reopened.getState().recoveryDrafts).toHaveLength(0);
  expect(records.has(recovered.id)).toBe(false);
  expect(uploadAttachment).toHaveBeenCalledTimes(1);
});
