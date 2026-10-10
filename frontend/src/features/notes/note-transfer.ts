import { t } from "../../shared/i18n";
import { editorFingerprint } from "./editor-save";
import { noteFrontmatter, parseTags, safeFileName } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function createNoteTransfers({
  get,
  set,
  gateway,
  capture,
  notify,
  localize,
  chooseFile,
  downloadFile,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  notify(message: string): void;
  localize(error: unknown): Error;
  chooseFile(accept: string): Promise<File | null>;
  downloadFile(name: string, content: string, type: string): void;
}) {
  async function run(action: (scope: NotesOperationScope) => Promise<void>) {
    const scope = capture();
    if (!scope.isCurrent() || (get().transferBusy || get().editorLocked)) return;
    set({ transferBusy: true, error: null });
    try {
      await action(scope);
    } catch (error) {
      if (scope.isCurrent())
        set({
          error:
            error instanceof SyntaxError
              ? new Error(t("Notes backup is not valid JSON"))
              : localize(error),
        });
    } finally {
      if (scope.isCurrent()) set({ transferBusy: false });
    }
  }

  async function saved(scope: NotesOperationScope) {
    if (!scope.isCurrent()) return false;
    await get().saveEditor(true);
    if (!scope.isCurrent()) return false;
    if (get().dirty) {
      throw new Error(
        t(
          "Save the current note successfully before importing or exporting. Your edits are still in the editor.",
        ),
      );
    }
    return true;
  }

  async function importBackup(all: boolean, scope: NotesOperationScope) {
    const file = await chooseFile(".json");
    if (!file || !scope.isCurrent()) return;
    if (!file.size || file.size > 70 * 1024 * 1024)
      throw new Error(t("Notes backup exceeds the 70 MiB limit"));
    const backup = JSON.parse(await file.text());
    if (!backup || typeof backup !== "object" || Array.isArray(backup))
      throw new SyntaxError("backup must be a JSON object");
    if (!(await saved(scope))) return;
    const editor = editorFingerprint(get());
    const notebook = all
      ? (await gateway.importAllBackup(scope.sceneId, scope.workspaceId, backup)).notebooks?.[0]
      : (await gateway.importBackup(scope.sceneId, scope.workspaceId, backup)).notebook;
    if (!scope.isCurrent()) return;
    const preserveEditor = get().dirty || editorFingerprint(get()) !== editor;
    if (!preserveEditor)
      set({ selectedNotebookId: notebook?.id ?? null, selectedNote: null, dirty: false });
    await get().load({ preserveSelection: preserveEditor });
    if (scope.isCurrent())
      notify(t(all ? "All notebooks backup imported" : "Notes backup imported"));
  }

  async function exportBackup(all: boolean, scope: NotesOperationScope) {
    if (!(await saved(scope))) return;
    const notebook = get().snapshot.notebooks.find((row) => row.id === get().selectedNotebookId);
    if (!all && !notebook) {
      notify(t("Select a notebook first"));
      return;
    }
    const editor = editorFingerprint(get());
    let response: { backup: unknown };
    let filename: string;
    if (all) {
      response = await gateway.exportAllBackup(scope.sceneId, scope.workspaceId);
      filename = `zicode-notes-all-${scope.workspaceId.slice(0, 8)}.json`;
    } else {
      if (!notebook) return;
      response = await gateway.exportBackup(scope.sceneId, scope.workspaceId, notebook.id);
      filename = `${safeFileName(notebook.title)}.zicode-notes.json`;
    }
    if (!scope.isCurrent()) return;
    if (get().dirty || editorFingerprint(get()) !== editor)
      throw new Error(t("The editor changed during export. Save your edits and export again."));
    downloadFile(filename, JSON.stringify(response.backup, null, 2), "application/json");
    notify(t(all ? "All notebooks backup exported" : "Readable backup exported"));
  }

  async function noteMarkdown(scope: NotesOperationScope) {
    if (!(await saved(scope))) return null;
    const state = get();
    if (!state.selectedNote || !state.draftContent.trim()) return null;
    const title = state.draftTitle.trim() || state.selectedNote.title || "note";
    return {
      title,
      content: `${noteFrontmatter(title, parseTags(state.draftTags.join(", ")), state.selectedNote.source?.url)}${state.draftContent}`,
    };
  }

  return {
    importBackup: () => run((scope) => importBackup(false, scope)),
    importAllBackup: () => run((scope) => importBackup(true, scope)),
    exportBackup: () => run((scope) => exportBackup(false, scope)),
    exportAllBackup: () => run((scope) => exportBackup(true, scope)),
    importMarkdown: () =>
      run(async (scope) => {
        const notebookId = get().selectedNotebookId;
        if (!notebookId) {
          set({ mode: "new-notebook" });
          return;
        }
        const file = await chooseFile(".md,.markdown");
        if (!file || !scope.isCurrent()) return;
        if (!file.size || file.size > 1024 * 1024)
          throw new Error(t("Markdown import exceeds the 1 MiB limit"));
        const content = await file.text();
        if (!(await saved(scope))) return;
        const editor = editorFingerprint(get());
        const response = await gateway.importMarkdown(
          scope.sceneId,
          scope.workspaceId,
          notebookId,
          file.name,
          content,
        );
        if (!scope.isCurrent()) return;
        if (!get().dirty && editorFingerprint(get()) === editor) {
          set({
            selectedNote: response.note,
            selectedNotebookId: notebookId,
            dirty: false,
            preview: true,
          });
          get().syncDraftFromNote();
        }
        await get().load();
        if (scope.isCurrent()) notify(t("Markdown imported"));
      }),
    downloadNote: () =>
      run(async (scope) => {
        const note = await noteMarkdown(scope);
        if (note && scope.isCurrent())
          downloadFile(`${safeFileName(note.title)}.md`, note.content, "text/markdown");
      }),
    copyNote: () =>
      run(async (scope) => {
        const note = await noteMarkdown(scope);
        if (!note || !scope.isCurrent()) return;
        if (typeof navigator.clipboard?.writeText !== "function")
          throw new Error(t("Clipboard access is not available"));
        await navigator.clipboard.writeText(note.content);
        if (scope.isCurrent()) notify(t("Copied"));
      }),
  };
}
