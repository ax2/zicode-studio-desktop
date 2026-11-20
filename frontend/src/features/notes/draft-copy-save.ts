import { t } from "../../shared/i18n";
import type { NoteDraft } from "./draft-repository";
import { editorFingerprint } from "./editor-save";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function createDraftCopySaver({ get, set, capture, gateway, prepare, forget, retireEditor, notify }: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  capture(): NotesOperationScope;
  gateway: NotesGatewayLike;
  prepare(draft: NoteDraft, notebookId: string): Promise<NoteDraft>;
  forget(draft: NoteDraft): Promise<void>;
  retireEditor(state: NotesState): Promise<void>;
  notify(message: string): void;
}) {
  return async function saveCopy(draft: NoteDraft, destination?: string, alreadyPrepared = false) {
    if (get().editorLocked || get().transferBusy || (!alreadyPrepared && draft.saveAttemptNotebookId)) return;
    const scope = capture();
    const notebookId = destination ?? (get().snapshot.notebooks.some((book) => book.id === draft.note.notebookId)
      ? draft.note.notebookId
      : (get().selectedNotebookId ?? get().snapshot.notebooks[0]?.id));
    if (!notebookId || !get().snapshot.notebooks.some((book) => book.id === notebookId)) {
      set({ error: new Error(t("Create a notebook before saving a recovery copy.")) });
      return;
    }
    const before = get();
    const matches =
      before.selectedNote?.id === draft.note.id &&
      before.selectedNote?.notebookId === draft.note.notebookId &&
      before.draftTitle === draft.title &&
      before.draftIcon === draft.icon &&
      before.draftContent === draft.content &&
      JSON.stringify(before.draftTags) === JSON.stringify(draft.tags);
    const fingerprint = editorFingerprint(before);
    set({ editorLocked: true, recoveryBusy: true, error: null });
    get().cancelAutosave();
    let attempted = false;
    let retained = draft;
    try {
      if (!alreadyPrepared) retained = await prepare(draft, notebookId);
      if (!scope.isCurrent()) return;
      attempted = true;
      const response = await gateway.create(scope.sceneId, scope.workspaceId, notebookId, {
        title: draft.title || t("Untitled note"),
        icon: draft.icon,
        content: draft.content,
        tags: draft.tags,
      });
      if (!scope.isCurrent()) return;
      if ((!before.dirty || matches) && fingerprint === editorFingerprint(get())) {
        if (matches) {
          await retireEditor(before);
          if (!scope.isCurrent()) return;
        }
        set({
          selectedNote: response.note,
          selectedNotebookId: notebookId,
          mode: "library",
          preview: false,
          dirty: false,
          saveDisabled: true,
          saveState: "saved",
          selectedTag: null,
          sourceOnly: false,
          query: "",
        });
        get().syncDraftFromNote();
      }
      await forget(retained);
      if (!scope.isCurrent()) return;
      await get().load();
      if (scope.isCurrent()) notify(t("Recovery copy saved as a new note."));
    } catch {
      if (scope.isCurrent())
        set({
          error: new Error(
            t(attempted ? "The save result is uncertain. Check the destination notebook before retrying." : "Could not recover this note. Keep the draft, retry, or download it."),
          ),
        });
    } finally {
      if (scope.isCurrent()) {
        set({ editorLocked: false, recoveryBusy: false });
        if (get().dirty) get().scheduleAutosave();
      }
    }
  };
}
