import { t } from "../../shared/i18n";
import { editorFingerprint } from "./editor-save";
import { conversationNoteTitle } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export function createChatNoteCapture({
  get,
  set,
  gateway,
  capture,
  notify,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  notify(message: string): void;
}) {
  return async function captureChatExchange({
    question = "",
    answer = "",
    sessionId = "",
  }: {
    question?: string;
    answer?: string;
    sessionId?: string;
  }) {
    const normalizedAnswer = String(answer).trim();
    if (!normalizedAnswer) throw new Error(t("There is no assistant response to save"));
    const scope = capture();
    const editor = editorFingerprint(get());
    const current = () =>
      scope.isCurrent() &&
      !get().editorLocked &&
      !get().dirty &&
      editorFingerprint(get()) === editor;
    if (get().snapshot.notebooks.length === 0) await get().load({ preserveSelection: true });
    if (!scope.isCurrent())
      throw new Error(t("The Notes workspace changed. Try again in the current workspace."));
    let notebook =
      get().snapshot.notebooks.find((candidate) => candidate.title === t("Conversation Notes")) ||
      get().snapshot.notebooks[0];
    if (!notebook) {
      const created = await gateway.createNotebook(scope.sceneId, scope.workspaceId, {
        title: t("Conversation Notes"),
      });
      notebook = created.notebook;
    }
    const normalizedQuestion = String(question).trim();
    const title = conversationNoteTitle(normalizedQuestion || normalizedAnswer);
    const provenance = [
      `> ${t("Captured from Chat")}`,
      sessionId ? `> ${t("Session")}: \`${sessionId}\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const body = [
      provenance,
      normalizedQuestion ? `## ${t("Question")}\n\n${normalizedQuestion}` : "",
      `## ${t("Answer")}\n\n${normalizedAnswer}`,
      `---\n${t("Continue this knowledge in Chat with the Discuss in Chat action.")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!scope.isCurrent())
      throw new Error(t("The Notes workspace changed. Try again in the current workspace."));
    const response = await gateway.create(scope.sceneId, scope.workspaceId, notebook.id, {
      title,
      content: body,
      tags: ["chat", "captured"],
    });
    if (!scope.isCurrent()) return response.note;
    if (!current()) {
      await get().load({ preserveSelection: true });
      if (scope.isCurrent()) notify(t("Conversation saved to Notes"));
      return response.note;
    }
    const state = get();
    const expanded = new Set(state.expandedNotebookIds);
    expanded.add(notebook.id);
    set({
      selectedNotebookId: notebook.id,
      selectedNote: response.note,
      mode: "library",
      dirty: false,
      preview: true,
      expandedNotebookIds: expanded,
      snapshot: {
        ...state.snapshot,
        notebooks: state.snapshot.notebooks.some((candidate) => candidate.id === notebook.id)
          ? state.snapshot.notebooks.map((candidate) =>
              candidate.id === notebook.id
                ? { ...candidate, noteCount: Number(candidate.noteCount || 0) + 1 }
                : candidate,
            )
          : [{ ...notebook, noteCount: 1 }, ...state.snapshot.notebooks],
        notes: [response.note, ...state.snapshot.notes.filter((n) => n.id !== response.note.id)],
        tags: [...new Set([...(state.snapshot.tags || []), "chat", "captured"])],
      },
    });
    get().syncDraftFromNote();
    notify(t("Conversation saved to Notes"));
    return response.note;
  };
}
