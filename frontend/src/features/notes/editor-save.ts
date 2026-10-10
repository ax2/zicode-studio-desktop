import { t } from "../../shared/i18n";
import { conversationNoteTitle, DEFAULT_NOTE_ICON, parseTags } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function editorFingerprint(state: NotesState): string {
  return JSON.stringify([
    state.selectedNote?.notebookId,
    state.selectedNote?.id,
    state.draftTitle,
    state.draftIcon,
    state.draftContent,
    state.draftTags,
  ]);
}

export function createNoteEditorSave({
  get,
  set,
  gateway,
  capture,
  notify,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  notify(message: string): void;
  localize(error: unknown): Error;
}) {
  let pending: Promise<void> | null = null;
  async function perform(silent: boolean, scope: NotesOperationScope) {
    if (!scope.isCurrent()) return;
    const draft = get();
    const note = draft.selectedNote;
    if (!note || !draft.dirty) return;
    draft.cancelAutosave();
    const fingerprint = editorFingerprint(draft);
    const title =
      draft.draftTitle.trim() && draft.draftTitle.trim() !== t("Untitled note")
        ? draft.draftTitle.trim()
        : draft.draftContent.trim()
          ? conversationNoteTitle(draft.draftContent)
          : t("Untitled note");
    const sameEditor = () =>
      scope.isCurrent() &&
      get().selectedNote?.id === note.id &&
      get().selectedNote?.notebookId === note.notebookId;
    set({ saveDisabled: true, saveState: "saving" });
    try {
      const response = await gateway.save(scope.sceneId, scope.workspaceId, {
        ...note,
        title,
        content: draft.draftContent,
        icon: draft.draftIcon.trim() || DEFAULT_NOTE_ICON,
        tags: parseTags(draft.draftTags.join(", ")),
      });
      if (!sameEditor()) return;
      const changed = editorFingerprint(get()) !== fingerprint;
      set({
        selectedNote: response.note,
        ...(changed ? {} : { draftTitle: title }),
        dirty: changed,
        saveState: changed ? "dirty" : "saved",
      });
      if (changed) get().scheduleAutosave();
      if (!silent && !changed) notify(t("Note saved"));
      setTimeout(() => {
        if (sameEditor() && !get().dirty && get().saveState === "saved") set({ saveState: "idle" });
      }, 2000);
      await get().load();
      if (sameEditor() && !get().dirty) void get().loadBacklinks(response.note);
    } catch (error) {
      if (sameEditor()) set({ error: localize(error), dirty: true, saveState: "dirty" });
    } finally {
      if (sameEditor()) set({ saveDisabled: !get().dirty });
    }
  }
  return async function saveEditor(silent = false) {
    const scope = capture();
    // Wait for an existing write before taking a new version/content snapshot.
    while (pending) await pending;
    if (!scope.isCurrent()) return;
    const operation = perform(silent, scope);
    pending = operation;
    try {
      await operation;
    } finally {
      if (pending === operation) pending = null;
    }
  };
}
