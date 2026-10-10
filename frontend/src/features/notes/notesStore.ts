import { create } from "zustand";
import { friendlyPluginError, localizeHostError } from "../../shared/hostErrors";
import { t } from "../../shared/i18n";
import type { ModelToolChoice, ModelToolSelection } from "../../shared/ModelToolPicker";
import { createAttachmentUpload } from "./attachment-uploads";
import { createChatNoteCapture } from "./chat-note-capture";
import { createNoteDraftRecovery, type NoteRecoveryState } from "./draft-recovery";
import { createNoteDraftRepository, type NoteDraftRepository } from "./draft-repository";
import { createEditorMutations } from "./editor-mutations";
import { createEditorNavigation } from "./editor-navigation";
import { createNoteEditorSave, editorFingerprint } from "./editor-save";
import { createEditorTransition } from "./editor-transition";
import { notesImportError } from "./import-errors";
import { createNoteRelationships, watchNoteRelationshipSelection } from "./note-relationships";
import { createNoteShortcuts, type NoteShortcutState } from "./note-shortcuts";
import { createNoteTransfers } from "./note-transfer";
import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_NOTE_ICON,
  DEFAULT_NOTEBOOK_ICON,
  type Note,
  type Notebook,
  type NoteSummary,
  type NotesMode,
  type NotesSnapshot,
  sortNotesByRelevance,
  type TrashEntry,
} from "./notesLogic";
import type { NotesOperationScope } from "./operation-scope";
import { createNotesOperationScope } from "./operation-scope";
import { createShortcutRepository, type ShortcutRepository } from "./shortcut-repository";
import { defaultChooseFile, defaultDownloadFile, defaultFileToBase64 } from "./transfer-files";
import { createTrashActions, type TrashExpectation } from "./trash-actions";
import { type CapturePreview, createWebCapture } from "./web-capture";
import { createNoteWorkflowActions, type NoteWorkflow } from "./workflow-actions";

export interface NotesGatewayLike {
  listModels?(sceneId: string): Promise<{ models: ModelToolChoice[] }>;
  list(sceneId: string, workspaceId: string, filters: { notebookId?: string | null; query?: string; tag?: string | null; sourceOnly?: boolean }): Promise<{ snapshot?: NotesSnapshot }>;
  get(sceneId: string, workspaceId: string, notebookId: string, noteId: string): Promise<{ note: Note }>;
  knowledge(sceneId: string, workspaceId: string): Promise<{
    snapshot?: {
      incomplete?: boolean;
      links?: Array<{
        fromNotebookId: string;
        fromNoteId: string;
        fromTitle: string;
        toNotebookId: string;
        toNoteId: string;
        toTitle: string;
        kind: string;
      }>;
      similar?: Array<{
        leftNotebookId: string;
        leftNoteId: string;
        leftTitle: string;
        rightNotebookId: string;
        rightNoteId: string;
        rightTitle: string;
        sharedTags: string[];
      }>;
    };
  }>;
  createNotebook(sceneId: string, workspaceId: string, params: { title: string; icon?: string; parentId?: string | null }): Promise<{ notebook: Notebook }>;
  updateNotebook(sceneId: string, workspaceId: string, params: { notebookId: string; title: string; icon: string; parentId?: string | null }): Promise<unknown>;
  deleteNotebook(sceneId: string, workspaceId: string, notebookId: string): Promise<unknown>;
  create(sceneId: string, workspaceId: string, notebookId: string, params: { title: string; content?: string; tags?: string[]; icon?: string }): Promise<{ note: Note }>;
  save(sceneId: string, workspaceId: string, note: Note): Promise<{ note: Note }>;
  delete(sceneId: string, workspaceId: string, note: NoteSummary): Promise<unknown>;
  moveNote(sceneId: string, workspaceId: string, params: { notebookId: string; noteId: string; targetNotebookId: string; expectedVersion?: string | number }): Promise<unknown>;
  capture(sceneId: string, workspaceId: string, notebookId: string, params: { url: string; title?: string; tags?: string[] }): Promise<{ note: Note; duplicate?: boolean }>;
  capturePreview(sceneId: string, workspaceId: string, params: { url: string }): Promise<{
    title: string;
    markdown: string;
    finalUrl: string;
    author?: string;
    publishedAt?: string;
    siteName?: string;
    image?: string;
    duplicate: boolean;
  }>;
  summarize(
    sceneId: string,
    workspaceId: string,
    params: { text: string; title?: string; model?: string; provider?: string },
  ): Promise<{ summary: string; model: string; charCount: number }>;
  uploadAttachment(sceneId: string, workspaceId: string, note: Note, params: { fileName: string; mimeType: string; dataBase64: string }): Promise<{ attachment: { markdown: string } }>;
  attachmentUrl(sceneId: string, workspaceId: string, note: Note, attachmentId: string): string;
  importMarkdown(sceneId: string, workspaceId: string, notebookId: string, fileName: string, markdown: string): Promise<{ note: Note }>;
  exportBackup(sceneId: string, workspaceId: string, notebookId: string): Promise<{ backup: unknown }>;
  exportAllBackup(sceneId: string, workspaceId: string): Promise<{ backup: unknown }>;
  importBackup(sceneId: string, workspaceId: string, backup: unknown): Promise<{ notebook: Notebook }>;
  importAllBackup(sceneId: string, workspaceId: string, backup: unknown): Promise<{ notebooks: Notebook[] }>;
  rebuild(sceneId: string, workspaceId: string, notebookId: string): Promise<{ report: { validNotes: number; invalidFiles: unknown[] } }>;
  listTrash(sceneId: string, workspaceId: string, notebookId?: string): Promise<{ trash?: TrashEntry[] }>;
  restoreTrash(sceneId: string, workspaceId: string, notebookId: string, noteId: string, expected?: TrashExpectation): Promise<{ note: Note }>;
  purgeTrash(sceneId: string, workspaceId: string, notebookId: string, noteId: string, expected?: TrashExpectation): Promise<unknown>;
  emptyTrash(sceneId: string, workspaceId: string, notebookId?: string): Promise<{ emptied: number }>;
}

export interface NoteBacklink {
  notebookId: string;
  noteId: string;
  title: string;
  kind: string;
}

export interface SimilarNote {
  notebookId: string;
  noteId: string;
  title: string;
  sharedTags: string[];
}

export interface NotesStoreOptions {
  shortcutRepository?: ShortcutRepository;
  draftRepository?: NoteDraftRepository;
  gateway: NotesGatewayLike;
  getTarget?: () => { sceneId?: string; workspaceId?: string } | null;
  getProject?: () => ProjectInfo | null;
  notify?: (message: string) => void;
  confirmPublish?: (message: string) => boolean | Promise<boolean>;
  confirmDelete?: (message: string) => boolean | Promise<boolean>;
  chooseFile?: (accept: string) => Promise<File | null>;
  downloadFile?: (fileName: string, content: string, type: string) => void;
  onUseInChat?: (note: Note, selection: string, scope: NotesOperationScope) => void | Promise<void>;
  fileToBase64?: (file: File) => Promise<string>;
  invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  renderMarkdown?: (markdown: string) => string;
}

export interface ProjectInfo {
  id: string;
  path: string;
  name: string;
}

export interface NotesState extends NoteRecoveryState, NoteShortcutState {
  workflowBusy: NoteWorkflow | null;
  canDeactivate(): Promise<boolean>;
  attachmentBusy: boolean;
  editorLocked: boolean;
  relationshipLoading: boolean;
  relationshipError: string | null;
  relationshipIncomplete: boolean;
  transferBusy: boolean;
  summaryModel: ModelToolSelection | null;
  setSummaryModel(value: ModelToolSelection | null): void;
  getSceneId(): string;
  loadSummaryModels(): Promise<ModelToolChoice[]>;
  snapshot: NotesSnapshot;
  project: ProjectInfo | null;
  selectedNotebookId: string | null;
  selectedNote: Note | null;
  loading: boolean;
  capturing: boolean;
  error: Error | null;
  trash: TrashEntry[];
  trashLoading: boolean;
  trashBusy: boolean;
  trashLoaded: boolean;
  trashError: string | null;
  mode: NotesMode;
  summary: string | null;
  summarizing: boolean;
  newNotebookParentId: string | null;
  dirty: boolean;
  saveState: "idle" | "dirty" | "saving" | "saved";
  preview: boolean;
  query: string;
  selectedTag: string | null;
  sourceOnly: boolean;
  sortMode: "updated" | "title";
  focusTitleOnNextRender: boolean;
  editingNotebookId: string | null;
  recentNoteIds: string[];
  recentNotes: NoteSummary[];
  pinnedNoteIds: string[];
  pinnedNotes: NoteSummary[];
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
  backlinks: NoteBacklink[];
  similarNotes: SimilarNote[];
  deleteArmed: boolean;
  saveDisabled: boolean;
  load(options?: { preserveSelection?: boolean }): Promise<void>;
  applyFilter(options?: { tag?: string | null; sourceOnly?: boolean }): Promise<void>;
  selectNote(summary: NoteSummary): Promise<void>;
  loadBacklinks(note: Note): Promise<void>;
  openNote(notebookId: string, noteId: string): Promise<void>;
  selectNotebook(id: string): Promise<void>;
  resolveRecentNotes(): Promise<void>;
  resolvePinnedNotes(): Promise<void>;
  togglePinned(noteId: string, notebookId?: string): void;
  discussInChat(note: Note, selection: string): Promise<void>;
  attachmentUrl(note: Note, attachmentId: string): string;
  newNote(): Promise<void>;
  duplicateNote(): Promise<void>;
  startCapture(): Promise<void>;
  summarizeText(text: string, title?: string): Promise<string | null>;
  clearSummary(): void;
  captureChatExchange(input: { question?: string; answer?: string; sessionId?: string }): Promise<Note>;
  createNotebook(title: string, icon: string, parentId?: string | null): Promise<void>;
  deleteNotebook(notebookId: string): Promise<void>;
  updateNotebook(notebookId: string, title: string, icon: string, parentId?: string | null): Promise<void>;
  deleteSelectedNote(): Promise<void>;
  loadTrash(): Promise<void>;
  restoreFromTrash(entry: TrashEntry): Promise<void>;
  purgeFromTrash(entry: TrashEntry): Promise<void>;
  emptyTrash(): Promise<void>;
  saveEditor(silent?: boolean): Promise<void>;
  saveIfDirty(): Promise<void>;
  markDirty(): void;
  scheduleAutosave(): void;
  cancelAutosave(): void;
  setQuery(query: string): void;
  setSortMode(mode: "updated" | "title"): void;
  setMode(mode: NotesMode): void;
  startNewNotebook(parentId: string): void;
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
  downloadNote(): Promise<void>;
  copyNote(): Promise<void>;
  rebuildIndex(): Promise<void>;
  publishAstro(): Promise<void>;
  captureUrl(input: { url: string; title: string; notebookId: string; tags: string[] }): Promise<void>;
  capturePreviewUrl(url: string): Promise<CapturePreview | null>;
  invalidateCaptureView(clearSource?: boolean): void;
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
  const fileToBase64 = options.fileToBase64 ?? defaultFileToBase64;
  const invoke = options.invoke;
  const sceneId = () => getTarget()?.sceneId ?? "programming";
  const workspaceId = () => getTarget()?.workspaceId ?? "";

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let loadSequence = 0;
  let noteSelectionSequence = 0;
  let stopRelationshipWatch = () => {};
  let stopDraftWatch = () => {};
  let stopDraftLifecycle = () => {};
  let stopShortcutWatch = () => {};
  let shortcuts!: ReturnType<typeof createNoteShortcuts>;
  let recovery!: ReturnType<typeof createNoteDraftRecovery>;
  const operationScope = createNotesOperationScope(getTarget);
  let activeTarget = JSON.stringify([sceneId(), workspaceId()]);

  const store = create<NotesState>()((set, get) => {
    const guard = createEditorTransition({ get, set, capture: operationScope.capture, localize: localizeNotesHostError });
    recovery = createNoteDraftRecovery({ get, set, capture: operationScope.capture, repository: options.draftRepository ?? createNoteDraftRepository(), guard, gateway, download: downloadFile, notify });
    shortcuts = createNoteShortcuts({ get, set, capture: operationScope.capture, gateway, repository: options.shortcutRepository ?? createShortcutRepository(), notify });
    return {
    ...recovery.actions,
    ...shortcuts.actions,
    ...createWebCapture({ get, set, gateway, capture: operationScope.capture, guard, notify, localize: localizeNotesHostError }),
    async canDeactivate() { const ticket = await guard.prepare(); return Boolean(ticket?.unchanged()); },
    workflowBusy: null,
    ...createNoteWorkflowActions({ get, set, gateway, guard, capture: operationScope.capture, notify, localize: localizeNotesHostError, confirmPublish, invoke, onUseInChat }),
    attachmentBusy: false,
    editorLocked: false,
    ...createEditorNavigation({ get, set, gateway, guard, notify, localize: localizeNotesHostError }),
    ...createEditorMutations({ get, set, gateway, guard, capture: operationScope.capture, notify, confirmDelete, localize: localizeNotesHostError }),
    transferBusy: false,
    summaryModel: null,
    getSceneId: sceneId,
    loadSummaryModels: async () => (await gateway.listModels?.(sceneId()))?.models ?? [],
    snapshot: { notebooks: [], notes: [], tags: [] },
    project: normalizeProject(options.getProject?.()),
    selectedNotebookId: null,
    selectedNote: null,
    loading: false,
    capturing: false,
    error: null,
    trash: [],
    trashLoading: false,
    trashBusy: false,
    trashLoaded: false,
    trashError: null,
    mode: "library",
    summary: null,
    summarizing: false,
    dirty: false,
    saveState: "idle",
    preview: false,
    query: "",
    selectedTag: null,
    sourceOnly: false,
    sortMode: "updated",
    focusTitleOnNextRender: false,
    editingNotebookId: null,
    newNotebookParentId: null,
    recentNoteIds: [],
    recentNotes: [],
    pinnedNoteIds: [],
    pinnedNotes: [],
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
    relationshipLoading: false, relationshipError: null, relationshipIncomplete: false,
    backlinks: [],
    similarNotes: [],
    deleteArmed: false,
    saveDisabled: true,

    async load({ preserveSelection = true } = {}) {
      const state = get();
      const scope = operationScope.capture();
      const request = ++loadSequence;
      const current = () => scope.isCurrent() && request === loadSequence;
      set({ loading: true, error: null });
      try {
        const response = await gateway.list(scope.sceneId, scope.workspaceId, {
          notebookId: null,
          query: state.query,
          tag: state.selectedTag,
          sourceOnly: state.sourceOnly,
        });
        if (!current()) return;
        const live = get();
        const snapshot = response.snapshot ?? { notebooks: [], notes: [], tags: [] };
        if (state.query.trim()) {
          snapshot.notes = sortNotesByRelevance(snapshot.notes, state.query);
        }
        let selectedNotebookId = live.selectedNotebookId;
        if (selectedNotebookId && !snapshot.notebooks.some((n) => n.id === selectedNotebookId)) {
          selectedNotebookId = null;
        }
        let selectedNote = live.selectedNote;
        const selectionChanged = live.selectedNote?.id !== state.selectedNote?.id || live.selectedNote?.notebookId !== state.selectedNote?.notebookId;
        // A filtered or bounded list cannot prove that the open note was deleted.
        if (!((preserveSelection || selectionChanged) && selectedNote)) {
          if (!live.dirty) selectedNote = null;
        }
        let expandedNotebookIds = get().expandedNotebookIds;
        if (expandedNotebookIds.size === 0) {
          expandedNotebookIds = new Set(
            snapshot.notebooks
              .filter((notebook) => notebook.parentId == null)
              .map((notebook) => notebook.id),
          );
        }
        set({ snapshot, selectedNotebookId, selectedNote, expandedNotebookIds });
      } catch (error) {
        if (current()) set({ error: localizeNotesHostError(error) });
      } finally {
        if (current()) {
          set({ loading: false });
          void get().refreshShortcuts(false);
        }
      }
    },

    async selectNote(summary) {
      if (get().editorLocked) return;
      const scope = operationScope.capture();
      const request = ++noteSelectionSequence;
      const current = () => scope.isCurrent() && request === noteSelectionSequence;
      await get().saveEditor(true);
      if (!current()) return;
      if (get().dirty || get().editorLocked) { set({ loading: false }); return; }
      const editor = editorFingerprint(get());
      set({ loading: true, error: null });
      try {
        const response = await gateway.get(
          scope.sceneId,
          scope.workspaceId,
          summary.notebookId,
          summary.id,
        );
        if (!current()) return;
        if (get().editorLocked) return;
        if (get().dirty || editorFingerprint(get()) !== editor) {
          set({ error: new Error(t("The editor changed while opening a note. Save your edits and open the link again.")) });
          return;
        }
        const note = response.note;
        set({
          selectedNote: note,
          selectedNotebookId: note.notebookId,
          dirty: false,
          preview: true,
          mode: "library",
        });
        shortcuts.remember(note);
        // On mobile the function-area drawer stays open over the editor after
        // selecting a note; close it explicitly because the sidebar's
        // click-to-close only fires for <button>/<a> elements, not the note
        // row's div[role="button"].
        document.dispatchEvent(
          new CustomEvent("zicode:function-area-request", {
            detail: { open: false },
          }),
        );
        const expanded = new Set(get().expandedNotebookIds);
        expanded.add(note.notebookId);
        set({ expandedNotebookIds: expanded });
        get().syncDraftFromNote();
      } catch (error) {
        if (current()) set({ error: localizeNotesHostError(error) });
      } finally {
        if (current()) set({ loading: false });
      }
    },

    loadBacklinks: createNoteRelationships({ get, set, gateway, capture: operationScope.capture, localize: localizeNotesHostError }),

    async openNote(notebookId, noteId) {
      await get().selectNote({ notebookId, id: noteId, title: "", updatedAt: "" });
    },

    resolveRecentNotes: () => get().refreshShortcuts(),
    resolvePinnedNotes: () => get().refreshShortcuts(),
    togglePinned: shortcuts.togglePinned,

    attachmentUrl(note, attachmentId) {
      return gateway.attachmentUrl(sceneId(), workspaceId(), note, attachmentId);
    },

    captureChatExchange: createChatNoteCapture({ get, set, gateway, capture: operationScope.capture, notify }),

    async updateNotebook(notebookId, title, icon, parentId = null) {
      const normalizedTitle = String(title).trim();
      if (!normalizedTitle) return;
      set({ loading: true, error: null });
      try {
        await gateway.updateNotebook(sceneId(), workspaceId(), {
          notebookId,
          title: normalizedTitle,
          icon: String(icon).trim() || DEFAULT_NOTEBOOK_ICON,
          parentId: parentId ?? null,
        });
        set({ editingNotebookId: null });
        await get().load({ preserveSelection: true });
        notify(t("Notebook saved"));
      } catch (error) {
        const friendly = localizeNotesHostError(error);
        set({ error: friendly, loading: false });
        throw friendly;
      }
    },

    ...createTrashActions({ get, set, gateway, capture: operationScope.capture, notify, localize: localizeNotesHostError }),

    saveEditor: createNoteEditorSave({ get, set, gateway, capture: operationScope.capture, notify, localize: localizeNotesHostError }),

    async saveIfDirty() {
      if (get().dirty) {
        try {
          await get().saveEditor(true);
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
      autosaveTimer = setTimeout(() => void get().saveEditor(true), AUTOSAVE_DELAY_MS);
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

    setSortMode(mode) {
      set({ sortMode: mode });
    },

    setMode(mode) {
      set({ mode, newNotebookParentId: null });
    },

    startNewNotebook(parentId) {
      set({ newNotebookParentId: parentId, mode: "new-notebook" });
    },

    setEditingNotebook(editingNotebookId) {
      const expanded = new Set(get().expandedNotebookIds);
      if (editingNotebookId) expanded.add(editingNotebookId);
      set({ editingNotebookId, expandedNotebookIds: expanded });
    },

    setDraft(patch) {
      if (get().editorLocked) return;
      set({
        draftTitle: patch.title ?? get().draftTitle,
        draftIcon: patch.icon ?? get().draftIcon,
        draftContent: patch.content ?? get().draftContent,
        draftTags: patch.tags ?? get().draftTags,
      });
      get().markDirty();
    },

    setPreview(preview) {
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

    toggleSelectMode() {
      if (get().editorLocked) return;
      const selectMode = !get().selectMode;
      set({ selectMode, selectedNoteIds: selectMode ? get().selectedNoteIds : [] });
    },

    toggleNoteSelected(noteId) {
      if (get().editorLocked) return;
      const selected = new Set(get().selectedNoteIds);
      if (selected.has(noteId)) selected.delete(noteId);
      else selected.add(noteId);
      set({ selectedNoteIds: [...selected] });
    },

    clearNoteSelection() {
      if (get().editorLocked) return;
      set({ selectedNoteIds: [] });
    },

    setDragTarget(dragTargetId) {
      set({ dragTargetId });
    },

    attachFile: createAttachmentUpload({ get, set, gateway, capture: operationScope.capture, chooseFile, fileToBase64, retain: recovery.retainAttachment, notify, localize: localizeNotesHostError }),

    ...createNoteTransfers({ get, set, gateway, capture: operationScope.capture, notify,
      localize: localizeNotesHostError, chooseFile, downloadFile }),

    async setTarget() {
      const nextTarget = JSON.stringify([sceneId(), workspaceId()]);
      if (nextTarget === activeTarget) return;
      activeTarget = nextTarget;
      operationScope.invalidate();
      get().invalidateCaptureView();
      recovery.switchTarget();
      shortcuts.reset();
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
      loadSequence += 1;
      get().cancelAutosave();
      set({
        backlinks: [], similarNotes: [], relationshipLoading: false, relationshipError: null, relationshipIncomplete: false,
        mode: "library", summaryModel: null, capturing: false,
        query: "", selectedTag: null, sourceOnly: false, expandedNotebookIds: new Set(),
        trash: [], trashLoading: false, trashBusy: false, trashLoaded: false, trashError: null,
        workflowBusy: null, attachmentBusy: false, editorLocked: false, transferBusy: false, saveState: "idle", saveDisabled: true,
        selectedNote: null, selectedNotebookId: null, selectedNoteIds: [], selectMode: false, snapshot: { notebooks: [], notes: [], tags: [] },
        dirty: false,
        project: normalizeProject(options.getProject?.()),
        recentNotes: [],
      });
      await get().load({ preserveSelection: false });
      void get().refreshDrafts();
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
      recovery.destroy();
      stopDraftLifecycle();
      stopDraftWatch();
      stopRelationshipWatch();
      stopShortcutWatch();
      operationScope.destroy();
      loadSequence += 1;
      if (searchTimer) clearTimeout(searchTimer);
      if (autosaveTimer) clearTimeout(autosaveTimer);
    },
  }; });

  stopDraftWatch = store.subscribe((state, previous) => recovery.observe(state, previous));
  stopDraftLifecycle = recovery.listen();
  stopShortcutWatch = shortcuts.listen();
  stopRelationshipWatch = watchNoteRelationshipSelection(store);
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
  if (error.message === "The trash entry changed. Refresh the trash before trying again.") return new Error(t("The trash entry changed. Refresh the trash before trying again."));
  const importError = notesImportError(error);
  if (importError) return importError;
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
  if (code === "invalid_parent") {
    return new Error(
      t("A notebook cannot be nested inside itself or one of its own children"),
    );
  }
  const friendly = friendlyPluginError(error);
  return friendly !== error.message ? new Error(friendly) : error;
}
