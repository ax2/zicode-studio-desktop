import { t } from "../../shared/i18n";
import { editorFingerprint } from "./editor-save";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function createEditorConflict({ get, set, gateway, capture, waitForSave, retain, notify }: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  waitForSave(): Promise<void>;
  retain(state: NotesState): Promise<void>;
  notify(message: string): void;
}) {
  return {
    async reloadConflictedNote() {
      const before = get();
      const note = before.selectedNote;
      const isConflict = () => (get().error as (Error & { code?: string }) | null)?.code === "version_conflict";
      if (!note || !before.dirty || !isConflict() || before.editorLocked || before.transferBusy || before.recoveryBusy) return;
      const scope = capture();
      const fingerprint = editorFingerprint(before);
      const current = () => scope.isCurrent() && editorFingerprint(get()) === fingerprint;
      set({ editorLocked: true });
      get().cancelAutosave();
      try {
        await waitForSave();
        if (!current() || !get().dirty || !isConflict()) return;
        // Read first: failed reads keep the current editor and ordinary recovery draft.
        const response = await gateway.get(scope.sceneId, scope.workspaceId, note.notebookId, note.id);
        if (!current()) return;
        if (response.note.id !== note.id || response.note.notebookId !== note.notebookId) throw new Error("Unexpected note identity");
        await retain(get());
        if (!current()) return;
        set({
          selectedNote: response.note, selectedNotebookId: response.note.notebookId,
          draftTitle: response.note.title, draftIcon: response.note.icon ?? "",
          draftContent: response.note.content, draftTags: [...response.note.tags],
          dirty: false, saveDisabled: true, saveState: "idle", error: null,
        });
        void get().loadBacklinks(response.note);
        notify(t("Saved version loaded. Your edits are kept in Local note recovery."));
      } catch {
        if (current()) set({ error: Object.assign(new Error(t("Could not reload this note safely. Your edits are still in the editor. Retry or download your draft.")), { code: "version_conflict" }) });
      } finally {
        if (scope.isCurrent()) set({ editorLocked: false, saveDisabled: !get().dirty });
      }
    },
  };
}
