import { t } from "../../shared/i18n";
import type { ModelToolSelection } from "../../shared/ModelToolPicker";
import type { EditorTransitionGuard } from "./editor-transition";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export type CapturePreview = Awaited<ReturnType<NotesGatewayLike["capturePreview"]>>;
function normalizeUrl(value: string) {
  const text = String(value ?? "").trim();
  try {
    if (!text) throw new Error();
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new Error(t("The URL is invalid or cannot be accessed."));
  }
}
export function createWebCapture({
  get,
  set,
  gateway,
  capture,
  guard,
  notify,
  localize,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  gateway: NotesGatewayLike;
  capture(): NotesOperationScope;
  guard: EditorTransitionGuard;
  notify(message: string): void;
  localize(error: unknown): Error;
}) {
  let summarySequence = 0;
  let previewSequence = 0;
  let viewSequence = 0;
  let captureSequence = 0;
  function clearSummary() {
    summarySequence += 1;
    set({ summary: null, summarizing: false });
  }
  function invalidateCaptureView(clearSource = true) {
    viewSequence += 1;
    if (clearSource) {
      previewSequence += 1;
      clearSummary();
    }
  }
  return {
    clearSummary,
    invalidateCaptureView,
    setSummaryModel(value: ModelToolSelection | null) {
      clearSummary();
      set({ summaryModel: value });
    },
    async summarizeText(text: string, title?: string) {
      const normalized = String(text ?? "").trim();
      if (!normalized) return null;
      const scope = capture();
      const model = get().summaryModel;
      if (!model || model.sceneId !== scope.sceneId)
        throw new Error(t("Choose a configured model"));
      const request = ++summarySequence;
      const current = () =>
        scope.isCurrent() &&
        request === summarySequence &&
        get().summaryModel?.provider === model.provider &&
        get().summaryModel?.model === model.model &&
        get().summaryModel?.sceneId === model.sceneId;
      set({ summary: null, summarizing: true });
      try {
        const response = await gateway.summarize(scope.sceneId, scope.workspaceId, {
          provider: model.provider,
          model: model.model,
          text: normalized,
          title,
        });
        if (!current()) return null;
        set({ summary: response.summary });
        return response.summary;
      } catch (error) {
        if (current()) throw localize(error);
        return null;
      } finally {
        if (current()) set({ summarizing: false });
      }
    },
    async capturePreviewUrl(url: string): Promise<CapturePreview | null> {
      const scope = capture();
      const request = ++previewSequence;
      clearSummary();
      const current = () => scope.isCurrent() && request === previewSequence;
      try {
        const response = await gateway.capturePreview(scope.sceneId, scope.workspaceId, {
          url: normalizeUrl(url),
        });
        return current() ? response : null;
      } catch (error) {
        if (current()) throw localize(error);
        return null;
      }
    },
    async captureUrl({
      url,
      title,
      notebookId,
      tags,
    }: {
      url: string;
      title: string;
      notebookId: string;
      tags: string[];
    }) {
      if (get().capturing || get().editorLocked || get().transferBusy) return;
      const normalizedUrl = normalizeUrl(url);
      const scope = capture();
      const view = viewSequence;
      const request = ++captureSequence;
      const current = () => scope.isCurrent() && request === captureSequence;
      if (!get().snapshot.notebooks.some((book) => book.id === notebookId))
        throw new Error(t("Select a notebook first"));
      set({ capturing: true, error: null });
      try {
        const ticket = await guard.prepare();
        if (!ticket) {
          if (current() && view === viewSequence && get().dirty)
            throw (
              get().error ??
              new Error(
                t(
                  "Save the current note successfully before continuing. Your edits are still in the editor.",
                ),
              )
            );
          return;
        }
        if (!current() || view !== viewSequence) return;
        const response = await gateway.capture(scope.sceneId, scope.workspaceId, notebookId, {
          url: normalizedUrl,
          title: title || undefined,
          tags: [...tags],
        });
        if (!current()) return;
        const adopt = view === viewSequence && ticket.unchanged();
        if (adopt) {
          set({
            selectedNote: response.note,
            selectedNotebookId: response.note.notebookId,
            mode: "library",
            dirty: false,
            preview: true,
            selectedTag: null,
            sourceOnly: false,
            query: "",
          });
          get().syncDraftFromNote();
        }
        await get().load();
        if (!current()) return;
        notify(
          !adopt
            ? t(
                "The web page is saved. Your current view was kept; open the captured note from the list.",
              )
            : response.duplicate
              ? t("This page is already in your notes")
              : t("Web page captured"),
        );
      } catch (error) {
        if (!current()) return;
        if (view !== viewSequence) {
          notify(t("The earlier web capture failed. Retry with the intended page."));
          return;
        }
        const friendly = localize(error);
        set({ error: friendly });
        throw friendly;
      } finally {
        if (current()) set({ capturing: false });
      }
    },
  };
}
