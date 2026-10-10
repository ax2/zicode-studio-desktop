import { t } from "../../shared/i18n";
import { type AttachmentEditor, appendAttachment } from "./attachment-uploads";
import { draftScope, type NoteDraft, type NoteDraftRepository } from "./draft-repository";
import { editorFingerprint } from "./editor-save";
import type { EditorTransitionGuard } from "./editor-transition";
import { noteFrontmatter, safeFileName } from "./notesLogic";
import type { NotesGatewayLike, NotesState } from "./notesStore";
import type { NotesOperationScope } from "./operation-scope";

export interface NoteRecoveryState {
  recoveryDrafts: NoteDraft[];
  recoveryError: string | null;
  recoveryPending: boolean;
  recoveryBusy: boolean;
  refreshDrafts(): Promise<void>;
  recoverDraft(id: string, asCopy?: boolean): Promise<void>;
  discardDraft(id: string): Promise<void>;
  downloadDraft(id: string): void;
}
export function createNoteDraftRecovery({
  get,
  set,
  capture,
  repository,
  guard,
  gateway,
  download,
  notify,
}: {
  get(): NotesState;
  set(patch: Partial<NotesState>): void;
  capture(): NotesOperationScope;
  repository: NoteDraftRepository;
  guard: EditorTransitionGuard;
  gateway: NotesGatewayLike;
  download(name: string, content: string, type: string): void;
  notify(message: string): void;
}) {
  const randomId = () =>
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const writer = randomId();
  let owner = capture();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue = Promise.resolve();
  let readSequence = 0;
  let queuedWrites = 0;
  const memory = new Map<string, NoteDraft>();
  const pending = new Map<string, NoteDraft>();
  const restored = new Map<string, NoteDraft[]>();
  function rememberSource(id: string, draft: NoteDraft) {
    restored.set(id, [...(restored.get(id) ?? []).filter((item) => item.id !== draft.id), draft]);
  }
  const idFor = (state: NotesState) =>
    JSON.stringify([
      draftScope(owner),
      writer,
      state.selectedNote?.notebookId,
      state.selectedNote?.id,
    ]);
  const failure = () => {
    if (!disposed)
      set({
        recoveryError: t(
          "Local note recovery could not be updated. Keep the editor open or download your draft; retry when storage is available.",
        ),
      });
  };
  function enqueue(action: () => Promise<void>) {
    queue = queue.then(action).catch(failure);
    return queue;
  }
  function show(records: NoteDraft[] = get().recoveryDrafts) {
    if (disposed) return;
    const scope = draftScope(owner);
    const merged = new Map(
      records.filter((draft) => draft.scope === scope).map((draft) => [draft.id, draft]),
    );
    for (const draft of memory.values()) if (draft.scope === scope) merged.set(draft.id, draft);
    set({
      recoveryDrafts: [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    });
  }
  function remember(state: NotesState) {
    if (!state.dirty || !state.selectedNote || !owner.workspaceId) return;
    const draft: NoteDraft = {
      id: idFor(state),
      revision: randomId(),
      scope: draftScope(owner),
      updatedAt: new Date().toISOString(),
      note: structuredClone(state.selectedNote),
      title: state.draftTitle,
      icon: state.draftIcon,
      content: state.draftContent,
      tags: [...state.draftTags],
    };
    memory.set(draft.id, draft);
    pending.set(draft.id, draft);
    set({ recoveryPending: true });
    show();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 250);
  }
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = [...pending.values()];
    pending.clear();
    queuedWrites += batch.length;
    return enqueue(async () => {
      let failed = false;
      for (const draft of batch) {
        try {
          await repository.put(draft);
        } catch {
          failed = true;
          if (memory.get(draft.id)?.revision === draft.revision && !pending.has(draft.id))
            pending.set(draft.id, draft);
          failure();
        }
        queuedWrites -= 1;
      }
      if (!disposed)
        set({
          recoveryPending: pending.size + queuedWrites > 0,
          ...(!failed && pending.size + queuedWrites === 0 ? { recoveryError: null } : {}),
        });
    });
  }
  function forget(draft: NoteDraft) {
    const live = memory.get(draft.id);
    if (live && live.revision !== draft.revision) return Promise.resolve();
    readSequence += 1;
    pending.delete(draft.id);
    memory.delete(draft.id);
    set({
      recoveryDrafts: get().recoveryDrafts.filter((item) => item.id !== draft.id),
      recoveryPending: pending.size + queuedWrites > 0,
    });
    return enqueue(async () => {
      await repository.remove(draft.id, draft.revision);
    });
  }
  async function saveCopy(draft: NoteDraft) {
    if (get().editorLocked || get().transferBusy) return;
    const scope = capture();
    const notebookId = get().snapshot.notebooks.some((book) => book.id === draft.note.notebookId)
      ? draft.note.notebookId
      : (get().selectedNotebookId ?? get().snapshot.notebooks[0]?.id);
    if (!notebookId) {
      set({ error: new Error(t("Create a notebook before saving a recovery copy.")) });
      return;
    }
    const before = get();
    const matches =
      before.selectedNote?.id === draft.note.id &&
      before.selectedNote?.notebookId === draft.note.notebookId &&
      before.draftTitle === draft.title &&
      before.draftIcon === draft.icon &&
      before.draftContent === draft.content &&
      JSON.stringify(before.draftTags) === JSON.stringify(draft.tags);
    const fingerprint = editorFingerprint(before);
    set({ editorLocked: true, recoveryBusy: true, error: null });
    get().cancelAutosave();
    try {
      const response = await gateway.create(scope.sceneId, scope.workspaceId, notebookId, {
        title: draft.title || t("Untitled note"),
        icon: draft.icon,
        content: draft.content,
        tags: draft.tags,
      });
      if (!scope.isCurrent()) return;
      if ((!before.dirty || matches) && fingerprint === editorFingerprint(get())) {
        if (matches) {
          const own = memory.get(idFor(before));
          if (own) await forget(own);
          if (!scope.isCurrent()) return;
        }
        set({
          selectedNote: response.note,
          selectedNotebookId: notebookId,
          mode: "library",
          preview: false,
          dirty: false,
          saveDisabled: true,
          saveState: "saved",
          selectedTag: null,
          sourceOnly: false,
          query: "",
        });
        get().syncDraftFromNote();
      }
      await forget(draft);
      if (!scope.isCurrent()) return;
      await get().load();
      if (scope.isCurrent()) notify(t("Recovery copy saved as a new note."));
    } catch {
      if (scope.isCurrent())
        set({
          error: new Error(
            t("Could not recover this note. Keep the draft, retry, or download it."),
          ),
        });
    } finally {
      if (scope.isCurrent()) {
        set({ editorLocked: false, recoveryBusy: false });
        if (get().dirty) get().scheduleAutosave();
      }
    }
  }
  const actions: NoteRecoveryState = {
    recoveryDrafts: [],
    recoveryError: null,
    recoveryPending: false,
    recoveryBusy: false,
    async refreshDrafts() {
      await flush();
      const scope = capture();
      const sequence = ++readSequence;
      try {
        const result = await repository.list(draftScope(scope));
        if (!disposed && scope.isCurrent() && sequence === readSequence) {
          show(result.drafts);
          if (result.unreadable)
            set({
              recoveryError: t(
                "Some local note drafts could not be read. They have been kept in storage; other drafts are still available.",
              ),
            });
        }
      } catch {
        if (scope.isCurrent() && sequence === readSequence) failure();
      }
    },
    async recoverDraft(id, asCopy = false) {
      if (get().recoveryBusy) return;
      const draft = get().recoveryDrafts.find((item) => item.id === id);
      if (!draft || draft.scope !== draftScope(capture())) return;
      if (draft.attachmentMarkdown) {
        if (asCopy) return;
        const scope = capture();
        if (get().editorLocked || get().transferBusy) return;
        const sameNote = () =>
          get().selectedNote?.id === draft.note.id &&
          get().selectedNote?.notebookId === draft.note.notebookId;
        if (!sameNote()) await get().selectNote(draft.note);
        if (!scope.isCurrent() || !sameNote() || get().editorLocked || get().transferBusy) return;
        if (get().draftContent.includes(draft.attachmentMarkdown)) {
          if (get().dirty) rememberSource(idFor(get()), draft);
          else await forget(draft);
          return;
        }
        rememberSource(idFor(get()), draft);
        set({ preview: false });
        get().setDraft({ content: appendAttachment(get().draftContent, draft.attachmentMarkdown) });
        return;
      }
      if (asCopy) {
        await saveCopy(draft);
        return;
      }
      const ticket = await guard.prepare();
      if (!ticket) return;
      const unlock = guard.lock(ticket);
      if (!unlock) return;
      set({ recoveryBusy: true, error: null });
      try {
        // Preserve the saved base version; Host CAS decides whether saving is safe.
        rememberSource(
          JSON.stringify([draft.scope, writer, draft.note.notebookId, draft.note.id]),
          draft,
        );
        get().cancelAutosave();
        set({
          selectedNote: draft.note,
          selectedNotebookId: draft.note.notebookId,
          mode: "library",
          preview: false,
          draftTitle: draft.title,
          draftIcon: draft.icon,
          draftContent: draft.content,
          draftTags: [...draft.tags],
          dirty: true,
          saveDisabled: false,
          saveState: "dirty",
        });
      } catch {
        if (ticket.isCurrent())
          set({
            error: new Error(
              t("Could not recover this note. Keep the draft, retry, or download it."),
            ),
          });
      } finally {
        unlock();
        if (ticket.isCurrent()) set({ recoveryBusy: false });
      }
    },
    async discardDraft(id) {
      const draft = get().recoveryDrafts.find((item) => item.id === id);
      if (!draft || get().recoveryBusy) return;
      // An open unsaved editor owns this draft until it is saved or switched away.
      if (get().dirty && id === idFor(get())) return;
      await forget(draft);
    },
    downloadDraft(id) {
      const draft = get().recoveryDrafts.find((item) => item.id === id);
      if (!draft) return;
      try {
        download(
          `${safeFileName(draft.title || "note")}-draft.md`,
          noteFrontmatter(draft.title, draft.tags, draft.note.source?.url) + draft.content,
          "text/markdown",
        );
      } catch {
        failure();
      }
    },
  };
  return {
    actions,
    observe(state: NotesState, previous: NotesState) {
      if (disposed) return;
      if (
        state.dirty &&
        (state.selectedNote?.id !== previous.selectedNote?.id ||
          state.selectedNote?.notebookId !== previous.selectedNote?.notebookId ||
          state.draftTitle !== previous.draftTitle ||
          state.draftIcon !== previous.draftIcon ||
          state.draftContent !== previous.draftContent ||
          state.draftTags !== previous.draftTags ||
          !previous.dirty ||
          state.selectedNote?.version !== previous.selectedNote?.version)
      )
        remember(state);
      if (
        previous.dirty &&
        !state.dirty &&
        state.saveState === "saved" &&
        state.selectedNote?.id === previous.selectedNote?.id &&
        state.selectedNote?.notebookId === previous.selectedNote?.notebookId
      ) {
        const id = idFor(previous);
        const draft = memory.get(id);
        const source = restored.get(id);
        if (draft) void forget(draft);
        if (source) {
          restored.delete(id);
          for (const draft of source) void forget(draft);
        }
      }
    },
    switchTarget() {
      remember(get());
      void flush();
      owner = capture();
      readSequence += 1;
      set({ recoveryDrafts: [], recoveryBusy: false });
      show([]);
    },
    flush,
    async retainAttachment(scope: NotesOperationScope, editor: AttachmentEditor, markdown: string) {
      const id = JSON.stringify([draftScope(scope), writer, "attachment", randomId()]);
      const draft: NoteDraft = {
        ...editor,
        id,
        revision: randomId(),
        scope: draftScope(scope),
        updatedAt: new Date().toISOString(),
        content: appendAttachment(editor.content, markdown),
        attachmentMarkdown: markdown,
      };
      memory.set(id, draft);
      pending.set(id, draft);
      if (!disposed) {
        set({ recoveryPending: true });
        show();
      }
      await flush();
    },
    listen() {
      const save = () => {
        void flush();
      };
      const hidden = () => {
        if (document.visibilityState === "hidden") save();
      };
      window.addEventListener("pagehide", save);
      document.addEventListener("visibilitychange", hidden);
      return () => {
        window.removeEventListener("pagehide", save);
        document.removeEventListener("visibilitychange", hidden);
      };
    },
    destroy() {
      remember(get());
      void flush();
      disposed = true;
      readSequence += 1;
    },
  };
}
