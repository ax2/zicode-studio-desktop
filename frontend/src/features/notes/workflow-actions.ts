import { t } from "../../shared/i18n";
import type { EditorTransitionGuard } from "./editor-transition";
import type { Note } from "./notesLogic";
import type { NotesGatewayLike, NotesState, NotesStoreOptions } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export type NoteWorkflow = "build" | "rebuild" | "chat";

export function createNoteWorkflowActions({
  get,
  set,
  gateway,
  guard,
  capture,
  notify,
  localize,
  confirmPublish,
  invoke,
  onUseInChat,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  guard: EditorTransitionGuard;
  capture(): NotesOperationScope;
  notify(message: string): void;
  localize(error: unknown): Error;
  confirmPublish: NonNullable<NotesStoreOptions["confirmPublish"]>;
  invoke: NotesStoreOptions["invoke"];
  onUseInChat: NotesStoreOptions["onUseInChat"];
}) {
  async function run(kind: NoteWorkflow, action: () => Promise<void>) {
    const scope = capture();
    if (!scope.isCurrent() || get().workflowBusy || get().editorLocked || get().transferBusy)
      return;
    set({ workflowBusy: kind, error: null });
    try {
      await action();
    } catch (error) {
      if (scope.isCurrent()) set({ error: localize(error) });
    } finally {
      if (scope.isCurrent()) set({ workflowBusy: null });
    }
  }
  return {
    rebuildIndex: () =>
      run("rebuild", async () => {
        const ticket = await guard.prepare();
        if (!ticket?.unchanged()) return;
        const notebookId = ticket.state.selectedNotebookId;
        if (!notebookId) {
          notify(t("Select a notebook first"));
          return;
        }
        const { report } = await gateway.rebuild(ticket.sceneId, ticket.workspaceId, notebookId);
        if (!ticket.isCurrent()) return;
        await get().load({ preserveSelection: true });
        if (ticket.isCurrent())
          notify(
            `${t("Vault check complete")}: ${report.validNotes} ${t("valid notes")}, ${report.invalidFiles.length} ${t("invalid files")}`,
          );
      }),
    publishAstro: () =>
      run("build", async () => {
        if (!invoke) {
          set({ error: new Error(t("Astro publishing is available in the desktop application.")) });
          return;
        }
        const ticket = await guard.prepare();
        if (!ticket?.unchanged()) return;
        const notebook = ticket.state.snapshot.notebooks.find(
          (n) => n.id === ticket.state.selectedNotebookId,
        );
        if (!notebook) {
          notify(t("Select a notebook first"));
          return;
        }
        if (
          !(await confirmPublish(
            t("Build this notebook as a local Astro site? Dependencies may be downloaded."),
          ))
        )
          return;
        if (!ticket.unchanged()) {
          if (ticket.isCurrent())
            set({
              error: new Error(
                t("The note or notebook changed. Start the build again for the intended notebook."),
              ),
            });
          return;
        }
        const report = (await invoke("publish_notes_notebook", {
          workspaceId: ticket.workspaceId,
          notebookId: notebook.id,
        })) as { noteCount: number };
        if (ticket.isCurrent())
          notify(`${t("Astro site built")}: ${report.noteCount} ${t("notes")} · dist/`);
      }),
    discussInChat: (note: Note, selection: string) =>
      run("chat", async () => {
        const before = get().selectedNote;
        if (!before || before.id !== note.id || before.notebookId !== note.notebookId) return;
        const originalContent = get().draftContent;
        const ticket = await guard.prepare();
        if (!ticket?.unchanged() || !ticket.state.selectedNote) return;
        if (selection && ticket.state.draftContent !== originalContent) {
          set({
            error: new Error(
              t("The selected text changed. Select it again before discussing it in Chat."),
            ),
          });
          return;
        }
        if (!onUseInChat) {
          set({ error: new Error(t("Chat handoff is unavailable in this view.")) });
          return;
        }
        await onUseInChat(ticket.state.selectedNote, selection, {
          sceneId: ticket.sceneId,
          workspaceId: ticket.workspaceId,
          isCurrent: ticket.unchanged,
        });
      }),
  };
}
