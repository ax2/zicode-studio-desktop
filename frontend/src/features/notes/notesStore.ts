import { create } from "zustand";
import { t } from "../../shared/i18n";
import { localizeHostError } from "../../shared/hostErrors";
import {
  AUTOSAVE_DELAY_MS,
  conversationNoteTitle,
  DEFAULT_NOTEBOOK_ICON,
  DEFAULT_NOTE_ICON,
  parseTags,
  safeFileName,
  type Note,
  type NotesMode,
  type NotesSnapshot,
  type NoteSummary,
  type Notebook,
  type TrashEntry,
} from "./notesLogic";

const RECENT_NOTES_KEY = "zicode-notes-recent";
const RECENT_NOTES_LIMIT = 8;

function readRecentNoteIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === "string").slice(0, RECENT_NOTES_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeRecentNoteIds(ids: string[]): void {
  try {
    localStorage.setItem(
      RECENT_NOTES_KEY,
      JSON.stringify(ids.slice(0, RECENT_NOTES_LIMIT)),
    );
  } catch {
    // Storage may be unavailable; recent-notes is a convenience only.
  }
}

function defaultDownloadFile(fileName: string, content: string, type: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function defaultChooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener("focus", onWindowFocus);
      resolve(file);
    };
    const onWindowFocus = () => {
      // Native file dialogs are modal: regaining focus without a change
      // event means the user cancelled the picker.
      setTimeout(() => finish(input.files?.[0] ?? null), 0);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), {
      once: true,
    });
    window.addEventListener("focus", onWindowFocus);
    document.body.append(input);
    input.click();
  });
}

export interface NotesGatewayLike {
  list(sceneId: string, workspaceId: string, filters: { notebookId?: string | null; query?: string; tag?: string | null; sourceOnly?: boolean }): Promise<{ snapshot?: NotesSnapshot }>;
  get(sceneId: string, workspaceId: string, notebookId: string, noteId: string): Promise<{ note: Note }>;
  createNotebook(sceneId: string, workspaceId: string, params: { title: string; icon?: string; parentId?: string | null }): Promise<{ notebook: Notebook }>;
  updateNotebook(sceneId: string, workspaceId: string, params: { notebookId: string; title: string; icon: string }): Promise<unknown>;
  deleteNotebook(sceneId: string, workspaceId: string, notebookId: string): Promise<unknown>;
  create(sceneId: string, workspaceId: string, notebookId: string, params: { title: string; content?: string; tags?: string[]; icon?: string }): Promise<{ note: Note }>;
  save(sceneId: string, workspaceId: string, note: Note): Promise<{ note: Note }>;
  delete(sceneId: string, workspaceId: string, note: NoteSummary): Promise<unknown>;
  moveNote(sceneId: string, workspaceId: string, params: { notebookId: string; noteId: string; targetNotebookId: string; expectedVersion?: number }): Promise<unknown>;
  capture(sceneId: string, workspaceId: string, notebookId: string, params: { url: string; title?: string; tags?: string[] }): Promise<{ note: Note; duplicate?: boolean }>;
  uploadAttachment(sceneId: string, workspaceId: string, note: Note, params: { fileName: string; mimeType: string; dataBase64: string }): Promise<{ attachment: { markdown: string } }>;
  attachmentUrl(sceneId: string, workspaceId: string, note: Note, attachmentId: string): string;
  importMarkdown(sceneId: string, workspaceId: string, notebookId: string, fileName: string, markdown: string): Promise<{ note: Note }>;
  exportBackup(sceneId: string, workspaceId: string, notebookId: string): Promise<{ backup: unknown }>;
  exportAllBackup(sceneId: string, workspaceId: string): Promise<{ backup: unknown }>;
  importBackup(sceneId: string, workspaceId: string, backup: unknown): Promise<{ notebook: Notebook }>;
  importAllBackup(sceneId: string, workspaceId: string, backup: unknown): Promise<{ notebooks: Notebook[] }>;
  rebuild(sceneId: string, workspaceId: string, notebookId: string): Promise<{ report: { validNotes: number; invalidFiles: unknown[] } }>;
  listTrash(sceneId: string, workspaceId: string, notebookId?: string): Promise<{ trash?: TrashEntry[] }>;
  restoreTrash(sceneId: string, workspaceId: string, notebookId: string, noteId: string): Promise<{ note: Note }>;
  purgeTrash(sceneId: string, workspaceId: string, notebookId: string, noteId: string): Promise<unknown>;
  emptyTrash(sceneId: string, workspaceId: string, notebookId?: string): Promise<{ emptied: number }>;
}

export interface NotesStoreOptions {
  gateway: NotesGatewayLike;
  getTarget?: () => { sceneId?: string; workspaceId?: string } | null;
  getProject?: () => ProjectInfo | null;
  notify?: (message: string) => void;
  confirmPublish?: (message: string) => boolean | Promise<boolean>;
  confirmDelete?: (message: string) => boolean | Promise<boolean>;
  chooseFile?: (accept: string) => Promise<File | null>;
  downloadFile?: (fileName: string, content: string, type: string) => void;
  onUseInChat?: (note: Note, selection: string) => void;
  fileToBase64?: (file: File) => Promise<string>;
  invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  renderMarkdown?: (markdown: string) => string;
}

export interface ProjectInfo {
  id: string;
  path: string;
  name: string;
}

interface NotesState {
  snapshot: NotesSnapshot;
  project: ProjectInfo | null;
  selectedNotebookId: string | null;
  selectedNote: Note | null;
  loading: boolean;
  error: Error | null;
  trash: TrashEntry[];
  trashLoading: boolean;
  trashError: string | null;
  mode: NotesMode;
  dirty: boolean;
  saveState: "idle" | "dirty" | "saving" | "saved";
  preview: boolean;
  query: string;
  selectedTag: string | null;
  sourceOnly: boolean;
  focusTitleOnNextRender: boolean;
  editingNotebookId: string | null;
  recentNoteIds: string[];
  recentNotes: NoteSummary[];
  moveNote: NoteSummary | null;
  dragTargetId: string | null;
  selectMode: boolean;
  selectedNoteIds: string[];
  expandedNotebookIds: Set<string>;
  expandedNavSections: Map<string, boolean>;
  draftTitle: string;
  draftIcon: string;
  draftContent: string;
  draftTags: string[];
  deleteArmed: boolean;
  saveDisabled: boolean;
  load(options?: { preserveSelection?: boolean }): Promise<void>;
  applyFilter(options?: { tag?: string | null; sourceOnly?: boolean }): Promise<void>;
  selectNote(summary: NoteSummary): Promise<void>;
  openNote(notebookId: string, noteId: string): Promise<void>;
  selectNotebook(id: string): void;
  resolveRecentNotes(): Promise<void>;
  discussInChat(note: Note, selection: string): Promise<void>;
  attachmentUrl(note: Note, attachmentId: string): string;
  newNote(): Promise<void>;
  startCapture(): Promise<void>;
  captureChatExchange(input: { question?: string; answer?: string; sessionId?: string }): Promise<Note>;
  createNotebook(title: string, icon: string, parentId?: string | null): Promise<void>;
  deleteNotebook(notebookId: string): Promise<void>;
  updateNotebook(notebookId: string, title: string, icon: string): Promise<void>;
  deleteSelectedNote(): Promise<void>;
  loadTrash(): Promise<void>;
  restoreFromTrash(entry: TrashEntry): Promise<void>;
  purgeFromTrash(entry: TrashEntry): Promise<void>;
  emptyTrash(): Promise<void>;
  saveEditor(): Promise<void>;
  saveIfDirty(): Promise<void>;
  markDirty(): void;
  scheduleAutosave(): void;
  cancelAutosave(): void;
  setQuery(query: string): void;
  setMode(mode: NotesMode): void;
  setEditingNotebook(id: string | null): void;
  setDraft(patch: { title?: string; icon?: string; content?: string; tags?: string[] }): void;
  setPreview(preview: boolean): void;
  syncDraftFromNote(): void;
  toggleNotebookExpanded(id: string, force?: boolean): void;
  toggleNavSection(title: string, currentExpanded: boolean): void;
  openMovePopover(note: NoteSummary): void;
  closeMovePopover(): void;
  moveNoteTo(sourceNotebookId: string, noteId: string, targetNotebookId: string): Promise<void>;
  toggleSelectMode(): void;
  toggleNoteSelected(noteId: string): void;
  clearNoteSelection(): void;
  moveSelectedNotes(targetNotebookId: string): Promise<void>;
  deleteSelectedNotes(): Promise<void>;
  setDragTarget(id: string | null): void;
  attachFile(): Promise<void>;
  importMarkdown(): Promise<void>;
  exportBackup(): Promise<void>;
  exportAllBackup(): Promise<void>;
  importBackup(): Promise<void>;
  importAllBackup(): Promise<void>;
  rebuildIndex(): Promise<void>;
  publishAstro(): Promise<void>;
  captureUrl(input: { url: string; title: string; notebookId: string; tags: string[] }): Promise<void>;
  setTarget(): Promise<void>;
  setProject(project: ProjectInfo | null): void;
  resetDeleteArmed(): void;
  setDeleteArmed(): void;
  destroy(): void;
}

export function createNotesStore(options: NotesStoreOptions) {
  const gateway = options.gateway;
  const getTarget = options.getTarget ?? (() => null);
  const notify = options.notify ?? (() => {});
  const confirmPublish = options.confirmPublish ?? ((message: string) => globalThis.confirm(message) ?? false);
  const confirmDelete = options.confirmDelete ?? ((message: string) => globalThis.confirm(message) ?? false);
  const chooseFile = options.chooseFile ?? defaultChooseFile;
  const downloadFile = options.downloadFile ?? defaultDownloadFile;
  const onUseInChat = options.onUseInChat;
  const fileToBase64 = options.fileToBase64 ?? (async () => "");
  const invoke = options.invoke;
  const sceneId = () => getTarget()?.sceneId ?? "programming";
  const workspaceId = () => getTarget()?.workspaceId ?? "";

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  const store = create<NotesState>()((set, get) => ({
    snapshot: { notebooks: [], notes: [], tags: [] },
    project: normalizeProject(options.getProject?.()),
    selectedNotebookId: null,
    selectedNote: null,
    loading: false,
    error: null,
    trash: [],
    trashLoading: false,
    trashError: null,
    mode: "library",
    dirty: false,
    saveState: "idle",
    preview: false,
    query: "",
    selectedTag: null,
    sourceOnly: false,
    focusTitleOnNextRender: false,
    editingNotebookId: null,
    recentNoteIds: readRecentNoteIds(),
    recentNotes: [],
    moveNote: null,
    dragTargetId: null,
    selectMode: false,
    selectedNoteIds: [],
    expandedNotebookIds: new Set(),
    expandedNavSections: new Map(),
    draftTitle: "",
    draftIcon: "",
    draftContent: "",
    draftTags: [],
    deleteArmed: false,
    saveDisabled: true,

    async load({ preserveSelection = true } = {}) {
      const state = get();
      set({ loading: true, error: null });
      try {
        const response = await gateway.list(sceneId(), workspaceId(), {
          notebookId: null,
          query: state.query,
          tag: state.selectedTag,
          sourceOnly: state.sourceOnly,
        });
        const snapshot = response.snapshot ?? { notebooks: [], notes: [], tags: [] };
        let selectedNotebookId = state.selectedNotebookId;
        if (selectedNotebookId && !snapshot.notebooks.some((n) => n.id === selectedNotebookId)) {
          selectedNotebookId = null;
        }
        let selectedNote = state.selectedNote;
        const selectedNoteId = state.selectedNote?.id;
        if (!(preserveSelection && selectedNote && snapshot.notes.some((n) => n.id === selectedNoteId))) {
          if (!state.dirty) selectedNote = null;
        }
        set({ snapshot, selectedNotebookId, selectedNote });
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      } finally {
        set({ loading: false });
        void get().resolveRecentNotes();
      }
    },

    async applyFilter({ tag = null, sourceOnly: clipOnly = false } = {}) {
      await get().saveEditor();
      set({
        selectedNotebookId: null,
        selectedTag: tag,
        sourceOnly: clipOnly,
        selectedNote: null,
        dirty: false,
        editingNotebookId: null,
        mode: "library",
      });
      await get().load({ preserveSelection: false });
    },

    async selectNote(summary) {
      await get().saveEditor();
      set({ loading: true, error: null });
      try {
        const response = await gateway.get(
          sceneId(),
          workspaceId(),
          summary.notebookId,
          summary.id,
        );
        const note = response.note;
        const recentNotes = get().recentNotes;
        const updatedRecentNotes = [
          note,
          ...recentNotes.filter((entry) => entry.id !== note.id),
        ].slice(0, RECENT_NOTES_LIMIT);
        set({
          selectedNote: note,
          selectedNotebookId: note.notebookId,
          dirty: false,
          preview: true,
          mode: "library",
          recentNoteIds: [
            note.id,
            ...get().recentNoteIds.filter((id) => id !== note.id),
          ].slice(0, RECENT_NOTES_LIMIT),
          recentNotes: updatedRecentNotes,
        });
        writeRecentNoteIds(get().recentNoteIds);
        // On mobile the function-area drawer stays open over the editor after
        // selecting a note; close it explicitly because the sidebar's
        // click-to-close only fires for <button>/<a> elements, not the note
        // row's div[role="button"].
        document.dispatchEvent(
          new CustomEvent("zicode:function-area-request", {
            detail: { open: false },
          }),
        );
        void get().resolveRecentNotes();
        const expanded = new Set(get().expandedNotebookIds);
        expanded.add(note.notebookId);
        set({ expandedNotebookIds: expanded });
        get().syncDraftFromNote();
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      } finally {
        set({ loading: false });
      }
    },

    async openNote(notebookId, noteId) {
      await get().selectNote({ notebookId, id: noteId, title: "", updatedAt: "" });
    },

    async resolveRecentNotes() {
      const recentNoteIds = get().recentNoteIds;
      if (recentNoteIds.length === 0) {
        set({ recentNotes: [] });
        return;
      }
      try {
        const response = await gateway.list(sceneId(), workspaceId(), {});
        const byId = new Map(
          (response.snapshot?.notes ?? []).map((note) => [note.id, note]),
        );
        const resolved = recentNoteIds
          .map((id) => byId.get(id))
          .filter((note): note is NoteSummary => Boolean(note));
        if (resolved.length > 0) set({ recentNotes: resolved });
      } catch {
        // Recent notes are a convenience; keep the cached list on failure.
      }
    },

    selectNotebook(id) {
      set({ selectedNotebookId: id, selectedTag: null, sourceOnly: false, mode: "library" });
    },

    async discussInChat(note, selection) {
      await get().saveIfDirty();
      onUseInChat?.(get().selectedNote ?? note, selection);
    },

    attachmentUrl(note, attachmentId) {
      return gateway.attachmentUrl(sceneId(), workspaceId(), note, attachmentId);
    },

    async newNote() {
      await get().saveEditor();
      const notebookId = get().selectedNotebookId ?? get().snapshot.notebooks[0]?.id;
      if (!notebookId) {
        set({ mode: "new-notebook" });
        return;
      }
      set({ loading: true, error: null });
      try {
        const response = await gateway.create(sceneId(), workspaceId(), notebookId, {
          title: t("Untitled note"),
          content: "",
          tags: [],
          icon: DEFAULT_NOTE_ICON,
        });
        set({
          selectedNote: response.note,
          selectedNotebookId: notebookId,
          dirty: false,
          preview: false,
          focusTitleOnNextRender: true,
          mode: "library",
          // Clear active list filters (tag / web-clip / search) so the fresh
          // note stays in the snapshot after the follow-up load(); otherwise
          // load() drops it from the filtered result and closes the editor.
          selectedTag: null,
          sourceOnly: false,
          query: "",
        });
        const expanded = new Set(get().expandedNotebookIds);
        expanded.add(notebookId);
        set({ expandedNotebookIds: expanded });
        get().syncDraftFromNote();
        await get().load();
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      }
    },

    async startCapture() {
      await get().saveEditor();
      if (!get().selectedNotebookId && get().snapshot.notebooks.length === 0) {
        set({ mode: "new-notebook" });
      } else {
        set({
          selectedNotebookId: get().selectedNotebookId ?? get().snapshot.notebooks[0]?.id ?? null,
          mode: "capture",
        });
      }
    },

    async captureChatExchange({ question = "", answer = "", sessionId = "" }) {
      const normalizedAnswer = String(answer).trim();
      if (!normalizedAnswer) throw new Error(t("There is no assistant response to save"));
      if (get().snapshot.notebooks.length === 0) await get().load({ preserveSelection: false });
      let notebook =
        get().snapshot.notebooks.find((candidate) => candidate.title === t("Conversation Notes")) ||
        get().snapshot.notebooks[0];
      if (!notebook) {
        const created = await gateway.createNotebook(sceneId(), workspaceId(), {
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
      const response = await gateway.create(sceneId(), workspaceId(), notebook.id, {
        title,
        content: body,
        tags: ["chat", "captured"],
      });
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
    },

    async createNotebook(title, icon, parentId = null) {
      const normalized = title.trim();
      if (!normalized) return;
      set({ loading: true, error: null });
      try {
        const response = await gateway.createNotebook(sceneId(), workspaceId(), {
          title: normalized,
          icon: icon?.trim() || DEFAULT_NOTEBOOK_ICON,
          parentId,
        });
        const expanded = new Set(get().expandedNotebookIds);
        expanded.add(response.notebook.id);
        if (parentId) expanded.add(parentId);
        set({
          selectedNotebookId: response.notebook.id,
          expandedNotebookIds: expanded,
          mode: "library",
        });
        await get().load({ preserveSelection: false });
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      }
    },

    async deleteNotebook(notebookId) {
      const notebook = get().snapshot.notebooks.find(
        (candidate) => candidate.id === notebookId,
      );
      if (!notebook) return;
      const children = get().snapshot.notebooks.filter(
        (candidate) => candidate.parentId === notebookId,
      );
      const notesInNotebook = get().snapshot.notes.filter(
        (note) => note.notebookId === notebookId,
      ).length;
      const parts = [notebook.title];
      if (children.length > 0) parts.push(`${children.length} ${t("sub-notebooks")}`);
      if (notesInNotebook > 0) parts.push(`${notesInNotebook} ${t("notes")}`);
      const scope = parts.join(" · ");
      const message =
        children.length === 0 && notesInNotebook === 0
          ? `${t("Delete notebook")} “${notebook.title}”?`
          : `${t("Delete notebook")} “${scope}”? ${t(
              "Child notebooks and notes will also move to trash.",
            )}`;
      if (!(await confirmDelete(message))) return;
      set({ loading: true, error: null });
      try {
        await gateway.deleteNotebook(sceneId(), workspaceId(), notebookId);
        set({ selectedNotebookId: null, selectedNote: null });
        await get().load({ preserveSelection: false });
        void get().loadTrash();
        notify(t("Notebook moved to trash"));
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      }
    },

    async updateNotebook(notebookId, title, icon) {
      const normalizedTitle = String(title).trim();
      if (!normalizedTitle) return;
      set({ loading: true, error: null });
      try {
        await gateway.updateNotebook(sceneId(), workspaceId(), {
          notebookId,
          title: normalizedTitle,
          icon: String(icon).trim() || DEFAULT_NOTEBOOK_ICON,
        });
        set({ editingNotebookId: null });
        await get().load({ preserveSelection: true });
        notify(t("Notebook saved"));
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      }
    },

    async deleteSelectedNote() {
      const note = get().selectedNote;
      if (!note) return;
      set({ loading: true });
      try {
        await gateway.delete(sceneId(), workspaceId(), note);
        set({ selectedNote: null, dirty: false });
        await get().load({ preserveSelection: false });
        void get().loadTrash();
        notify(t("Note deleted"));
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      }
    },

    async loadTrash() {
      set({ trashLoading: true, trashError: null });
      try {
        const response = await gateway.listTrash(sceneId(), workspaceId());
        set({ trash: response.trash ?? [] });
      } catch (error) {
        set({ trashError: error instanceof Error ? error.message : String(error) });
      } finally {
        set({ trashLoading: false });
      }
    },

    async restoreFromTrash(entry) {
      set({ trashLoading: true, trashError: null });
      try {
        await gateway.restoreTrash(sceneId(), workspaceId(), entry.notebookId, entry.note.id);
        await get().load({ preserveSelection: false });
        await get().loadTrash();
        notify(t("Note restored"));
      } catch (error) {
        set({ trashError: error instanceof Error ? error.message : String(error) });
      } finally {
        set({ trashLoading: false });
      }
    },

    async purgeFromTrash(entry) {
      set({ trashLoading: true, trashError: null });
      try {
        await gateway.purgeTrash(sceneId(), workspaceId(), entry.notebookId, entry.note.id);
        await get().loadTrash();
        notify(t("Note permanently deleted"));
      } catch (error) {
        set({ trashError: error instanceof Error ? error.message : String(error) });
      } finally {
        set({ trashLoading: false });
      }
    },

    async emptyTrash() {
      set({ trashLoading: true, trashError: null });
      try {
        await gateway.emptyTrash(sceneId(), workspaceId());
        await get().loadTrash();
        notify(t("Trash emptied"));
      } catch (error) {
        set({ trashError: error instanceof Error ? error.message : String(error) });
      } finally {
        set({ trashLoading: false });
      }
    },

    async saveEditor() {
      const note = get().selectedNote;
      if (!note) return;
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      const draft = get();
      const tags = parseTags(draft.draftTags.join(", "));
      set({ saveDisabled: true, saveState: "saving" });
      try {
        const response = await gateway.save(sceneId(), workspaceId(), {
          ...note,
          title: draft.draftTitle,
          icon: draft.draftIcon.trim() || DEFAULT_NOTE_ICON,
          content: draft.draftContent,
          tags,
        });
        set({ selectedNote: response.note, dirty: false, saveState: "saved" });
        notify(t("Note saved"));
        setTimeout(() => {
          if (get().saveState === "saved") set({ saveState: "idle" });
        }, 2000);
        await get().load();
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      } finally {
        set({ saveDisabled: false });
      }
    },

    async saveIfDirty() {
      if (get().dirty) {
        try {
          await get().saveEditor();
        } catch {
          // Preserve the primary action even if the pending save fails.
        }
      }
    },

    markDirty() {
      set({ dirty: true, saveDisabled: false, saveState: "dirty" });
      get().scheduleAutosave();
    },

    scheduleAutosave() {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => void get().saveEditor(), AUTOSAVE_DELAY_MS);
    },

    cancelAutosave() {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
    },

    setQuery(query) {
      set({ query });
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void get().load({ preserveSelection: true }), 180);
    },

    setMode(mode) {
      set({ mode });
    },

    setEditingNotebook(editingNotebookId) {
      const expanded = new Set(get().expandedNotebookIds);
      if (editingNotebookId) expanded.add(editingNotebookId);
      set({ editingNotebookId, expandedNotebookIds: expanded });
    },

    setDraft(patch) {
      set({
        draftTitle: patch.title ?? get().draftTitle,
        draftIcon: patch.icon ?? get().draftIcon,
        draftContent: patch.content ?? get().draftContent,
        draftTags: patch.tags ?? get().draftTags,
      });
      get().markDirty();
    },

    setPreview(preview) {
      get().syncDraftFromNote();
      set({ preview });
    },

    syncDraftFromNote() {
      const note = get().selectedNote;
      if (!note) return;
      set({
        draftTitle: note.title,
        draftIcon: note.icon || DEFAULT_NOTE_ICON,
        draftContent: note.content,
        draftTags: [...(note.tags || [])],
      });
    },

    toggleNotebookExpanded(id, force) {
      const expanded = new Set(get().expandedNotebookIds);
      const next = typeof force === "boolean" ? force : !expanded.has(id);
      if (next) expanded.add(id);
      else expanded.delete(id);
      set({ expandedNotebookIds: expanded });
    },

    toggleNavSection(title, currentExpanded) {
      const sections = new Map(get().expandedNavSections);
      sections.set(title, !currentExpanded);
      set({ expandedNavSections: sections });
    },

    openMovePopover(note) {
      set({ moveNote: note });
    },

    closeMovePopover() {
      set({ moveNote: null });
    },

    async moveNoteTo(sourceNotebookId, noteId, targetNotebookId) {
      await get().saveEditor();
      const summary = get().snapshot.notes.find(
        (candidate) => candidate.id === noteId && candidate.notebookId === sourceNotebookId,
      );
      if (!summary) return;
      set({ loading: true, error: null });
      try {
        await gateway.moveNote(sceneId(), workspaceId(), {
          notebookId: sourceNotebookId,
          noteId,
          targetNotebookId,
          expectedVersion: summary.version,
        });
        if (get().selectedNote?.id === noteId) {
          set({ selectedNote: null, dirty: false });
        }
        await get().load({ preserveSelection: false });
        notify(t("Note moved"));
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      }
    },

    toggleSelectMode() {
      const selectMode = !get().selectMode;
      set({ selectMode, selectedNoteIds: selectMode ? get().selectedNoteIds : [] });
    },

    toggleNoteSelected(noteId) {
      const selected = new Set(get().selectedNoteIds);
      if (selected.has(noteId)) selected.delete(noteId);
      else selected.add(noteId);
      set({ selectedNoteIds: [...selected] });
    },

    clearNoteSelection() {
      set({ selectedNoteIds: [] });
    },

    async moveSelectedNotes(targetNotebookId) {
      const selected = [...get().selectedNoteIds];
      const summaries = get().snapshot.notes.filter(
        (candidate) => selected.includes(candidate.id) && candidate.notebookId !== targetNotebookId,
      );
      if (summaries.length === 0 || !targetNotebookId) return;
      await get().saveEditor();
      set({ loading: true, error: null });
      try {
        for (const summary of summaries) {
          await gateway.moveNote(sceneId(), workspaceId(), {
            notebookId: summary.notebookId,
            noteId: summary.id,
            targetNotebookId,
            expectedVersion: summary.version,
          });
        }
        set({
          selectedNoteIds: [],
          selectMode: false,
          selectedNote: null,
          dirty: false,
        });
        await get().load({ preserveSelection: false });
        notify(t("Notes moved"));
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      } finally {
        set({ loading: false });
      }
    },

    async deleteSelectedNotes() {
      const selected = [...get().selectedNoteIds];
      const summaries = get().snapshot.notes.filter((candidate) =>
        selected.includes(candidate.id),
      );
      if (summaries.length === 0) return;
      await get().saveEditor();
      set({ loading: true, error: null });
      try {
        for (const summary of summaries) {
          await gateway.delete(sceneId(), workspaceId(), summary);
        }
        set({
          selectedNoteIds: [],
          selectMode: false,
          selectedNote: null,
          dirty: false,
        });
        await get().load({ preserveSelection: false });
        void get().loadTrash();
        notify(t("Notes moved to trash"));
      } catch (error) {
        set({ error: localizeNotesHostError(error), loading: false });
      } finally {
        set({ loading: false });
      }
    },

    setDragTarget(dragTargetId) {
      set({ dragTargetId });
    },

    async attachFile() {
      const note = get().selectedNote;
      if (!note) return;
      try {
        const file = await chooseFile(".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json");
        if (!file) return;
        if (!file.size || file.size > 5 * 1024 * 1024) {
          throw new Error(t("Attachments must contain 1 byte to 5 MiB"));
        }
        const response = await gateway.uploadAttachment(sceneId(), workspaceId(), note, {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64: await fileToBase64(file),
        });
        if (get().preview) set({ preview: false });
        const current = get().draftContent;
        const separator = current && !current.endsWith("\n") ? "\n\n" : "";
        get().setDraft({
          content: `${current}${separator}${response.attachment.markdown}\n`,
        });
        void get().saveEditor();
        notify(t("Attachment added"));
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      }
    },

    async importMarkdown() {
      await get().saveIfDirty();
      const notebookId = get().selectedNotebookId;
      if (!notebookId) {
        set({ mode: "new-notebook" });
        return;
      }
      try {
        const file = await chooseFile(".md,.markdown");
        if (!file) return;
        if (!file.size || file.size > 1024 * 1024) {
          throw new Error(t("Markdown import exceeds the 1 MiB limit"));
        }
        const response = await gateway.importMarkdown(
          sceneId(),
          workspaceId(),
          notebookId,
          file.name,
          await file.text(),
        );
        set({ selectedNote: response.note, dirty: false, preview: true });
        get().syncDraftFromNote();
        await get().load();
        notify(t("Markdown imported"));
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      }
    },

    async exportBackup() {
      await get().saveIfDirty();
      const notebook = get().snapshot.notebooks.find(
        (candidate) => candidate.id === get().selectedNotebookId,
      );
      if (!notebook) {
        notify(t("Select a notebook first"));
        return;
      }
      try {
        const response = await gateway.exportBackup(sceneId(), workspaceId(), notebook.id);
        downloadFile(
          `${safeFileName(notebook.title)}.zicode-notes.json`,
          JSON.stringify(response.backup, null, 2),
          "application/json",
        );
        notify(t("Readable backup exported"));
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      }
    },

    async exportAllBackup() {
      await get().saveIfDirty();
      try {
        const response = await gateway.exportAllBackup(
          sceneId(),
          workspaceId(),
        );
        downloadFile(
          `zicode-notes-all-${workspaceId().slice(0, 8)}.json`,
          JSON.stringify(response.backup, null, 2),
          "application/json",
        );
        notify(t("All notebooks backup exported"));
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      }
    },

    async importBackup() {
      try {
        const file = await chooseFile(".json");
        if (!file) return;
        if (!file.size || file.size > 70 * 1024 * 1024) {
          throw new Error(t("Notes backup exceeds the 70 MiB limit"));
        }
        const backup = JSON.parse(await file.text());
        if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
          throw new SyntaxError("backup must be a JSON object");
        }
        const response = await gateway.importBackup(sceneId(), workspaceId(), backup);
        set({ selectedNotebookId: response.notebook.id, selectedNote: null, dirty: false });
        await get().load({ preserveSelection: false });
        notify(t("Notes backup imported"));
      } catch (error) {
        set({
          error:
            error instanceof SyntaxError
              ? new Error(t("Notes backup is not valid JSON"))
              : error instanceof Error
                ? error
                : new Error(String(error)),
        });
      }
    },

    async importAllBackup() {
      try {
        const file = await chooseFile(".json");
        if (!file) return;
        if (!file.size || file.size > 70 * 1024 * 1024) {
          throw new Error(t("Notes backup exceeds the 70 MiB limit"));
        }
        const backup = JSON.parse(await file.text());
        if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
          throw new SyntaxError("backup must be a JSON object");
        }
        const response = await gateway.importAllBackup(
          sceneId(),
          workspaceId(),
          backup,
        );
        const firstNotebook = response.notebooks?.[0];
        set({
          selectedNotebookId: firstNotebook?.id ?? null,
          selectedNote: null,
          dirty: false,
        });
        await get().load({ preserveSelection: false });
        notify(t("All notebooks backup imported"));
      } catch (error) {
        set({
          error:
            error instanceof SyntaxError
              ? new Error(t("Notes backup is not valid JSON"))
              : error instanceof Error
                ? error
                : new Error(String(error)),
        });
      }
    },

    async rebuildIndex() {
      await get().saveIfDirty();
      const notebookId = get().selectedNotebookId;
      if (!notebookId) {
        notify(t("Select a notebook first"));
        return;
      }
      try {
        const response = await gateway.rebuild(sceneId(), workspaceId(), notebookId);
        const report = response.report;
        await get().load();
        notify(
          `${t("Vault check complete")}: ${report.validNotes} ${t("valid notes")}, ${
            report.invalidFiles.length
          } ${t("invalid files")}`,
        );
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      }
    },

    async publishAstro() {
      await get().saveIfDirty();
      if (!get().selectedNotebookId) {
        notify(t("Select a notebook first"));
        return;
      }
      const notebook = get().snapshot.notebooks.find(
        (candidate) => candidate.id === get().selectedNotebookId,
      );
      if (!notebook) return;
      if (
        !(await confirmPublish(
          t("Build this notebook as a local Astro site? Dependencies may be downloaded."),
        ))
      ) {
        return;
      }
      if (!invoke) {
        set({ error: new Error(t("Astro publishing is available in the desktop application.")) });
        return;
      }
      set({ loading: true, error: null });
      try {
        const report = (await invoke("publish_notes_notebook", {
          workspaceId: workspaceId(),
          notebookId: notebook.id,
        })) as { noteCount: number };
        notify(`${t("Astro site built")}: ${report.noteCount} ${t("notes")} · dist/`);
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      } finally {
        set({ loading: false });
      }
    },

    async captureUrl({ url, title, notebookId, tags }) {
      let normalizedUrl = String(url).trim();
      if (!normalizedUrl) return;
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `https://${normalizedUrl}`;
      }
      set({ error: null });
      try {
        const response = await gateway.capture(sceneId(), workspaceId(), notebookId, {
          url: normalizedUrl,
          title: title || undefined,
          tags,
        });
        set({ selectedNotebookId: response.note.notebookId });
        if (response.duplicate) notify(t("This page is already in your notes"));
        await get().selectNote(response.note);
        await get().load();
      } catch (error) {
        set({ error: localizeNotesHostError(error) });
      }
    },

    async setTarget() {
      set({
        selectedNote: null,
        dirty: false,
        project: normalizeProject(options.getProject?.()),
        recentNotes: [],
      });
      await get().load({ preserveSelection: false });
      void get().resolveRecentNotes();
    },

    setProject(project) {
      set({ project: normalizeProject(project) });
    },

    resetDeleteArmed() {
      set({ deleteArmed: false });
    },

    setDeleteArmed() {
      set({ deleteArmed: true });
    },

    destroy() {
      if (searchTimer) clearTimeout(searchTimer);
      if (autosaveTimer) clearTimeout(autosaveTimer);
    },
  }));

  return store;
}

export type NotesStore = ReturnType<typeof createNotesStore>;

function normalizeProject(
  project: ProjectInfo | null | undefined,
): ProjectInfo | null {
  if (!project?.id) return null;
  const path = project.path || "";
  const name =
    project.name ||
    path.split(/[\\/]/).filter(Boolean).at(-1) ||
    project.id;
  return { id: project.id, path, name };
}

// The host returns stable English messages for API errors; map the
// user-facing ones to the active locale so the Chinese UI never shows raw
// English sentences.
export function localizeNotesHostError(error: unknown): Error {
  const runtimeClosed = localizeHostError(error);
  if (runtimeClosed !== error) return runtimeClosed;
  if (!(error instanceof Error)) return new Error(String(error));
  const code = (error as Error & { code?: string }).code;
  if (code === "permission_denied" && /network/i.test(error.message)) {
    return new Error(
      t(
        "Grant Notes network access in Plugin Manager before capturing a web page",
      ),
    );
  }
  if (code === "quota_exceeded" && /too many notes/i.test(error.message)) {
    return new Error(t("Notes backup contains too many notes"));
  }
  return error;
}
