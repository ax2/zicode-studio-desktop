import { afterEach, expect, it, vi } from "vitest";
import type { NoteDraft } from "./draft-repository";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.getState().destroy();
});
function fixture() {
  const records = new Map<string, NoteDraft>();
  const repository = {
    list: vi.fn(async () => ({ drafts: [...records.values()], unreadable: 0 })),
    put: vi.fn(async (draft: NoteDraft) => {
      records.set(draft.id, structuredClone(draft));
    }),
    remove: vi.fn(async (id: string, revision: string) => {
      if (records.get(id)?.revision === revision) records.delete(id);
    }),
  };
  const create = vi.fn(
    async (
      _scene: string,
      _workspace: string,
      notebookId: string,
      input: { title: string; content: string },
    ) => ({
      note: { id: "saved", notebookId, title: input.title, content: input.content, tags: [] },
    }),
  );
  const gateway = {
    create,
    list: vi.fn(async () => ({
      snapshot: { notebooks: [{ id: "book", title: "Book" }], notes: [], tags: [] },
    })),
  } as unknown as NotesGatewayLike;
  const target = { sceneId: "programming", workspaceId: "workspace" };
  const store = createNotesStore({ gateway, draftRepository: repository, getTarget: () => target });
  stores.push(store);
  store.setState({
    snapshot: { notebooks: [{ id: "book", title: "Book" }], notes: [], tags: [] },
    selectedNotebookId: "book",
  });
  return { store, records, repository, create, target };
}

it("retains incoming material separately and creates a note only on explicit save", async () => {
  const { store, records, create } = fixture();
  const note = {
    id: "original",
    notebookId: "book",
    title: "Existing",
    content: "saved",
    tags: [],
  };
  store.setState({
    selectedNote: note,
    draftTitle: "Existing",
    draftContent: "unsaved edits",
    dirty: true,
  });
  store.getState().cancelAutosave();
  await store
    .getState()
    .receiveIncomingDraft({ title: "Report", content: "complete report" }, () => true);
  const incoming = [...records.values()].find((row) => row.incoming);
  expect(incoming?.content).toBe("complete report");
  if (!incoming) throw new Error("Incoming draft was not stored");
  expect(store.getState().draftContent).toBe("unsaved edits");
  expect(store.getState().selectedNote?.id).toBe("original");
  expect(create).not.toHaveBeenCalled();
  await store.getState().recoverDraft(incoming.id);
  expect(store.getState().selectedNote?.id).toBe("original");
  await store.getState().saveIncomingDraft(incoming.id, "book");
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][3].content).toBe("complete report");
  expect(store.getState().draftContent).toBe("unsaved edits");
  expect(store.getState().selectedNote?.id).toBe("original");
});
it("edits only the incoming draft and saves the latest revision to the selected notebook", async () => {
  const { store, records, create } = fixture();
  store.setState({ snapshot: { notebooks: [{ id: "book", title: "Book" }, { id: "other", title: "Other" }], notes: [], tags: [] } });
  await store.getState().receiveIncomingDraft({ title: "Report", content: "before" }, () => true);
  const incoming = [...records.values()].find((row) => row.incoming);
  if (!incoming) throw new Error("Draft missing");
  store.getState().updateIncomingDraft(incoming.id, { title: "Edited", content: "edited content" });
  expect(store.getState().recoveryPending).toBe(true);
  await store.getState().saveIncomingDraft(incoming.id, "other");
  expect(create.mock.calls[0][2]).toBe("other");
  expect(create.mock.calls[0][3]).toMatchObject({ title: "Edited", content: "edited content" });
  expect(records.has(incoming.id)).toBe(false);
});
it("retains edited content and does not create a note if draft persistence fails", async () => {
  const { store, records, repository, create } = fixture();
  await store.getState().receiveIncomingDraft({ title: "Report", content: "before" }, () => true);
  const incoming = [...records.values()].find((row) => row.incoming);
  if (!incoming) throw new Error("Draft missing");
  store.getState().updateIncomingDraft(incoming.id, { content: "unsaved change" });
  repository.put.mockRejectedValueOnce(new Error("storage unavailable"));
  await store.getState().saveIncomingDraft(incoming.id, "book");
  expect(create).not.toHaveBeenCalled();
  expect(store.getState().recoveryDrafts.find((row) => row.id === incoming.id)?.content).toBe("unsaved change");
  expect(store.getState().recoveryPending).toBe(true);
});
it("persists an uncertain save and refuses automatic retry until explicitly acknowledged", async () => {
  const { store, records, create, repository } = fixture();
  await store.getState().receiveIncomingDraft({ title: "Report", content: "content" }, () => true);
  const incoming = [...records.values()].find((row) => row.incoming);
  if (!incoming) throw new Error("Draft missing");
  create.mockRejectedValueOnce(new Error("response lost after write"));
  await store.getState().saveIncomingDraft(incoming.id, "book");
  expect(records.get(incoming.id)?.saveAttemptNotebookId).toBe("book");
  expect(create).toHaveBeenCalledTimes(1);
  await store.getState().refreshDrafts();
  await store.getState().saveIncomingDraft(incoming.id, "book");
  expect(create).toHaveBeenCalledTimes(1);
  expect(store.getState().recoveryDrafts.find((row) => row.id === incoming.id)?.content).toBe("content");
  await store.getState().acknowledgeDraftSave(incoming.id);
  expect(records.get(incoming.id)?.saveAttemptNotebookId).toBeUndefined();
  await store.getState().saveIncomingDraft(incoming.id, "book");
  expect(create).toHaveBeenCalledTimes(2);
  expect(records.has(incoming.id)).toBe(false);
  expect(repository.remove).toHaveBeenCalled();
});
it("does not start the Host write when the attempt marker cannot be stored", async () => {
  const { store, records, repository, create } = fixture();
  await store.getState().receiveIncomingDraft({ title: "Report", content: "content" }, () => true);
  const incoming = [...records.values()].find((row) => row.incoming);
  if (!incoming) throw new Error("Draft missing");
  repository.put.mockRejectedValueOnce(new Error("disk unavailable"));
  await store.getState().saveIncomingDraft(incoming.id, "book");
  expect(create).not.toHaveBeenCalled();
  expect(records.get(incoming.id)?.content).toBe("content");
  expect(records.get(incoming.id)?.saveAttemptNotebookId).toBeUndefined();
});
it("removes only the newly staged draft when source access expires during persistence", async () => {
  const { store, records, create, repository } = fixture();
  let current = true;
  await expect(store.getState().receiveIncomingDraft({ title: "Report", content: "content" }, () => current, async () => {
    current = false;
    throw new Error("permission revoked");
  })).rejects.toThrow();
  expect(records.size).toBe(0);
  expect(repository.remove).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(store.getState().recoveryDrafts).toHaveLength(0);
});
it("never deletes a newer revision created while the staged draft was being verified", async () => {
  const { store, records, repository } = fixture();
  await expect(store.getState().receiveIncomingDraft({ title: "Report", content: "content" }, () => true, async () => {
    const draft = [...records.values()][0];
    await repository.put({ ...draft, revision: "newer", content: "other view's edit" });
    throw new Error("permission revoked");
  })).rejects.toThrow();
  expect([...records.values()][0]).toMatchObject({ revision: "newer", content: "other view's edit" });
});
it("rejects stale targets and storage failures without creating or replacing a note", async () => {
  const { store, records, repository, create } = fixture();
  await expect(
    store.getState().receiveIncomingDraft({ title: "R", content: "x" }, () => false),
  ).rejects.toThrow();
  expect(repository.put).not.toHaveBeenCalled();
  repository.put.mockRejectedValueOnce(new Error("unavailable"));
  await expect(
    store.getState().receiveIncomingDraft({ title: "R", content: "x" }, () => true),
  ).rejects.toThrow();
  expect(records.size).toBe(0);
  expect(create).not.toHaveBeenCalled();
});
