import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { NoteDraftRecovery } from "./NoteDraftRecovery";
import { draftScope, type NoteDraft } from "./draft-repository";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.getState().destroy(); });
async function fixture() {
  const target = { sceneId: "programming", workspaceId: "copy-workspace" };
  const draft: NoteDraft = {
    id: "copy-draft", revision: "original", scope: draftScope(target), updatedAt: new Date().toISOString(),
    title: "Recovered writing", content: "Keep these edits 中文", icon: "📝", tags: ["local"],
    note: { id: "original-note", notebookId: "copy-book", title: "Original", content: "Original", tags: [], version: 1 },
  };
  const records = new Map([[draft.id, structuredClone(draft)]]);
  const notes: Array<{ id: string; notebookId: string; title: string; content: string; tags: string[] }> = [];
  const repository = {
    list: vi.fn(async () => ({ drafts: [...records.values()], unreadable: 0 })),
    put: vi.fn(async (value: NoteDraft) => { records.set(value.id, structuredClone(value)); }),
    remove: vi.fn(async (id: string, revision: string) => { if (records.get(id)?.revision === revision) records.delete(id); }),
  };
  let loseResponse = true;
  const create = vi.fn(async (_scene: string, _workspace: string, notebookId: string, input: { title: string; content: string; tags: string[] }) => {
    const note = { ...input, id: `copy-${notes.length + 1}`, notebookId };
    notes.push(note);
    if (loseResponse) { loseResponse = false; throw new Error("Response lost after commit"); }
    return { note };
  });
  const gateway = { create, list: async () => ({ snapshot: { notebooks: [{ id: "copy-book", title: "Recovery book" }], notes, tags: [] } }) } as unknown as NotesGatewayLike;
  const store = createNotesStore({ gateway, draftRepository: repository, getTarget: () => target });
  stores.push(store);
  await store.getState().load();
  await store.getState().refreshDrafts();
  return { store, draft, records, repository, create, notes, allowSuccess: () => { loseResponse = false; } };
}

it("does not create another ordinary recovery copy after a lost save response", async () => {
  const { store, draft, create, notes, records } = await fixture();
  await store.getState().recoverDraft(draft.id, true);
  expect(notes).toHaveLength(1);
  await store.getState().refreshDrafts();
  await store.getState().recoverDraft(draft.id, true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(records.get(draft.id)).toMatchObject({ content: "Keep these edits 中文", saveAttemptNotebookId: "copy-book" });
});

it("does not call the Host if the save attempt cannot be persisted", async () => {
  const { store, draft, repository, create, records } = await fixture();
  repository.put.mockRejectedValueOnce(new Error("Storage unavailable"));
  await store.getState().recoverDraft(draft.id, true);
  expect(create).not.toHaveBeenCalled();
  expect(records.get(draft.id)).toMatchObject({ content: "Keep these edits 中文" });
  expect(records.get(draft.id)?.saveAttemptNotebookId).toBeUndefined();
});

it("keeps replay blocked in a newly created store until acknowledged", async () => {
  const { store, draft, repository, create, records } = await fixture();
  await store.getState().recoverDraft(draft.id, true);
  const restored = createNotesStore({
    draftRepository: repository,
    gateway: { create, list: async () => ({ snapshot: { notebooks: [{ id: "copy-book", title: "Recovery book" }], notes: [], tags: [] } }) } as unknown as NotesGatewayLike,
    getTarget: () => ({ sceneId: "programming", workspaceId: "copy-workspace" }),
  });
  stores.push(restored);
  await restored.getState().load();
  await restored.getState().refreshDrafts();
  await restored.getState().recoverDraft(draft.id, true);
  expect(create).toHaveBeenCalledTimes(1);
  await restored.getState().acknowledgeDraftSave(draft.id);
  expect(records.get(draft.id)?.saveAttemptNotebookId).toBeUndefined();
  await restored.getState().recoverDraft(draft.id, true);
  expect(create).toHaveBeenCalledTimes(2);
  expect(records.has(draft.id)).toBe(false);
});

it("exposes the destination and requires explicit acknowledgement in the recovery panel", async () => {
  const { store, draft, create } = await fixture();
  const view = render(<NoteDraftRecovery store={store} />);
  await act(async () => { await store.getState().recoverDraft(draft.id, true); });
  const article = view.getByText(draft.title).closest("article");
  if (!article) throw new Error("Missing recovery draft");
  const area = within(article);
  expect(area.getByRole("alert").textContent).toContain("Recovery book");
  const save = area.getByRole("button", { name: t("Save draft as new note") }) as HTMLButtonElement;
  const allow = area.getByRole("button", { name: t("Allow another attempt") }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(allow.disabled).toBe(true);
  fireEvent.click(save);
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(area.getByRole("checkbox"));
  fireEvent.click(allow);
  await waitFor(() => expect(save.disabled).toBe(false));
  expect(area.queryByRole("alert")).toBeNull();
});

it("retains the attempt when acknowledgement persistence fails", async () => {
  const { store, draft, create, repository, records } = await fixture();
  await store.getState().recoverDraft(draft.id, true);
  repository.put.mockRejectedValueOnce(new Error("Storage unavailable"));
  await store.getState().acknowledgeDraftSave(draft.id);
  await store.getState().recoverDraft(draft.id, true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(records.get(draft.id)?.saveAttemptNotebookId).toBe("copy-book");
});

it("cleans up a recovery copy only after a successful Host response", async () => {
  const { store, draft, records, allowSuccess, notes } = await fixture();
  allowSuccess();
  await store.getState().recoverDraft(draft.id, true);
  expect(notes).toHaveLength(1);
  expect(records.has(draft.id)).toBe(false);
  expect(store.getState()).toMatchObject({ dirty: false, editorLocked: false, recoveryBusy: false, selectedNote: { content: "Keep these edits 中文" } });
});
