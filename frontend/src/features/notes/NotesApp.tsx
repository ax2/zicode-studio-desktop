import { cloneElement, useEffect, useRef, useState } from "react";
// @ts-expect-error plain JS module without type declarations (public/ui/markdown.js)
import { renderMarkdown } from "../../../../public/ui/markdown.js";
import { t } from "../../shared/i18n";
import {
  allTagSuggestions,
  buildChildrenByParent,
  buildHeadingOutline,
  DEFAULT_NOTEBOOK_ICON,
  DEFAULT_NOTE_ICON,
  EMOJI_GROUPS,
  findActiveOutlineId,
  formatDate,
  ICONS,
  TAG_ICON_FALLBACK,
  tagIcon,
  highlightSegments,
  type Note,
  type OutlineEntry,
  type NoteSummary,
  type Notebook,
  type TrashEntry,
} from "./notesLogic";
import type { NotesStore } from "./notesStore";

function Icon({ svg }: { svg: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = svg;
  }, [svg]);
  return <span ref={ref} aria-hidden="true" />;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are non-reordered title slices
          <mark key={index} className="notes-search-hit">
            {segment.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are non-reordered title slices
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function NotesNav({ store }: { store: NotesStore }) {
  const query = store((state) => state.query);
  const setQuery = store((state) => state.setQuery);
  const setMode = store((state) => state.setMode);
  const selectMode = store((state) => state.selectMode);
  const selectedNoteIds = store((state) => state.selectedNoteIds);
  const snapshot = store((state) => state.snapshot);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchDeleteArmed, setBatchDeleteArmed] = useState(false);
  const batchArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armBatchDelete = () => {
    if (!batchDeleteArmed) {
      setBatchDeleteArmed(true);
      if (batchArmTimer.current) clearTimeout(batchArmTimer.current);
      batchArmTimer.current = setTimeout(() => setBatchDeleteArmed(false), 3000);
      return;
    }
    if (batchArmTimer.current) clearTimeout(batchArmTimer.current);
    setBatchDeleteArmed(false);
    void store.getState().deleteSelectedNotes();
  };
  return (
    <div className="notes-nav">
      <div className="notes-nav-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary notes-new-notebook"
          onClick={() => setMode("new-notebook")}
        >
          {t("New notebook")}
        </button>
        <button
          type="button"
          className={`ui-button ui-button--secondary notes-select-mode${selectMode ? " active" : ""}`}
          onClick={() => store.getState().toggleSelectMode()}
        >
          {selectMode ? t("Done") : t("Select")}
        </button>
      </div>
      <input
        type="search"
        className="notes-search-input"
        placeholder={t("Search notes")}
        aria-label={t("Search notes")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {selectMode && selectedNoteIds.length > 0 ? (
        batchOpen ? (
          <div className="notes-batch-move">
            <strong>{t("Move to notebook")}</strong>
            {snapshot.notebooks.map((notebook) => (
              <button
                key={notebook.id}
                type="button"
                className="notes-batch-move-item"
                onClick={() => {
                  setBatchOpen(false);
                  void store.getState().moveSelectedNotes(notebook.id);
                }}
              >
                <span className="notes-nav-item-icon">
                  {notebook.icon || DEFAULT_NOTEBOOK_ICON}
                </span>
                <span className="notes-nav-item-label">{notebook.title}</span>
              </button>
            ))}
            <button
              type="button"
              className="notes-batch-move-cancel"
              onClick={() => setBatchOpen(false)}
            >
              {t("Cancel")}
            </button>
          </div>
        ) : (
          <div className="notes-batch-bar" role="toolbar" aria-label={t("Move notes")}>
            <span className="notes-batch-count">
              {t("Selected")} {selectedNoteIds.length}
            </span>
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => setBatchOpen(true)}
            >
              {t("Move to…")}
            </button>
            <button
              type="button"
              className={`ui-button ui-button--danger ui-button--sm notes-batch-delete${
                batchDeleteArmed ? " notes-delete-armed" : ""
              }`}
              onClick={armBatchDelete}
            >
              {batchDeleteArmed ? t("Confirm delete selected") : t("Delete selected")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() => store.getState().clearNoteSelection()}
            >
              {t("Cancel")}
            </button>
          </div>
        )
      ) : null}
      <NotebookSection store={store} />
      <QuickAccessSection store={store} />
      <TagsSection store={store} />
      <DataManagementSection store={store} />
    </div>
  );
}

function NavSection({
  title,
  store,
  defaultExpanded = false,
  children,
}: {
  title: string;
  store: NotesStore;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const expanded = store(
    (state) => state.expandedNavSections.get(title) ?? defaultExpanded ?? false,
  );
  const toggle = store((state) => state.toggleNavSection);
  return (
    <details className="notes-nav-section" open={expanded}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: section toggle pattern preserved from the vanilla nav */}
      <summary
        className="notes-nav-section-title"
        onClick={(event) => {
          event.preventDefault();
          toggle(title, expanded);
        }}
      >
        {title}
      </summary>
      <div className="notes-nav-section-body">{children}</div>
    </details>
  );
}

function NotebookSection({ store }: { store: NotesStore }) {
  const snapshot = store((state) => state.snapshot);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const sourceOnly = store((state) => state.sourceOnly);
  const selectedTag = store((state) => state.selectedTag);
  const applyFilter = store((state) => state.applyFilter);
  const childrenByParent = buildChildrenByParent(snapshot.notebooks);
  const roots = childrenByParent.get(null) ?? [];
  return (
    <NavSection title={t("Notebooks")} store={store} defaultExpanded>
      <button
        type="button"
        className={`notes-nav-button${!selectedNotebookId && !sourceOnly && !selectedTag ? " active" : ""}`}
        onClick={() => void applyFilter({})}
      >
        {t("All notes")}
      </button>
      {roots.map((notebook) => (
        <NotebookBranch key={notebook.id} store={store} notebook={notebook} childrenByParent={childrenByParent} />
      ))}
    </NavSection>
  );
}

function NotebookBranch({
  store,
  notebook,
  childrenByParent,
}: {
  store: NotesStore;
  notebook: Notebook;
  childrenByParent: Map<string | null, Notebook[]>;
}) {
  const snapshot = store((state) => state.snapshot);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const selectedTag = store((state) => state.selectedTag);
  const sourceOnly = store((state) => state.sourceOnly);
  const query = store((state) => state.query);
  const loading = store((state) => state.loading);
  const expanded = store((state) =>
    state.expandedNotebookIds.has(notebook.id) ||
    Boolean(query || selectedTag || sourceOnly),
  );
  const editingNotebookId = store((state) => state.editingNotebookId);
  const dragTargetId = store((state) => state.dragTargetId);
  const notes = snapshot.notes.filter((note) => note.notebookId === notebook.id);
  const children = childrenByParent.get(notebook.id) ?? [];
  return (
    <details
      className={`notes-notebook-branch${dragTargetId === notebook.id ? " drop-target" : ""}`}
      data-notebook-id={notebook.id}
      open={expanded}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: notebook selection pattern preserved from the vanilla tree */}
      <summary
        className={`notes-notebook-summary${
          selectedNotebookId === notebook.id && !sourceOnly && !selectedTag ? " active" : ""
        }${dragTargetId === notebook.id ? " drop-target" : ""}`}
        onClick={(event) => {
          event.preventDefault();
          store.getState().toggleNotebookExpanded(notebook.id, !expanded);
          store.getState().selectNotebook(notebook.id);
        }}
      >
        <span className="notes-notebook-icon">
          <span className="notes-folder-glyph">{expanded ? "📂" : "📁"}</span>
          {notebook.icon ? <span className="notes-notebook-icon-badge">{notebook.icon}</span> : null}
        </span>
        <span className="notes-notebook-title">{notebook.title}</span>
        <small>{String(notebook.noteCount ?? notes.length)}</small>
        <NotebookActions store={store} notebook={notebook} />
      </summary>
      {editingNotebookId === notebook.id ? <NotebookEditForm store={store} notebook={notebook} /> : null}
      <div className="notes-notebook-children">
        {loading && snapshot.notes.length === 0 ? (
          <p className="notes-nav-message">{t("Loading notes…")}</p>
        ) : notes.length === 0 && children.length === 0 ? (
          <p className="notes-nav-message">{t("No notes found")}</p>
        ) : (
          <>
            {notes.map((note) => (
              <NoteTreeItem key={note.id} store={store} note={note} />
            ))}
            {children.map((child) => (
              <NotebookBranch key={child.id} store={store} notebook={child} childrenByParent={childrenByParent} />
            ))}
          </>
        )}
      </div>
    </details>
  );
}

function NotebookActions({ store, notebook }: { store: NotesStore; notebook: Notebook }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: ARIA group pattern preserved from the vanilla notebook actions
    <span className="notes-notebook-actions" role="group" aria-label={t("Notebook actions")}>
      <IconAction
        label={t("New note in this notebook")}
        icon={ICONS.plus}
        className="notes-notebook-new-note"
        onClick={() => {
          store.setState({ selectedNotebookId: notebook.id });
          void store.getState().newNote();
        }}
      />
      <IconAction
        label={t("Capture URL into this notebook")}
        icon={ICONS.globe}
        className="notes-notebook-capture"
        onClick={() => {
          store.setState({ selectedNotebookId: notebook.id });
          void store.getState().startCapture();
        }}
      />
      <IconAction
        label={t("Edit notebook")}
        icon={ICONS.pencil}
        className="notes-notebook-edit"
        onClick={() =>
          store.getState().setEditingNotebook(
            store.getState().editingNotebookId === notebook.id ? null : notebook.id,
          )
        }
      />
      <IconAction
        label={t("Delete notebook")}
        icon={ICONS.trash}
        className="notes-notebook-delete"
        onClick={() => void store.getState().deleteNotebook(notebook.id)}
      />
    </span>
  );
}

function IconAction({
  label,
  icon,
  className,
  onClick,
}: {
  label: string;
  icon: string;
  className: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`notes-icon-action ${className}`.trim()}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon svg={icon} />
    </button>
  );
}

function NotebookEditForm({ store, notebook }: { store: NotesStore; notebook: Notebook }) {
  const [title, setTitle] = useState(notebook.title);
  const [icon, setIcon] = useState(notebook.icon || DEFAULT_NOTEBOOK_ICON);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="notes-notebook-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        void store.getState().updateNotebook(notebook.id, title, icon);
      }}
    >
      <label htmlFor="notes-edit-icon">
        <span>{t("Icon")}</span>
        <div className="notes-icon-box">
          <EmojiPicker
            onPick={setIcon}
            label={t("Choose an icon")}
            trigger={
              <input
                id="notes-edit-icon"
                ref={inputRef}
                className="notes-field-input"
                maxLength={8}
                title={t("Choose an icon")}
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
              />
            }
          />
        </div>
      </label>
      <label className="notes-field">
        <span>{t("Notebook name")}</span>
        <input
          className="notes-field-input"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="notes-form-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => store.getState().setEditingNotebook(null)}
        >
          {t("Cancel")}
        </button>
        <button type="submit" className="ui-button ui-button--primary">
          {t("Save notebook")}
        </button>
      </div>
    </form>
  );
}

function EmojiPicker({
  onPick,
  label,
  trigger,
}: {
  onPick(emoji: string): void;
  label: string;
  trigger: React.ReactElement<{ onFocus?: () => void; onClick?: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const picker = containerRef.current;
      const anchor = picker?.closest(".notes-icon-box");
      if (
        picker &&
        !picker.contains(event.target as Node) &&
        !anchor?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      {cloneElement(trigger, {
        onFocus: () => setOpen(true),
        onClick: () => setOpen(true),
      })}
      {open ? (
        <div ref={containerRef} className="notes-emoji-picker" role="dialog" aria-label={label}>
          <div className="notes-emoji-categories">
            {EMOJI_GROUPS.map(([name], index) => (
              <button
                key={name}
                type="button"
                className={`notes-emoji-category${index === category ? " active" : ""}`}
                onClick={() => setCategory(index)}
              >
                {t(name)}
              </button>
            ))}
          </div>
          <div className="notes-emoji-grid">
            {EMOJI_GROUPS[category]?.[1].map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="notes-emoji-item"
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function QuickAccessSection({ store }: { store: NotesStore }) {
  const sourceOnly = store((state) => state.sourceOnly);
  const applyFilter = store((state) => state.applyFilter);
  const recentNotes = store((state) => state.recentNotes);
  return (
    <NavSection title={t("Quick access")} store={store}>
      {recentNotes.length > 0 ? (
        <>
          {recentNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              className="notes-nav-button"
              onClick={() => void store.getState().selectNote(note)}
            >
              <span className="notes-nav-item-icon">
                {note.icon || DEFAULT_NOTE_ICON}
              </span>
              <span className="notes-nav-item-label">{note.title}</span>
            </button>
          ))}
          <div className="notes-nav-quick-separator" />
        </>
      ) : null}
      <button
        type="button"
        className={`notes-nav-button${sourceOnly ? " active" : ""}`}
        onClick={() => void applyFilter({ sourceOnly: true })}
      >
        {t("Web clips")}
      </button>
    </NavSection>
  );
}

function TagsSection({ store }: { store: NotesStore }) {
  const snapshot = store((state) => state.snapshot);
  const selectedTag = store((state) => state.selectedTag);
  const applyFilter = store((state) => state.applyFilter);
  if (!snapshot.tags.length) return null;
  return (
    <NavSection title={t("Tags")} store={store} defaultExpanded={Boolean(selectedTag)}>
      {snapshot.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className={`notes-nav-button${selectedTag === tag ? " active" : ""}`}
          onClick={() => void applyFilter({ tag })}
        >
          <span className="notes-nav-item-icon">{tagIcon(tag)}</span>
          <span className="notes-nav-item-label">{tag}</span>
        </button>
      ))}
    </NavSection>
  );
}

function DataManagementSection({ store }: { store: NotesStore }) {
  const trashCount = store((state) => state.trash.length);
  useEffect(() => {
    void store.getState().loadTrash();
  }, [store]);
  return (
    <NavSection title={t("Data management")} store={store}>
      <NavAction label={t("Import Markdown")} onClick={() => void store.getState().importMarkdown()} />
      <NavAction label={t("Export readable backup")} onClick={() => void store.getState().exportBackup()} />
      <NavAction label={t("Export all notebooks backup")} onClick={() => void store.getState().exportAllBackup()} />
      <NavAction label={t("Import backup")} onClick={() => void store.getState().importBackup()} />
      <NavAction label={t("Import all notebooks backup")} onClick={() => void store.getState().importAllBackup()} />
      <NavAction label={t("Check and rebuild Vault")} onClick={() => void store.getState().rebuildIndex()} />
      <NavAction label={t("Build Astro site")} onClick={() => void store.getState().publishAstro()} />
      <NavAction
        label={trashCount > 0 ? `${t("Trash")} (${trashCount})` : t("Trash")}
        onClick={() => {
          void store.getState().loadTrash();
          store.getState().setMode("trash");
        }}
      />
    </NavSection>
  );
}

function NavAction({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="notes-nav-button" onClick={onClick}>
      {label}
    </button>
  );
}

function NoteTreeItem({ store, note }: { store: NotesStore; note: NoteSummary }) {
  const selectedNote = store((state) => state.selectedNote);
  const query = store((state) => state.query);
  const selectNote = store((state) => state.selectNote);
  const openMovePopover = store((state) => state.openMovePopover);
  const selectMode = store((state) => state.selectMode);
  const selectedNoteIds = store((state) => state.selectedNoteIds);
  const isSelected = selectedNoteIds.includes(note.id);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    ghost: HTMLElement | null;
    targetId: string | null;
  } | null>(null);

  function beginPointerDrag(event: React.PointerEvent) {
    if (dragRef.current || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    dragRef.current = { startX, startY, active: false, ghost: null, targetId: null };
    const onMove = (moveEvent: PointerEvent) => {
      const session = dragRef.current;
      if (!session) return;
      const dx = moveEvent.clientX - session.startX;
      const dy = moveEvent.clientY - session.startY;
      if (!session.active) {
        if (Math.hypot(dx, dy) < 6) return;
        session.active = true;
        session.ghost = buildDragGhost(note);
        document.body.append(session.ghost);
        document.body.classList.add("notes-dragging");
      }
      if (session.ghost) {
        session.ghost.style.transform = `translate(${Math.round(moveEvent.clientX + 10)}px, ${Math.round(moveEvent.clientY + 10)}px)`;
      }
      const targetId = dropTargetIdAt(moveEvent.clientX, moveEvent.clientY);
      if (targetId !== session.targetId) {
        session.targetId = targetId;
        store.getState().setDragTarget(targetId);
      }
    };
    const onUp = (upEvent: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      const session = dragRef.current;
      dragRef.current = null;
      document.body.classList.remove("notes-dragging");
      if (session?.ghost) session.ghost.remove();
      const targetId = session?.active ? dropTargetIdAt(upEvent.clientX, upEvent.clientY) : null;
      store.getState().setDragTarget(null);
      if (targetId && session && targetId !== note.notebookId) {
        void store.getState().moveNoteTo(note.notebookId, note.id, targetId);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    event.preventDefault();
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: ARIA button pattern preserved from the vanilla note tree items
    <div
      role="button"
      tabIndex={0}
      className={`notes-list-item notes-tree-note${selectedNote?.id === note.id ? " active" : ""}${
        isSelected ? " notes-selected" : ""
      }`}
      draggable={false}
      onClick={() => {
        if (selectMode) {
          store.getState().toggleNoteSelected(note.id);
          return;
        }
        void selectNote(note);
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest?.(".notes-move-btn")) return;
        beginPointerDrag(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void selectNote(note);
        }
      }}
    >
      {selectMode ? (
        <span className={`notes-select-check${isSelected ? " checked" : ""}`} aria-hidden="true">
          {isSelected ? "✓" : ""}
        </span>
      ) : null}
      {note.icon ? <span className="notes-note-icon">{note.icon}</span> : null}
      <span className="notes-list-item-main">
        <strong>
          <HighlightedText text={note.title} query={query} />
        </strong>
        <span>
          {formatDate(note.updatedAt)}
          {note.source ? ` · ${t("Web clip")}` : ""}
        </span>
      </span>
      <span className="notes-drag-handle" aria-hidden="true">
        ⠿
      </span>
      <button
        type="button"
        className="notes-move-btn"
        title={t("Move to notebook")}
        aria-label={t("Move to notebook")}
        onClick={(event) => {
          event.stopPropagation();
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          setPopoverPos({ top: Math.round(rect.bottom + 4), left: Math.max(8, Math.round(rect.left)) });
          openMovePopover(note);
        }}
      >
        ⇄
      </button>
      {popoverPos ? <MovePopover store={store} note={note} pos={popoverPos} onClose={() => setPopoverPos(null)} /> : null}
    </div>
  );
}

function buildDragGhost(note: NoteSummary): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "notes-drag-ghost";
  if (note.icon) {
    const icon = document.createElement("span");
    icon.className = "notes-note-icon";
    icon.textContent = note.icon;
    ghost.append(icon);
  }
  const main = document.createElement("span");
  main.className = "notes-list-item-main";
  const title = document.createElement("strong");
  title.textContent = note.title;
  const meta = document.createElement("span");
  meta.textContent = formatDate(note.updatedAt);
  main.append(title, meta);
  ghost.append(main);
  return ghost;
}

function dropTargetIdAt(x: number, y: number): string | null {
  const target = document.elementFromPoint(x, y);
  const branch = target?.closest?.(".notes-notebook-branch");
  return (branch as HTMLElement | null)?.dataset?.notebookId ?? null;
}

function MovePopover({
  store,
  note,
  pos,
  onClose,
}: {
  store: NotesStore;
  note: NoteSummary;
  pos: { top: number; left: number };
  onClose(): void;
}) {
  const snapshot = store((state) => state.snapshot);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
        store.getState().closeMovePopover();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        store.getState().closeMovePopover();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, store]);
  return (
    <div ref={ref} className="notes-move-popover" role="dialog" aria-label={t("Move to notebook")} style={{ top: pos.top, left: pos.left }}>
      <strong className="notes-move-popover-title">
        {t("Move to notebook")} · {note.title}
      </strong>
      <div className="notes-move-popover-list">
        {snapshot.notebooks
          .filter((notebook) => notebook.id !== note.notebookId)
          .map((notebook) => (
            <button
              key={notebook.id}
              type="button"
              className="notes-move-popover-item"
              onClick={() => {
                onClose();
                store.getState().closeMovePopover();
                void store.getState().moveNoteTo(note.notebookId, note.id, notebook.id);
              }}
            >
              <span className="notes-nav-item-icon">{notebook.icon || DEFAULT_NOTEBOOK_ICON}</span>
              <span className="notes-nav-item-label">{notebook.title}</span>
            </button>
          ))}
        {snapshot.notebooks.filter((notebook) => notebook.id !== note.notebookId).length === 0 ? (
          <p className="notes-nav-message">{t("No other notebooks")}</p>
        ) : null}
      </div>
    </div>
  );
}

export function NotesContent({ store }: { store: NotesStore }) {
  const loading = store((state) => state.loading);
  const selectedNote = store((state) => state.selectedNote);
  const mode = store((state) => state.mode);
  const error = store((state) => state.error);
  const selectedTag = store((state) => state.selectedTag);
  const sourceOnly = store((state) => state.sourceOnly);
  const snapshot = store((state) => state.snapshot);

  if (loading && !selectedNote) {
    return <StateCard text={t("Loading notes…")} />;
  }
  if (mode === "new-notebook") return <NotebookForm store={store} />;
  if (mode === "capture") return <CaptureForm store={store} />;
  if (mode === "trash") return <TrashView store={store} />;
  if (selectedNote) return <NoteEditor store={store} />;
  if ((selectedTag || sourceOnly) && snapshot.notes.length > 0) {
    return <FilterResultsView store={store} />;
  }
  if (error) {
    return (
      <Panel title={t("Notes unavailable")} description={error.message}>
        <button type="button" className="ui-button ui-button--primary" onClick={() => void store.getState().load()}>
          {t("Retry")}
        </button>
      </Panel>
    );
  }
  return <EmptyLibrary store={store} />;
}

function StateCard({ text }: { text: string }) {
  return <Panel title={text} description="" />;
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="notes-state-panel ui-card">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  );
}

function NotebookForm({ store }: { store: NotesStore }) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState(DEFAULT_NOTEBOOK_ICON);
  const [parentId, setParentId] = useState("");
  const snapshot = store((state) => state.snapshot);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <Panel title={t("Create notebook")} description={t("Each notebook is a readable Astro-compatible Markdown vault.")}>
      <form
        className="notes-form"
        onSubmit={(event) => {
          event.preventDefault();
          void store.getState().createNotebook(title, icon, parentId || null);
        }}
      >
        <label>
          <span>{t("Notebook name")}</span>
          <input ref={inputRef} className="notes-field-input" required placeholder={t("My Notes")} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label htmlFor="notes-new-icon">
          <span>{t("Icon")}</span>
          <div className="notes-icon-box">
            <EmojiPicker
              onPick={setIcon}
              label={t("Choose an icon")}
              trigger={
                <input
                  id="notes-new-icon"
                  className="notes-field-input"
                  maxLength={8}
                  title={t("Choose an icon")}
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                />
              }
            />
          </div>
        </label>
        <label>
          <span>{t("Parent notebook")}</span>
          <select defaultValue={selectedNotebookId || ""} value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">{t("Top level")}</option>
            {snapshot.notebooks.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <div className="notes-form-actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={() => store.getState().setMode("library")}>
            {t("Cancel")}
          </button>
          <button type="submit" className="ui-button ui-button--primary">
            {t("Create notebook")}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function CaptureForm({ store }: { store: NotesStore }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notebookId, setNotebookId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const snapshot = store((state) => state.snapshot);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const urlRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    urlRef.current?.focus();
  }, []);
  return (
    <Panel title={t("Capture web page")} description={t("ZiCode retrieves readable public content without sending cookies or authorization headers.")}>
      <form
        className="notes-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await store.getState().captureUrl({
              url,
              title,
              notebookId: notebookId || selectedNotebookId || snapshot.notebooks[0]?.id || "",
              tags,
            });
          } catch (captureError) {
            setError(captureError instanceof Error ? captureError.message : String(captureError));
          }
        }}
      >
        <label>
          <span>{t("Page URL")}</span>
          <input ref={urlRef} className="notes-field-input" type="url" required placeholder="https://example.com/article" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label>
          <span>{t("Title override (optional)")}</span>
          <input className="notes-field-input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <TagEditor store={store} tags={tags} onChange={setTags} />
        <label>
          <span>{t("Notebook")}</span>
          <select value={notebookId || selectedNotebookId || ""} onChange={(event) => setNotebookId(event.target.value)}>
            {snapshot.notebooks.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="notes-form-error">{error}</p> : null}
        <div className="notes-form-actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={() => store.getState().setMode("library")}>
            {t("Cancel")}
          </button>
          <button type="submit" className="ui-button ui-button--primary">
            {t("Capture")}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function TagEditor({
  store,
  tags,
  onChange,
}: {
  store: NotesStore;
  tags: string[];
  onChange(tags: string[]): void;
}) {
  const snapshotTags = store((state) => state.snapshot.tags);
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pool = allTagSuggestions(snapshotTags).filter(
    (name) => !tags.includes(name) && (!input.trim() || name.toLowerCase().includes(input.trim().toLowerCase())),
  );
  const candidate = input.trim().replace(/^#/, "");
  if (
    candidate &&
    pool.length === 0 &&
    !tags.includes(candidate) &&
    !pool.includes(candidate)
  ) {
    pool.unshift(candidate);
  }
  const addTag = (value: string) => {
    const name = String(value).trim().replace(/^#/, "");
    if (!name || tags.includes(name)) return;
    onChange([...tags, name]);
    setInput("");
    setShowSuggestions(false);
  };
  return (
    <div className="notes-tag-editor">
      <span className="notes-tag-input-icon">{TAG_ICON_FALLBACK}</span>
      <div className="notes-tag-chips">
        {tags.map((tag) => (
          <span key={tag} className="notes-tag-chip" data-tag-chip={tag}>
            <span className="notes-tag-chip-icon">{tagIcon(tag)}</span>
            <span className="notes-tag-chip-name">{tag}</span>
            <button
              type="button"
              className="notes-tag-chip-remove"
              title={t("Remove tag")}
              aria-label={`${t("Remove tag")} ${tag}`}
              onClick={() => onChange(tags.filter((entry) => entry !== tag))}
            >
              <Icon svg={ICONS.close} />
            </button>
          </span>
        ))}
      </div>
      <input
        className="notes-tag-input"
        placeholder={t("Add tag")}
        aria-label={t("Add tag")}
        autoComplete="off"
        value={input}
        onFocus={() => setShowSuggestions(true)}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            if (input.trim()) addTag(input);
          } else if (event.key === "Backspace" && !input && tags.length) {
            onChange(tags.slice(0, -1));
          } else if (event.key === "Escape") {
            setShowSuggestions(false);
            (event.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
      />
      {showSuggestions && pool.length > 0 ? (
        <div className="notes-tag-suggestions" role="listbox" aria-label={t("Add tag")}>
          {pool.slice(0, 8).map((name) => (
            <button
              key={name}
              type="button"
              className="notes-tag-suggestion"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => addTag(name)}
            >
              <span className="notes-tag-chip-icon">{tagIcon(name)}</span>
              <span>{name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilterResultsView({ store }: { store: NotesStore }) {
  const snapshot = store((state) => state.snapshot);
  const selectedTag = store((state) => state.selectedTag);
  const query = store((state) => state.query);
  const applyFilter = store((state) => state.applyFilter);
  const selectNote = store((state) => state.selectNote);
  return (
    <section className="notes-results">
      <h1 className="notes-results-title">
        {selectedTag ? `${t("Tag")} #${selectedTag}` : t("Web clips")}
      </h1>
      <div className="notes-results-meta">
        <span>
          {snapshot.notes.length} {t("notes")}
        </span>
        <button type="button" className="ui-button ui-button--ghost" onClick={() => void applyFilter({})}>
          {t("Show all notes")}
        </button>
      </div>
      <div className="notes-results-list">
        {snapshot.notes.map((note) => (
          // biome-ignore lint/a11y/useSemanticElements: ARIA button pattern preserved from the vanilla results list
          <div
            key={note.id}
            role="button"
            tabIndex={0}
            className="notes-result-item"
            onClick={() => void selectNote(note)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void selectNote(note);
              }
            }}
          >
            {note.icon ? <span className="notes-result-icon">{note.icon}</span> : null}
            <span className="notes-result-main">
              <strong>
                <HighlightedText text={note.title} query={query} />
              </strong>
              <span>{formatDate(note.updatedAt)}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyLibrary({ store }: { store: NotesStore }) {
  const snapshot = store((state) => state.snapshot);
  const sourceOnly = store((state) => state.sourceOnly);
  const selectedTag = store((state) => state.selectedTag);
  const newNote = store((state) => state.newNote);
  const startCapture = store((state) => state.startCapture);
  const setMode = store((state) => state.setMode);
  const applyFilter = store((state) => state.applyFilter);
  if (sourceOnly) {
    return (
      <Panel title={t("Web clips")} description={t("No web clips yet. Capture a public page to collect it here.")}>
        <div className="notes-empty-actions">
          <button type="button" className="ui-button ui-button--primary" onClick={() => void startCapture()}>
            {t("Capture URL")}
          </button>
          <button type="button" className="ui-button ui-button--ghost" onClick={() => void applyFilter({})}>
            {t("Show all notes")}
          </button>
        </div>
      </Panel>
    );
  }
  if (selectedTag) {
    return (
      <Panel title={`${t("Tag")} #${selectedTag}`} description={t("No notes match this tag yet.")}>
        <div className="notes-empty-actions">
          <button type="button" className="ui-button ui-button--primary" onClick={() => void newNote()}>
            {t("New note")}
          </button>
          <button type="button" className="ui-button ui-button--ghost" onClick={() => void applyFilter({})}>
            {t("Show all notes")}
          </button>
        </div>
      </Panel>
    );
  }
  return (
    <section className="notes-state-panel notes-empty-library ui-card">
      <div className="notes-empty-hero">
        <span className="notes-empty-hero-icon" aria-hidden="true">
          {snapshot.notebooks.length ? "📓" : "🗂️"}
        </span>
        <h1>{snapshot.notebooks.length ? t("No note selected") : t("Your local Notes library")}</h1>
        <p>
          {snapshot.notebooks.length
            ? t("Choose a note from the function area or create a new one.")
            : t("Create a notebook to start a readable Markdown and Astro-compatible vault.")}
        </p>
        <div className="notes-empty-actions">
          {snapshot.notebooks.length ? (
            <>
              <button type="button" className="ui-button ui-button--primary" onClick={() => void newNote()}>
                {t("New note")}
              </button>
              <button type="button" className="ui-button ui-button--secondary" onClick={() => void startCapture()}>
                {t("Capture URL")}
              </button>
            </>
          ) : (
            <button type="button" className="ui-button ui-button--primary" onClick={() => setMode("new-notebook")}>
              {t("Create notebook")}
            </button>
          )}
        </div>
      </div>
      <aside className="notes-empty-quickstart" aria-label={t("Quick start")}>
        <h2>{t("Quick start")}</h2>
        <ul>
          <li>
            <span className="notes-empty-step-icon" aria-hidden="true">
              📝
            </span>
            <span>{t("Create or open a note from the notebook tree")}</span>
          </li>
          <li>
            <span className="notes-empty-step-icon" aria-hidden="true">
              🌐
            </span>
            <span>{t("Capture a public web page into a note")}</span>
          </li>
          <li>
            <span className="notes-empty-step-icon" aria-hidden="true">
              💬
            </span>
            <span>{t("Discuss a note or selection in Chat")}</span>
          </li>
        </ul>
      </aside>
    </section>
  );
}

function TrashView({ store }: { store: NotesStore }) {
  const trash = store((state) => state.trash);
  const trashLoading = store((state) => state.trashLoading);
  const trashError = store((state) => state.trashError);
  const snapshot = store((state) => state.snapshot);
  const setMode = store((state) => state.setMode);
  const [purgeArmedId, setPurgeArmedId] = useState<string | null>(null);
  const [emptyArmed, setEmptyArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const purge = (entry: TrashEntry) => {
    if (purgeArmedId !== entry.note.id) {
      setPurgeArmedId(entry.note.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setPurgeArmedId(null), 3000);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setPurgeArmedId(null);
    void store.getState().purgeFromTrash(entry);
  };

  const empty = () => {
    if (!emptyArmed) {
      setEmptyArmed(true);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => {
        setEmptyArmed(false);
        setPurgeArmedId(null);
      }, 3000);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setEmptyArmed(false);
    void store.getState().emptyTrash();
  };

  return (
    <section className="notes-state-panel notes-trash-panel ui-card">
      <div className="notes-trash-header">
        <h1>{t("Trash")}</h1>
        <div className="notes-trash-actions">
          {trash.length > 0 ? (
            <button
              type="button"
              className={`ui-button ui-button--danger ui-button--sm notes-trash-empty${
                emptyArmed ? " notes-delete-armed" : ""
              }`}
              disabled={trashLoading}
              onClick={empty}
            >
              {emptyArmed ? t("Confirm empty trash") : t("Empty trash")}
            </button>
          ) : null}
          <button type="button" className="ui-button ui-button--ghost" onClick={() => setMode("library")}>
            {t("All notes")}
          </button>
        </div>
      </div>
      {trashError ? (
        <div className="notes-error-banner" role="alert">
          {trashError}
        </div>
      ) : null}
      {trashLoading ? <p className="notes-nav-message">{t("Loading trash…")}</p> : null}
      {!trashLoading && trash.length === 0 ? (
        <p className="notes-nav-message">{t("Trash is empty")}</p>
      ) : null}
      <div className="notes-trash-list">
        {trash.map((entry) => (
          <div key={entry.note.id} className="notes-trash-item">
            <span className="notes-note-icon" aria-hidden="true">
              {entry.note.icon || DEFAULT_NOTE_ICON}
            </span>
            <span className="notes-list-item-main">
              <strong>{entry.note.title}</strong>
              <span>
                {snapshot.notebooks.find((notebook) => notebook.id === entry.notebookId)?.title ??
                  entry.notebookTitle ??
                  ""}
                {snapshot.notebooks.some((notebook) => notebook.id === entry.notebookId)
                  ? " · "
                  : entry.notebookTitle
                    ? " · "
                    : ""}
                {t("Deleted")} {formatDate(entry.deletedAt)}
              </span>
            </span>
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm notes-trash-restore"
              disabled={trashLoading}
              onClick={() => void store.getState().restoreFromTrash(entry)}
            >
              {t("Restore")}
            </button>
            <button
              type="button"
              className={`ui-button ui-button--danger ui-button--sm notes-trash-purge${
                purgeArmedId === entry.note.id ? " notes-delete-armed" : ""
              }`}
              disabled={trashLoading}
              onClick={() => purge(entry)}
            >
              {purgeArmedId === entry.note.id
                ? t("Confirm permanently delete")
                : t("Delete permanently")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function NoteEditor({ store }: { store: NotesStore }) {
  const note = store((state) => state.selectedNote) as Note;
  const draftTitle = store((state) => state.draftTitle);
  const draftIcon = store((state) => state.draftIcon);
  const draftContent = store((state) => state.draftContent);
  const draftTags = store((state) => state.draftTags);
  const preview = store((state) => state.preview);
  const dirty = store((state) => state.dirty);
  const saveDisabled = store((state) => state.saveDisabled);
  const saveState = store((state) => state.saveState);
  const deleteArmed = store((state) => state.deleteArmed);
  const error = store((state) => state.error);
  const setDraft = store((state) => state.setDraft);
  const setPreview = store((state) => state.setPreview);
  const setDeleteArmed = store((state) => state.setDeleteArmed);
  const resetDeleteArmed = store((state) => state.resetDeleteArmed);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);

  useEffect(() => {
    if (preview && previewRef.current) {
      previewRef.current.innerHTML = renderMarkdown(draftContent);
      rewriteAttachmentUrls(previewRef.current, store);
      setOutline(buildHeadingOutline(previewRef.current));
    }
  }, [preview, draftContent, store]);

  useEffect(() => {
    if (!preview) return;
    let frame = 0;
    const updateActive = () => {
      frame = 0;
      const items = outline
        .map((entry) => ({
          id: entry.id,
          top: document.getElementById(entry.id)?.getBoundingClientRect().top ?? 0,
        }))
        .filter((item) => item.top >= 0);
      // getBoundingClientRect().top is viewport-relative, so the reading
      // line sits at `line` pixels from the viewport top (viewportTop = 0).
      setActiveOutlineId(findActiveOutlineId(items, 0));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateActive);
    };
    updateActive();
    // Scroll events do not bubble, but a capture-phase document listener
    // catches scrolls from any scrollable container (the app main view
    // scrolls internally, not the window).
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [preview, outline]);

  useEffect(() => {
    if (store.getState().focusTitleOnNextRender) {
      store.setState({ focusTitleOnNextRender: false });
    }
  }, [store]);

  const selection = () => {
    if (preview && previewRef.current) {
      const windowSelection = window.getSelection();
      if (
        windowSelection &&
        windowSelection.rangeCount > 0 &&
        windowSelection.anchorNode &&
        previewRef.current.contains(windowSelection.anchorNode)
      ) {
        return windowSelection.toString().trim();
      }
      return "";
    }
    return (
      contentRef.current?.value.slice(
        contentRef.current.selectionStart ?? 0,
        contentRef.current.selectionEnd ?? 0,
      ).trim() ?? ""
    );
  };

  const currentSelectionRef = useRef("");
  useEffect(() => {
    currentSelectionRef.current = selection();
  });

  const armedDelete = () => {
    if (!deleteArmed) {
      setDeleteArmed();
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => resetDeleteArmed(), 3000);
      return;
    }
    resetDeleteArmed();
    void store.getState().deleteSelectedNote();
  };

  return (
    <section className="notes-editor">
      <div className="notes-editor-toolbar">
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA group pattern preserved from the vanilla note tabs */}
        <div className="notes-editor-tabs" role="group" aria-label={t("Note view")}>
          <ToolbarButton
            label={t("Edit")}
            icon={ICONS.edit}
            className="notes-edit-tab"
            variant={preview ? "ui-button--ghost" : "ui-button--secondary"}
            ariaPressed={!preview}
            onClick={() => setPreview(false)}
          />
          <ToolbarButton
            label={t("Preview")}
            icon={ICONS.preview}
            className="notes-preview-tab"
            variant={preview ? "ui-button--secondary" : "ui-button--ghost"}
            ariaPressed={preview}
            onClick={() => setPreview(true)}
          />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA group pattern preserved from the vanilla note actions */}
        <div className="notes-editor-actions" role="group" aria-label={t("Note actions")}>
          <ToolbarButton
            label={t("Discuss in Chat")}
            icon={ICONS.chat}
            className="notes-use-in-chat"
            variant="ui-button--secondary"
            onClick={() => {
              store.getState().discussInChat(
                note,
                selection() || currentSelectionRef.current,
              );
            }}
          />
          <ToolbarButton
            label={t("Attach")}
            icon={ICONS.attach}
            className="notes-attach"
            variant="ui-button--ghost"
            onClick={() => void store.getState().attachFile()}
          />
          <ToolbarButton
            label={t("Save")}
            icon={ICONS.save}
            className="notes-save"
            variant="ui-button--primary"
            disabled={saveDisabled || !dirty}
            onClick={() => void store.getState().saveEditor()}
          />
          <span className="notes-save-state" data-save-state={saveState} aria-live="polite">
            {saveState === "saving"
              ? t("Saving…")
              : saveState === "saved"
                ? t("Saved")
                : saveState === "dirty"
                  ? t("Unsaved changes")
                  : ""}
          </span>
          <ToolbarButton
            label={deleteArmed ? t("Confirm delete") : t("Delete")}
            icon={ICONS.trash}
            className={`notes-delete${deleteArmed ? " notes-delete-armed" : ""}`}
            variant="ui-button--danger"
            onClick={armedDelete}
          />
        </div>
      </div>
      {error ? (
        <div className="notes-error-banner" role="alert">
          {(error as Error & { code?: string }).code === "version_conflict"
            ? t("This note changed elsewhere. Reload it before editing again.")
            : error.message}
        </div>
      ) : null}
      <div className="notes-title-row">
        <div className="notes-icon-box">
          <EmojiPicker
            onPick={(emoji) => setDraft({ icon: emoji })}
            label={t("Choose an icon")}
            trigger={
              <input
                className="notes-icon-input"
                value={draftIcon}
                placeholder={DEFAULT_NOTE_ICON}
                maxLength={8}
                aria-label={t("Icon")}
                title={t("Choose an icon")}
                onChange={(event) => setDraft({ icon: event.target.value })}
              />
            }
          />
        </div>
        <input
          className="notes-title-input"
          value={draftTitle}
          placeholder={t("Note title")}
          aria-label={t("Note title")}
          onChange={(event) => setDraft({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !preview) {
              contentRef.current?.focus();
            }
          }}
        />
      </div>
      <TagEditor
        store={store}
        tags={draftTags}
        onChange={(tags) => setDraft({ tags })}
      />
      {note.source?.url ? (
        <p className="notes-source">
          {t("Source")}:{" "}
          <a href={note.source.url} target="_blank" rel="noreferrer">
            {note.source.url}
          </a>
        </p>
      ) : null}
      {preview ? (
        <div className="notes-preview-wrap">
          <article
            ref={previewRef}
            className="notes-preview markdown-body"
            onMouseUp={() => {
              currentSelectionRef.current = selection();
            }}
            onKeyUp={() => {
              currentSelectionRef.current = selection();
            }}
          />
          {outline.length > 0 ? (
            <nav className="notes-outline" aria-label={t("Outline")}>
              <h2>{t("Outline")}</h2>
              <ol>
                {outline.map((entry) => (
                  <li
                    key={entry.id}
                    className={`notes-outline-level-${entry.level}${
                      entry.id === activeOutlineId ? " active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      aria-current={entry.id === activeOutlineId ? "location" : undefined}
                      onClick={() =>
                        document
                          .getElementById(entry.id)
                          ?.scrollIntoView?.({ behavior: "smooth", block: "start" })
                      }
                    >
                      {entry.text}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
        </div>
      ) : (
        <textarea
          ref={contentRef}
          className="notes-content-input"
          value={draftContent}
          placeholder={t("Write Markdown…")}
          aria-label={t("Note content")}
          onChange={(event) => setDraft({ content: event.target.value })}
          onSelect={() => {
            currentSelectionRef.current = selection();
          }}
          onKeyUp={() => {
            currentSelectionRef.current = selection();
          }}
          onMouseUp={() => {
            currentSelectionRef.current = selection();
          }}
        ></textarea>
      )}
    </section>
  );
}

function ToolbarButton({
  label,
  icon,
  className,
  variant,
  disabled,
  ariaPressed,
  onClick,
}: {
  label: string;
  icon: string;
  className: string;
  variant: string;
  disabled?: boolean;
  ariaPressed?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`ui-button ${variant} ${className}`.trim()}
      disabled={disabled}
      aria-pressed={ariaPressed}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon svg={icon} />
      <span className="notes-btn-label">{label}</span>
    </button>
  );
}

function rewriteAttachmentUrls(container: HTMLElement, store: NotesStore) {
  const note = store.getState().selectedNote;
  if (!note) return;
  const prefix = `/attachments/${note.id}/`;
  for (const target of Array.from(container.querySelectorAll("[src], [href]"))) {
    const attribute = target.hasAttribute("src") ? "src" : "href";
    const value = target.getAttribute(attribute);
    if (!value?.startsWith(prefix)) continue;
    const attachmentId = value.slice(prefix.length);
    if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|pdf|txt|md|csv|json)$/.test(attachmentId)) continue;
    const url = store.getState().attachmentUrl(note, attachmentId);
    if (attribute === "href") {
      target.setAttribute("href", url);
      target.setAttribute("target", "_blank");
      target.setAttribute("rel", "noreferrer");
    } else {
      target.setAttribute("src", url);
      target.addEventListener("error", () => {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.className = "notes-attachment-fallback";
        link.textContent = target.getAttribute("alt") || "Open attachment";
        target.replaceWith(link);
      });
    }
  }
}
