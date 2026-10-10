import type { StoreApi } from "zustand";
import { t } from "../../shared/i18n";
import type { Note } from "./notesLogic";
import type { NoteBacklink, NotesGatewayLike, NotesState, SimilarNote } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function createNoteRelationships({
  get,
  set,
  gateway,
  capture,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  localize(error: unknown): Error;
}) {
  let sequence = 0;
  return async (note: Note) => {
    const scope = capture();
    if (
      !scope.isCurrent() ||
      get().selectedNote?.id !== note.id ||
      get().selectedNote?.notebookId !== note.notebookId
    )
      return;
    const requestId = ++sequence;
    const current = () =>
      scope.isCurrent() &&
      requestId === sequence &&
      get().selectedNote?.id === note.id &&
      get().selectedNote?.notebookId === note.notebookId;
    if (!current()) return;
    set({
      backlinks: [],
      similarNotes: [],
      relationshipLoading: true,
      relationshipError: null,
      relationshipIncomplete: false,
    });
    const targetNotebookId = note.notebookId;
    const targetNoteId = note.id;
    try {
      const response = await gateway.knowledge(scope.sceneId, scope.workspaceId);
      if (!current()) return;
      if (!response.snapshot) throw new Error(t("Could not load note relationships."));
      const links = response.snapshot?.links ?? [];
      const similarPairs = response.snapshot?.similar ?? [];
      const backlinks: NoteBacklink[] = [];
      const sources = new Set<string>();
      for (const link of links) {
        const sourceKey = `${link.fromNotebookId}/${link.fromNoteId}`;
        if (
          !sources.has(sourceKey) &&
          link.toNotebookId === targetNotebookId &&
          link.toNoteId === targetNoteId &&
          !(link.fromNotebookId === targetNotebookId && link.fromNoteId === targetNoteId)
        ) {
          sources.add(sourceKey);
          backlinks.push({
            notebookId: link.fromNotebookId,
            noteId: link.fromNoteId,
            title: link.fromTitle,
            kind: link.kind,
          });
        }
      }
      const similarNotes: SimilarNote[] = [];
      for (const pair of similarPairs) {
        if (pair.leftNotebookId === targetNotebookId && pair.leftNoteId === targetNoteId) {
          similarNotes.push({
            notebookId: pair.rightNotebookId,
            noteId: pair.rightNoteId,
            title: pair.rightTitle,
            sharedTags: pair.sharedTags,
          });
        } else if (pair.rightNotebookId === targetNotebookId && pair.rightNoteId === targetNoteId) {
          similarNotes.push({
            notebookId: pair.leftNotebookId,
            noteId: pair.leftNoteId,
            title: pair.leftTitle,
            sharedTags: pair.sharedTags,
          });
        }
      }
      set({
        backlinks,
        similarNotes,
        relationshipIncomplete: response.snapshot.incomplete === true,
      });
    } catch (error) {
      if (current())
        set({ relationshipError: localize(error).message, backlinks: [], similarNotes: [] });
    } finally {
      if (current()) set({ relationshipLoading: false });
    }
  };
}

export function watchNoteRelationshipSelection(
  store: Pick<StoreApi<NotesState>, "getState" | "setState" | "subscribe">,
) {
  return store.subscribe((state, previous) => {
    if (
      state.selectedNote?.id === previous.selectedNote?.id &&
      state.selectedNote?.notebookId === previous.selectedNote?.notebookId
    )
      return;
    store.setState({
      backlinks: [],
      similarNotes: [],
      relationshipLoading: false,
      relationshipError: null,
      relationshipIncomplete: false,
    });
    if (state.selectedNote) void store.getState().loadBacklinks(state.selectedNote);
  });
}
