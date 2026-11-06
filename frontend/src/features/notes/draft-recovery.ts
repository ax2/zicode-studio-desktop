import { t } from "../../shared/i18n";
import { type AttachmentEditor, appendAttachment } from "./attachment-uploads";
import { draftScope, type NoteDraft, type NoteDraftRepository } from "./draft-repository";
import { createDraftCopySaver } from "./draft-copy-save";
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
  receiveIncomingDraft(input: { title: string; content: string }, isCurrent: () => boolean, verify?: () => Promise<void>): Promise<void>;
  updateIncomingDraft(id: string, patch: { title?: string; content?: string }): void;
  saveIncomingDraft(id: string, notebookId: string): Promise<void>;
  acknowledgeDraftSave(id: string): Promise<void>;
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
  const saveCopy = createDraftCopySaver({ get, set, capture, gateway, notify, forget,
    async retireEditor(state) {
      const own = memory.get(idFor(state));
      if (own) await forget(own);
    },
    async prepare(draft, notebookId) {
      await flush();
      const live = get().recoveryDrafts.find((item) => item.id === draft.id);
      if (get().recoveryPending || live?.revision !== draft.revision || live.saveAttemptNotebookId || live.scope !== draftScope(capture())) throw new Error("Draft changed or storage unavailable");
      const marked = { ...draft, saveAttemptNotebookId: notebookId, revision: randomId() };
      // Store the attempt before creating a note: a lost response must not replay it.
      await repository.put(marked);
      memory.set(marked.id, marked); show();
      return marked;
    },
  });
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
      // Incoming material has no saved base note. It can only be explicitly
      // saved as a new note, never opened as an existing note for autosave.
      if (draft.incoming) return;
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
    async receiveIncomingDraft(input, isCurrent, verify) {
      const scope = capture();
      if (disposed || !scope.workspaceId || !scope.isCurrent() || !isCurrent() ||
          typeof input.title !== "string" || typeof input.content !== "string" ||
          new TextEncoder().encode(input.content).length > 128 * 1024) throw new Error("incoming_draft_unavailable");
      const id = JSON.stringify([draftScope(scope), writer, "incoming", randomId()]);
      const draft: NoteDraft = {
        incoming: true, id, revision: randomId(), scope: draftScope(scope), updatedAt: new Date().toISOString(),
        note: { id, notebookId: "", title: input.title, content: "", tags: [] },
        title: input.title, icon: "📝", content: input.content, tags: [],
      };
      if (!scope.isCurrent() || !isCurrent()) throw new Error("incoming_draft_unavailable");
      // Do not modify the open editor or claim success before durable storage.
      await repository.put(draft);
      try {
        if (disposed || !scope.isCurrent() || !isCurrent()) throw new Error("incoming_draft_unavailable");
        await verify?.();
        if (disposed || !scope.isCurrent() || !isCurrent()) throw new Error("incoming_draft_unavailable");
      } catch (error) {
        // This id and revision were created exclusively by this handoff. The
        // conditional delete cannot remove a newer edit made by another view.
        try { await repository.remove(draft.id, draft.revision); } catch { failure(); }
        throw error;
      }
      memory.set(id, draft);
      show();
    },
    updateIncomingDraft(id, patch) {
      const previous = get().recoveryDrafts.find((item) => item.id === id && item.incoming);
      if (!previous || previous.scope !== draftScope(capture()) || get().recoveryBusy || get().editorLocked) return;
      const content = patch.content ?? previous.content;
      const title = patch.title ?? previous.title;
      if (new TextEncoder().encode(content).length > 128 * 1024 || title.length > 512) {
        set({ recoveryError: t("Draft is too large. Keep the previous content or download it.") });
        return;
      }
      const draft = { ...previous, title, content, revision: randomId(), updatedAt: new Date().toISOString() };
      memory.set(id, draft);
      pending.set(id, draft);
      set({ recoveryPending: true, recoveryError: null });
      show();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void flush(); }, 250);
    },
    async saveIncomingDraft(id, notebookId) {
      const scope = capture();
      if (!scope.isCurrent() || get().recoveryBusy || get().editorLocked || get().transferBusy) return;
      set({ recoveryBusy: true });
      try {
        await flush();
        if (!scope.isCurrent() || get().recoveryPending || !get().snapshot.notebooks.some((book) => book.id === notebookId)) return;
        const draft = get().recoveryDrafts.find((item) => item.id === id && item.incoming && item.scope === draftScope(scope));
        if (!draft || draft.saveAttemptNotebookId) return;
        const marked = { ...draft, saveAttemptNotebookId: notebookId, revision: randomId() };
        // Persist the attempt before the Host write. A lost response or restart
        // must not silently issue a second create request.
        await repository.put(marked);
        if (!scope.isCurrent()) return;
        memory.set(id, marked); show();
        await saveCopy(marked, notebookId, true);
      } catch { if (scope.isCurrent()) failure(); }
      finally { if (scope.isCurrent()) set({ recoveryBusy: false }); }
    },
    async acknowledgeDraftSave(id) {
      const scope = capture();
      if (!scope.isCurrent() || get().recoveryBusy || get().editorLocked || get().transferBusy) return;
      set({ recoveryBusy: true });
      try {
        await flush();
        if (!scope.isCurrent() || get().recoveryPending) return;
        const draft = get().recoveryDrafts.find((item) => item.id === id && item.scope === draftScope(scope));
        if (!draft?.saveAttemptNotebookId) return;
        const cleared = { ...draft, saveAttemptNotebookId: undefined, revision: randomId() };
        await repository.put(cleared);
        if (!scope.isCurrent()) return;
        memory.set(id, cleared); show();
      } catch { if (scope.isCurrent()) failure(); }
      finally { if (scope.isCurrent()) set({ recoveryBusy: false }); }
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
    async retainEditorCopy(state: NotesState) {
      if (!state.dirty || !state.selectedNote) return;
      const scope = capture();
      const draft: NoteDraft = {
        id: JSON.stringify([draftScope(scope), writer, "conflict", randomId()]),
        revision: randomId(), scope: draftScope(scope), updatedAt: new Date().toISOString(),
        note: structuredClone(state.selectedNote), title: state.draftTitle,
        icon: state.draftIcon, content: state.draftContent, tags: [...state.draftTags],
      };
      await flush();
      // The independent copy must be durable before the editor may be replaced.
      // Later successful saves only retire the ordinary editor draft, never this copy.
      await repository.put(draft);
      memory.set(draft.id, draft);
      if (!scope.isCurrent()) return;
      show();
      const own = memory.get(idFor(state));
      if (own) await forget(own);
    },
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
