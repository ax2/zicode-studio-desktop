import { t } from "../../shared/i18n";
import type { EditorTransition, EditorTransitionGuard } from "./editor-transition";
import type { NoteSummary } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function createEditorMutations({
  get,
  set,
  gateway,
  guard,
  capture,
  notify,
  confirmDelete,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  guard: EditorTransitionGuard;
  capture(): NotesOperationScope;
  notify(message: string): void;
  confirmDelete(message: string): boolean | Promise<boolean>;
  localize(error: unknown): Error;
}) {
  const key = (note: NoteSummary) => `${note.notebookId}/${note.id}`;
  async function mutate(
    ticket: EditorTransition,
    notes: NoteSummary[],
    target?: string,
    batch = false,
  ) {
    if (!notes.length) return;
    const unlock = guard.lock(ticket);
    if (!unlock) return;
    set({ loading: true, error: null });
    const succeeded = new Set<string>();
    let firstError: Error | null = null;
    try {
      for (const note of notes) {
        if (!ticket.isCurrent()) return;
        try {
          if (target)
            await gateway.moveNote(ticket.sceneId, ticket.workspaceId, {
              notebookId: note.notebookId,
              noteId: note.id,
              targetNotebookId: target,
              expectedVersion: note.version,
            });
          else await gateway.delete(ticket.sceneId, ticket.workspaceId, note);
          succeeded.add(key(note));
        } catch (error) {
          firstError ??= localize(error);
        }
      }
      if (!ticket.isCurrent()) return;
      const current = get().selectedNote;
      if (current && succeeded.has(key(current))) set({ selectedNote: null, dirty: false });
      if (batch) {
        const completedIds = new Set(
          notes.filter((note) => succeeded.has(key(note))).map((note) => note.id),
        );
        const remaining = get().selectedNoteIds.filter((id) => !completedIds.has(id));
        set({ selectedNoteIds: remaining, selectMode: remaining.length > 0 });
      }
      set({ moveNote: null });
      await get().load({ preserveSelection: true });
      if (!ticket.isCurrent()) return;
      if (!target) void get().loadTrash();
      if (succeeded.size)
        notify(
          target
            ? batch
              ? t("Notes moved")
              : t("Note moved")
            : batch
              ? t("Notes moved to trash")
              : t("Note deleted"),
        );
      if (firstError) set({ error: firstError });
    } finally {
      unlock();
      if (ticket.isCurrent()) set({ loading: false });
    }
  }
  // The saved editor carries the latest version even if the list refresh failed.
  function summaries(ticket: EditorTransition) {
    const state = ticket.state;
    return state.snapshot.notes.map((note) =>
      state.selectedNote && key(note) === key(state.selectedNote) ? state.selectedNote : note,
    );
  }
  return {
    async deleteSelectedNote() {
      const ticket = await guard.prepare();
      if (ticket?.state.selectedNote) await mutate(ticket, [ticket.state.selectedNote]);
    },
    async moveNoteTo(sourceNotebookId: string, noteId: string, targetNotebookId: string) {
      if (!targetNotebookId || sourceNotebookId === targetNotebookId) return;
      const ticket = await guard.prepare();
      if (!ticket) return;
      const note = summaries(ticket).find(
        (item) => item.id === noteId && item.notebookId === sourceNotebookId,
      );
      if (note) await mutate(ticket, [note], targetNotebookId);
    },
    async moveSelectedNotes(targetNotebookId: string) {
      if (!targetNotebookId) return;
      const ticket = await guard.prepare();
      if (!ticket) return;
      const notes = summaries(ticket).filter(
        (note) =>
          ticket.state.selectedNoteIds.includes(note.id) && note.notebookId !== targetNotebookId,
      );
      await mutate(ticket, notes, targetNotebookId, true);
    },
    async deleteSelectedNotes() {
      const ticket = await guard.prepare();
      if (!ticket) return;
      await mutate(
        ticket,
        summaries(ticket).filter((note) => ticket.state.selectedNoteIds.includes(note.id)),
        undefined,
        true,
      );
    },
    async deleteNotebook(notebookId: string) {
      const scope = capture();
      const notebook = get().snapshot.notebooks.find((item) => item.id === notebookId);
      if (!notebook || get().editorLocked) return;
      if (
        !(await confirmDelete(
          `${t("Delete notebook")} “${notebook.title}”? ${t("Child notebooks and notes will also move to trash.")}`,
        )) ||
        !scope.isCurrent()
      )
        return;
      const ticket = await guard.prepare();
      if (!ticket) return;
      const affected = new Set([notebookId]);
      // A visited set also bounds malformed cyclic notebook trees.
      for (const id of affected) {
        for (const item of ticket.state.snapshot.notebooks)
          if (item.parentId === id) affected.add(item.id);
      }
      const unlock = guard.lock(ticket);
      if (!unlock) return;
      set({ loading: true, error: null });
      try {
        await gateway.deleteNotebook(ticket.sceneId, ticket.workspaceId, notebookId);
        if (!ticket.isCurrent()) return;
        const { selectedNote, selectedNotebookId } = get();
        if (selectedNote && affected.has(selectedNote.notebookId))
          set({ selectedNote: null, dirty: false });
        if (selectedNotebookId && affected.has(selectedNotebookId))
          set({ selectedNotebookId: null });
        await get().load({ preserveSelection: true });
        if (!ticket.isCurrent()) return;
        void get().loadTrash();
        notify(t("Notebook moved to trash"));
      } catch (error) {
        if (ticket.isCurrent()) set({ error: localize(error) });
      } finally {
        unlock();
        if (ticket.isCurrent()) set({ loading: false });
      }
    },
  };
}
