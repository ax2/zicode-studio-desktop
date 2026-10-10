import { t } from "../../shared/i18n";
import type { Note } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export interface AttachmentEditor {
  note: Note;
  title: string;
  icon: string;
  content: string;
  tags: string[];
}
export function appendAttachment(content: string, markdown: string) {
  return `${content}${content && !content.endsWith("\n") ? "\n\n" : ""}${markdown}\n`;
}
export function createAttachmentUpload({
  get,
  set,
  gateway,
  capture,
  chooseFile,
  fileToBase64,
  retain,
  notify,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  chooseFile(accept: string): Promise<File | null>;
  fileToBase64(file: File): Promise<string>;
  retain(scope: NotesOperationScope, editor: AttachmentEditor, markdown: string): Promise<void>;
  notify(message: string): void;
  localize(error: unknown): Error;
}) {
  return async function attachFile() {
    const scope = capture();
    const note = get().selectedNote;
    if (
      !note ||
      !scope.isCurrent() ||
      get().attachmentBusy ||
      get().editorLocked ||
      get().transferBusy
    )
      return;
    const sameNote = () =>
      scope.isCurrent() &&
      get().selectedNote?.id === note.id &&
      get().selectedNote?.notebookId === note.notebookId;
    const canInsert = () => sameNote() && !get().editorLocked;
    const canDispatch = () => {
      if (canInsert()) return true;
      if (scope.isCurrent())
        notify(
          t(
            "Attachment upload was cancelled because the selected note changed. Choose the file again in the intended note.",
          ),
        );
      return false;
    };
    set({ attachmentBusy: true, error: null });
    try {
      const file = await chooseFile(".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json");
      if (!file || !canDispatch()) return;
      if (!file.size || file.size > 5 * 1024 * 1024)
        throw new Error(t("Attachments must contain 1 byte to 5 MiB"));
      const dataBase64 = await fileToBase64(file);
      if (!canDispatch()) return;
      if (!dataBase64)
        throw new Error(t("Could not read the attachment file. Choose it again and retry."));
      const state = get();
      const editor: AttachmentEditor = {
        note: structuredClone(state.selectedNote ?? note),
        title: state.draftTitle,
        icon: state.draftIcon,
        content: state.draftContent,
        tags: [...state.draftTags],
      };
      const response = await gateway.uploadAttachment(
        scope.sceneId,
        scope.workspaceId,
        editor.note,
        {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64,
        },
      );
      const markdown = response.attachment?.markdown;
      if (typeof markdown !== "string" || !markdown.trim())
        throw new Error(t("The attachment response did not contain a usable link."));
      if (!canInsert()) {
        await retain(scope, editor, markdown);
        if (scope.isCurrent())
          notify(t("The attachment link is in Local note recovery for the original note."));
        return;
      }
      set({ preview: false });
      get().setDraft({ content: appendAttachment(get().draftContent, markdown) });
      await get().saveEditor(true);
      if (sameNote())
        notify(
          get().dirty
            ? t("The attachment link is in the editor. Save the note to finish adding it.")
            : t("Attachment added"),
        );
    } catch (error) {
      if (scope.isCurrent()) set({ error: localize(error) });
    } finally {
      if (scope.isCurrent()) set({ attachmentBusy: false });
    }
  };
}
