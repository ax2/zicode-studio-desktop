import { t } from "../../shared/i18n";
import type { EditorTransitionGuard } from "./editor-transition";
import { DEFAULT_NOTE_ICON, DEFAULT_NOTEBOOK_ICON, parseTags } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";

export function createEditorNavigation({
  get,
  set,
  gateway,
  guard,
  notify,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  guard: EditorTransitionGuard;
  notify(message: string): void;
  localize(error: unknown): Error;
}) {
  async function create(duplicate: boolean) {
    const ticket = await guard.prepare();
    if (!ticket) return;
    const state = ticket.state;
    const note = state.selectedNote;
    if (duplicate && !note) return;
    const notebookId = duplicate
      ? note?.notebookId
      : (state.selectedNotebookId ?? state.snapshot.notebooks[0]?.id);
    if (!notebookId) {
      set({ mode: "new-notebook" });
      return;
    }
    set({ loading: true, error: null });
    try {
      const response = await gateway.create(
        ticket.sceneId,
        ticket.workspaceId,
        notebookId,
        duplicate
          ? {
              title: `${state.draftTitle.trim() || note?.title} (${t("Duplicate")})`,
              content: state.draftContent,
              tags: parseTags(state.draftTags.join(", ")),
              icon: state.draftIcon.trim() || DEFAULT_NOTE_ICON,
            }
          : { title: t("Untitled note"), content: "", tags: [], icon: DEFAULT_NOTE_ICON },
      );
      if (!ticket.isCurrent()) return;
      if (ticket.unchanged()) {
        const expanded = new Set(get().expandedNotebookIds);
        expanded.add(notebookId);
        set({
          selectedNote: response.note,
          selectedNotebookId: notebookId,
          dirty: false,
          preview: duplicate,
          focusTitleOnNextRender: !duplicate,
          mode: "library",
          selectedTag: null,
          sourceOnly: false,
          query: "",
          expandedNotebookIds: expanded,
        });
        get().syncDraftFromNote();
      } else {
        notify(
          t(
            "The new note was saved. Your current editor was kept; open the new note from the list.",
          ),
        );
      }
      await get().load();
      if (ticket.isCurrent() && duplicate) notify(t("Note duplicated"));
    } catch (error) {
      if (ticket.isCurrent()) set({ error: localize(error) });
    } finally {
      if (ticket.isCurrent()) set({ loading: false });
    }
  }
  return {
    async createNotebook(title: string, icon?: string, parentId: string | null = null) {
      const normalized = title.trim();
      if (!normalized) return;
      const ticket = await guard.prepare();
      if (!ticket) return;
      set({ loading: true, error: null });
      try {
        const response = await gateway.createNotebook(ticket.sceneId, ticket.workspaceId, {
          title: normalized,
          icon: icon?.trim() || DEFAULT_NOTEBOOK_ICON,
          parentId,
        });
        if (!ticket.isCurrent()) return;
        if (ticket.unchanged()) {
          const expanded = new Set(get().expandedNotebookIds);
          expanded.add(response.notebook.id);
          if (parentId) expanded.add(parentId);
          set({
            selectedNotebookId: response.notebook.id,
            expandedNotebookIds: expanded,
            mode: "library",
          });
        }
        await get().load({ preserveSelection: true });
      } catch (error) {
        if (!ticket.isCurrent()) return;
        const friendly = localize(error);
        set({ error: friendly });
        throw friendly;
      } finally {
        if (ticket.isCurrent()) set({ loading: false });
      }
    },
    newNote: () => create(false),
    duplicateNote: () => create(true),
    async applyFilter({
      tag = null,
      sourceOnly = false,
    }: {
      tag?: string | null;
      sourceOnly?: boolean;
    } = {}) {
      const ticket = await guard.prepare();
      if (!ticket) return;
      set({
        selectedNotebookId: null,
        selectedTag: tag,
        sourceOnly,
        selectedNote: null,
        dirty: false,
        editingNotebookId: null,
        mode: "library",
        query: tag === null && !sourceOnly ? "" : get().query,
      });
      await get().load({ preserveSelection: false });
    },
    async selectNotebook(id: string) {
      if (!(await guard.prepare())) return;
      set({ selectedNotebookId: id, selectedTag: null, sourceOnly: false, mode: "library" });
    },
    async startCapture() {
      if (!(await guard.prepare())) return;
      const notebookId = get().selectedNotebookId ?? get().snapshot.notebooks[0]?.id;
      set({
        mode: notebookId ? "capture" : "new-notebook",
        selectedNotebookId: notebookId ?? null,
      });
    },
  };
}
