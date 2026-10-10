import { t } from "../../shared/i18n";
import { editorFingerprint } from "./editor-save";
import type { NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export interface EditorTransition extends NotesOperationScope {
  state: NotesState;
  unchanged(): boolean;
}

function context(state: NotesState) {
  return JSON.stringify([
    editorFingerprint(state),
    state.selectedNotebookId,
    state.mode,
    state.query,
    state.selectedTag,
    state.sourceOnly,
  ]);
}

export function createEditorTransition({
  get,
  set,
  capture,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  capture(): NotesOperationScope;
  localize(error: unknown): Error;
}) {
  return {
    async prepare(): Promise<EditorTransition | null> {
      const scope = capture();
      if (!scope.isCurrent() || get().editorLocked || get().transferBusy) return null;
      const previous = get();
      try {
        await get().saveEditor(true);
      } catch (error) {
        if (scope.isCurrent()) set({ error: localize(error) });
        return null;
      }
      if (!scope.isCurrent() || get().editorLocked || get().transferBusy) return null;
      const state = get();
      if (
        state.selectedNote?.id !== previous.selectedNote?.id ||
        state.selectedNote?.notebookId !== previous.selectedNote?.notebookId ||
        state.selectedNotebookId !== previous.selectedNotebookId
      )
        return null;
      if (state.dirty) {
        set({
          error:
            state.error ??
            new Error(
              t(
                "Save the current note successfully before continuing. Your edits are still in the editor.",
              ),
            ),
        });
        return null;
      }
      const fingerprint = context(state);
      return {
        ...scope,
        state,
        unchanged: () =>
          scope.isCurrent() &&
          !get().editorLocked &&
          !get().dirty &&
          context(get()) === fingerprint,
      };
    },
    lock(ticket: EditorTransition): (() => void) | null {
      if (!ticket.unchanged() || get().editorLocked || get().transferBusy) return null;
      set({ editorLocked: true });
      return () => {
        if (ticket.isCurrent()) set({ editorLocked: false });
      };
    },
  };
}
export type EditorTransitionGuard = ReturnType<typeof createEditorTransition>;
