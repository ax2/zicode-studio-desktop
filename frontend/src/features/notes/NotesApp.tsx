import { cloneElement, useEffect, useId, useRef, useState } from "react";
// @ts-expect-error plain JS module without type declarations (public/ui/markdown.js)
import { initCodeCopyDelegation, renderMarkdown } from "../../../../public/ui/markdown.js";
// @ts-expect-error plain JS module without type declarations (public/ui/image-lightbox.js)
import { initImageLightbox } from "../../../../public/ui/image-lightbox.js";
// @ts-expect-error plain JS module without type declarations (public/ui/attachment-viewer.js)
import { attachmentIconFor, initAttachmentViewer } from "../../../../public/ui/attachment-viewer.js";
import { t } from "../../shared/i18n";
import {
  csvToMarkdownTable,
  insertMarkdownLinePrefix,
  insertMarkdownLink,
  insertMarkdownTable,
  replaceSelection,
  wrapMarkdownCodeBlock,
  wrapMarkdownSelection,
  type MarkdownEdit,
} from "../../shared/markdownFormatting";
import { isImeComposing } from "../../shared/ime";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
import { Select } from "../../shared/Select";
import {
  allTagSuggestions,
  buildChildrenByParent,
  buildHeadingOutline,
  DEFAULT_NOTEBOOK_ICON,
  DEFAULT_NOTE_ICON,
  EMOJI_GROUPS,
  estimateReadingMinutes,
  findActiveOutlineId,
  formatDate,
  formatRelativeTime,
  ICONS,
  stripMarkdown,
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

function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    setIsNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isNarrow;
}

function isTreeItemVisible(item: HTMLElement): boolean {
  if (item.classList.contains("notes-notebook-summary")) {
    const ownBranch = item.closest(".notes-notebook-branch");
    const ancestorBranch = ownBranch?.parentElement?.closest(
      "details.notes-notebook-branch",
    );
    return !(ancestorBranch instanceof HTMLDetailsElement) || ancestorBranch.open;
  }
  const branch = item.closest("details.notes-notebook-branch");
  return !(branch instanceof HTMLDetailsElement) || branch.open;
}

export function NotesNav({ store }: { store: NotesStore }) {
  const query = store((state) => state.query);
  const sortMode = store((state) => state.sortMode);
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
  const handleNavKeydown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.matches(".notes-notebook-summary") &&
      (event.key === "ArrowRight" || event.key === "ArrowLeft")
    ) {
      const branch = target.closest(".notes-notebook-branch");
      const notebookId = (branch as HTMLElement | null)?.dataset.notebookId;
      if (branch && notebookId) {
        event.preventDefault();
        store
          .getState()
          .toggleNotebookExpanded(notebookId, event.key === "ArrowRight");
      }
      return;
    }
    if (
      (event.key === "Home" || event.key === "End") &&
      target.matches(".notes-notebook-summary, .notes-tree-note")
    ) {
      event.preventDefault();
      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          ".notes-notebook-summary, .notes-tree-note",
        ),
      ).filter(isTreeItemVisible);
      if (items.length === 0) return;
      (event.key === "Home" ? items[0] : items[items.length - 1])?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!target.matches(".notes-notebook-summary, .notes-tree-note")) return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        ".notes-notebook-summary, .notes-tree-note",
      ),
    ).filter(isTreeItemVisible);
    const index = items.indexOf(target);
    if (index === -1) return;
    const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow-key navigation container for the tree; items remain individually keyboard-activatable
    <div className="notes-nav" onKeyDown={handleNavKeydown}>
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
      <div className="notes-search-wrap">
        <input
          type="search"
          enterKeyHint="search"
          className="notes-search-input"
          placeholder={t("Search notes")}
          aria-label={t("Search notes")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="notes-search-clear"
            aria-label={t("Clear search")}
            title={t("Clear search")}
            onClick={() => setQuery("")}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="notes-sort-wrap">
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm notes-sort-btn"
          aria-pressed={sortMode === "title"}
          title={t("Sort notes")}
          onClick={() =>
            store
              .getState()
              .setSortMode(sortMode === "updated" ? "title" : "updated")
          }
        >
          {sortMode === "updated" ? t("Sort: recently updated") : t("Sort: title")}
        </button>
      </div>
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
        aria-pressed={!selectedNotebookId && !sourceOnly && !selectedTag}
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
  const editingNotebookId = store((state) => state.editingNotebookId);
  const dragTargetId = store((state) => state.dragTargetId);
  const sortMode = store((state) => state.sortMode);
  const notes = snapshot.notes
    .filter((note) => note.notebookId === notebook.id)
    .sort((left, right) =>
      sortMode === "title"
        ? left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
        : String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    );
  const children = childrenByParent.get(notebook.id) ?? [];
  const expanded = store((state) =>
    state.expandedNotebookIds.has(notebook.id) ||
    (Boolean(query || selectedTag || sourceOnly) && (notes.length > 0 || children.length > 0)),
  );
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
        <span className="notes-notebook-title" title={notebook.title}>
          {notebook.title}
        </span>
        <small title={`${notebook.noteCount ?? notes.length} ${t("notes")}`}>
          {String(notebook.noteCount ?? notes.length)}
        </small>
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
        label={t("New sub-notebook")}
        icon={ICONS.folderPlus}
        className="notes-notebook-new-sub"
        onClick={() => void store.getState().startNewNotebook(notebook.id)}
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
  const [parentId, setParentId] = useState(notebook.parentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const snapshot = store((state) => state.snapshot);
  const loading = store((state) => state.loading);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const childrenByParent = buildChildrenByParent(snapshot.notebooks);
  const descendants = new Set<string>();
  const collectDescendants = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      descendants.add(child.id);
      collectDescendants(child.id);
    }
  };
  collectDescendants(notebook.id);
  const parentOptions = [
    { value: "", label: t("Top level") },
    ...snapshot.notebooks
      .filter((candidate) => candidate.id !== notebook.id && !descendants.has(candidate.id))
      .map((candidate) => ({ value: candidate.id, label: candidate.title })),
  ];
  return (
    <form
      className="notes-notebook-edit-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          await store.getState().updateNotebook(
            notebook.id,
            title,
            icon,
            parentId || null,
          );
        } catch (updateError) {
          setError(updateError instanceof Error ? updateError.message : String(updateError));
        }
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
      <div className="notes-field">
        <span>{t("Parent notebook")}</span>
        <Select
          id="notes-edit-parent-notebook"
          value={parentId}
          label={t("Parent notebook")}
          options={parentOptions}
          onChange={setParentId}
        />
      </div>
      {error ? <p className="notes-form-error">{error}</p> : null}
      <div className="notes-form-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => store.getState().setEditingNotebook(null)}
        >
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={loading}
          aria-busy={loading}
        >
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
  trigger: React.ReactElement<{
    onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
    "aria-haspopup"?: string;
    "aria-expanded"?: boolean;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const restoringFocusRef = useRef(false);
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
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const picker = containerRef.current;
      if (!picker) return;
      const focusables = Array.from(
        picker.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !picker.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !picker.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      restoringFocusRef.current = true;
      triggerRef.current?.focus();
      window.setTimeout(() => {
        restoringFocusRef.current = false;
      }, 0);
    };
  }, [open]);
  const emojis = EMOJI_GROUPS[category]?.[1] ?? [];
  useEffect(() => {
    if (!open) return;
    gridRef.current
      ?.querySelectorAll<HTMLButtonElement>(".notes-emoji-cell")[activeIndex]
      ?.focus();
  }, [open, activeIndex]);
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (emojis.length === 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % emojis.length);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + emojis.length) % emojis.length);
    }
  };
  return (
    <>
      {cloneElement(trigger, {
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
          triggerRef.current = event.currentTarget;
          if (!restoringFocusRef.current) setOpen(true);
        },
        onClick: (event: React.MouseEvent<HTMLElement>) => {
          triggerRef.current = event.currentTarget;
          setOpen(true);
        },
      })}
      {open ? (
        <div ref={containerRef} className="notes-emoji-picker" role="dialog" aria-label={label}>
          <div className="notes-emoji-tabs">
            {EMOJI_GROUPS.map(([name], index) => (
              <button
                key={name}
                type="button"
                className={`notes-emoji-tab${index === category ? " active" : ""}`}
                onClick={() => {
                  setCategory(index);
                  setActiveIndex(0);
                  requestAnimationFrame(() => {
                    gridRef.current
                      ?.querySelector<HTMLButtonElement>(".notes-emoji-cell")
                      ?.focus();
                  });
                }}
              >
                {t(name)}
              </button>
            ))}
          </div>
          <div
            ref={gridRef}
            className="notes-emoji-grid"
            role="listbox"
            aria-label={label}
            onKeyDown={onGridKeyDown}
          >
            {emojis.map((emoji, index) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`notes-emoji-cell${index === activeIndex ? " active" : ""}`}
                tabIndex={index === activeIndex ? 0 : -1}
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
  const pinnedNotes = store((state) => state.pinnedNotes);
  const pinnedIds = new Set(store((state) => state.pinnedNoteIds));
  const recentNotPinned = recentNotes.filter((note) => !pinnedIds.has(note.id));
  return (
    <NavSection title={t("Quick access")} store={store}>
      {pinnedNotes.map((note) => (
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
          <span className="notes-nav-pin-mark" aria-hidden="true">
            📌
          </span>
        </button>
      ))}
      {recentNotPinned.length > 0 ? (
        <>
          {recentNotPinned.map((note) => (
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
        aria-pressed={sourceOnly}
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
          aria-pressed={selectedTag === tag}
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

function PinButton({ store, note }: { store: NotesStore; note: NoteSummary }) {
  const pinned = store((state) => state.pinnedNoteIds.includes(note.id));
  return (
    <button
      type="button"
      className={`notes-pin-btn${pinned ? " is-pinned" : ""}`}
      title={pinned ? t("Unpin from quick access") : t("Pin to quick access")}
      aria-label={pinned ? t("Unpin from quick access") : t("Pin to quick access")}
      aria-pressed={pinned}
      onClick={(event) => {
        event.stopPropagation();
        store.getState().togglePinned(note.id);
      }}
    >
      <Icon svg={ICONS.pin} />
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
      aria-pressed={selectMode ? isSelected : undefined}
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
        if ((event.target as HTMLElement).closest?.(".notes-move-btn, .notes-pin-btn"))
          return;
        beginPointerDrag(event);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement;
        if (target.closest?.("button")) return;
        event.preventDefault();
        if (selectMode) {
          store.getState().toggleNoteSelected(note.id);
        } else {
          void selectNote(note);
        }
      }}
    >
      {selectMode ? (
        <span className={`notes-select-check${isSelected ? " checked" : ""}`} aria-hidden="true">
          {isSelected ? "✓" : ""}
        </span>
      ) : null}
      <span className="notes-note-icon">{note.icon || DEFAULT_NOTE_ICON}</span>
      <span className="notes-list-item-main">
        <strong title={note.title}>
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
      <PinButton store={store} note={note} />
      <button
        type="button"
        className="notes-move-btn"
        title={t("Move to notebook")}
        aria-label={t("Move to notebook")}
        onClick={(event) => {
          event.stopPropagation();
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const popoverWidth = Math.min(280, window.innerWidth - 16);
          const left = Math.max(
            8,
            Math.min(rect.left, window.innerWidth - popoverWidth - 8),
          );
          setPopoverPos({ top: Math.round(rect.bottom + 4), left: Math.round(left) });
          openMovePopover(note);
        }}
      >
        ⇄
      </button>
      {popoverPos ? <MovePopover store={store} note={note} pos={popoverPos} onClose={() => setPopoverPos(null)} /> : null}
    </div>
  );
}

export function buildDragGhost(note: NoteSummary): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "notes-drag-ghost";
  const icon = document.createElement("span");
  icon.className = "notes-note-icon";
  icon.textContent = note.icon || DEFAULT_NOTE_ICON;
  ghost.append(icon);
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

export function dropTargetIdAt(x: number, y: number): string | null {
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
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    ref.current
      ?.querySelector<HTMLButtonElement>(".notes-move-popover-item")
      ?.focus();
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
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !ref.current?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !ref.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
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
  const query = store((state) => state.query);
  const snapshot = store((state) => state.snapshot);

  if (loading && !selectedNote) {
    return <StateCard text={t("Loading notes…")} />;
  }
  if (mode === "new-notebook") return <NotebookForm store={store} />;
  if (mode === "capture") return <CaptureForm store={store} />;
  if (mode === "trash") return <TrashView store={store} />;
  if (selectedNote) return <NoteEditor store={store} />;
  if ((selectedTag || sourceOnly || query.trim()) && snapshot.notes.length > 0) {
    return <FilterResultsView store={store} />;
  }
  if (query.trim() && snapshot.notes.length === 0) {
    return (
      <Panel title={t("Search results")} description={t("No notes match your search.")}>
        <div className="notes-empty-actions">
          <button type="button" className="ui-button ui-button--ghost" onClick={() => store.getState().setQuery("")}>
            {t("Show all notes")}
          </button>
        </div>
      </Panel>
    );
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
  const [parentId, setParentId] = useState(store.getState().newNotebookParentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const snapshot = store((state) => state.snapshot);
  const loading = store((state) => state.loading);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <Panel title={t("Create notebook")} description={t("Each notebook is a readable Astro-compatible Markdown vault.")}>
      <form
        className="notes-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            await store.getState().createNotebook(title, icon, parentId || null);
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : String(createError));
          }
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
        <div className="notes-form-field">
          <span>{t("Parent notebook")}</span>
          <Select
            id="notes-parent-notebook"
            value={parentId}
            label={t("Parent notebook")}
            options={[
              { value: "", label: t("Top level") },
              ...snapshot.notebooks.map((candidate) => ({
                value: candidate.id,
                label: candidate.title,
              })),
            ]}
            onChange={setParentId}
          />
        </div>
        {error ? <p className="notes-form-error">{error}</p> : null}
        <div className="notes-form-actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={() => store.getState().setMode("library")}>
            {t("Cancel")}
          </button>
          <button type="submit" className="ui-button ui-button--primary" disabled={loading} aria-busy={loading}>
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
  const [preview, setPreview] = useState<{
    title: string;
    markdown: string;
    finalUrl: string;
    author?: string;
    publishedAt?: string;
    siteName?: string;
    image?: string;
    duplicate: boolean;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const snapshot = store((state) => state.snapshot);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const capturing = store((state) => state.capturing);
  const summarizing = store((state) => state.summarizing);
  const summary = store((state) => state.summary);
  const urlRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    urlRef.current?.focus();
  }, []);
  const previewUrl = async () => {
    setError(null);
    setPreviewing(true);
    try {
      setPreview(await store.getState().capturePreviewUrl(url));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : String(previewError),
      );
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };
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
          <input ref={urlRef} className="notes-field-input" type="url" required autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://example.com/article" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label>
          <span>{t("Title override (optional)")}</span>
          <input className="notes-field-input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <TagEditor store={store} tags={tags} onChange={setTags} />
        <div className="notes-form-field">
          <span>{t("Notebook")}</span>
          <Select
            id="notes-capture-notebook"
            value={notebookId || selectedNotebookId || ""}
            label={t("Notebook")}
            options={snapshot.notebooks.map((candidate) => ({
              value: candidate.id,
              label: candidate.title,
            }))}
            onChange={setNotebookId}
          />
        </div>
        {preview ? (
          <section className="notes-capture-preview" aria-label={t("Capture preview")}>
            <h2>{t("Extracted content")}</h2>
            {preview.duplicate ? (
              <p className="notes-capture-preview-note" role="status">
                {t("This page is already in your notes")}
              </p>
            ) : null}
            <strong>{preview.title}</strong>
            {[preview.siteName, preview.author].filter(Boolean).length > 0 ? (
              <p className="notes-capture-preview-meta">
                {[preview.siteName, preview.author].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <p className="notes-capture-preview-stats">
              {t("About {count} readable characters").replace(
                "{count}",
                stripMarkdown(preview.markdown).replace(/\s+/g, "").length.toLocaleString(),
              )}
            </p>
            {previewExpanded ? (
              <pre className="notes-capture-preview-full">
                {stripMarkdown(preview.markdown)}
              </pre>
            ) : (
              <p className="notes-capture-preview-excerpt">
                {stripMarkdown(preview.markdown).slice(0, 320)}
              </p>
            )}
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm notes-capture-expand"
              onClick={() => setPreviewExpanded((expanded) => !expanded)}
            >
              {previewExpanded ? t("Collapse") : t("Show full content")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm notes-capture-copy"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(preview.markdown)
                  .then(() => {
                    setCopiedPreview(true);
                    window.setTimeout(() => setCopiedPreview(false), 1600);
                  })
                  .catch(() => {});
              }}
            >
              {copiedPreview ? t("Copied") : t("Copy Markdown")}
            </button>
            {summary ? (
              <section className="notes-capture-summary" aria-label={t("Pi summary")}>
                <h3>{t("Pi summary")}</h3>
                <pre>{summary}</pre>
                <button
                  type="button"
                  className="ui-button ui-button--ghost ui-button--sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(summary)
                      .then(() => {
                        setCopiedSummary(true);
                        window.setTimeout(() => setCopiedSummary(false), 1600);
                      })
                      .catch(() => {});
                  }}
                >
                  {copiedSummary ? t("Copied") : t("Copy summary")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--ghost ui-button--sm"
                  onClick={() => store.getState().clearSummary()}
                >
                  {t("Dismiss")}
                </button>
              </section>
            ) : (
              <button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm notes-capture-summarize"
                disabled={summarizing}
                aria-busy={summarizing}
                onClick={() => {
                  setError(null);
                  void store
                    .getState()
                    .summarizeText(stripMarkdown(preview.markdown), preview.title)
                    .catch((summarizeError) =>
                      setError(
                        summarizeError instanceof Error
                          ? summarizeError.message
                          : String(summarizeError),
                      ),
                    );
                }}
              >
                {summarizing ? t("Summarizing…") : t("Summarize with Pi")}
              </button>
            )}
          </section>
        ) : null}
        {error ? <p className="notes-form-error">{error}</p> : null}
        <div className="notes-form-actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={() => store.getState().setMode("library")}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={previewing || !url.trim()}
            aria-busy={previewing}
            onClick={() => void previewUrl()}
          >
            {previewing ? t("Fetching preview…") : t("Preview")}
          </button>
          <button type="submit" className="ui-button ui-button--primary" disabled={capturing} aria-busy={capturing}>
            {capturing ? t("Capturing…") : t("Capture")}
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
  const suggestionsId = useId();
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
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
  const visiblePool = pool.slice(0, 16);
  const addTag = (value: string) => {
    const name = String(value).trim().replace(/^#/, "");
    if (!name || tags.includes(name)) return;
    onChange([...tags, name]);
    setInput("");
    setShowSuggestions(false);
    setActiveIndex(-1);
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
      {tags.length > 0 ? (
        <button
          type="button"
          className="notes-tag-clear-all"
          title={t("Clear all")}
          aria-label={t("Clear all")}
          onClick={() => onChange([])}
        >
          {t("Clear all")}
        </button>
      ) : null}
      <input
        ref={inputRef}
        className="notes-tag-input"
        placeholder={t("Add tag")}
        aria-label={t("Add tag")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showSuggestions && pool.length > 0}
        aria-controls={suggestionsId}
        aria-activedescendant={
          activeIndex >= 0 ? `${suggestionsId}-option-${activeIndex}` : undefined
        }
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={input}
        onFocus={() => setShowSuggestions(true)}
        onChange={(event) => {
          setInput(event.target.value);
          setActiveIndex(-1);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event, composingRef.current)) return;
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            if (activeIndex >= 0 && visiblePool[activeIndex]) {
              addTag(visiblePool[activeIndex]);
            } else if (input.trim()) {
              addTag(input);
            }
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (visiblePool.length === 0) return;
            setShowSuggestions(true);
            setActiveIndex((current) => {
              if (current < 0) return event.key === "ArrowDown" ? 0 : visiblePool.length - 1;
              const step = event.key === "ArrowDown" ? 1 : -1;
              return (current + step + visiblePool.length) % visiblePool.length;
            });
          } else if (event.key === "Backspace" && !input && tags.length) {
            onChange(tags.slice(0, -1));
          } else if (event.key === "Escape") {
            setShowSuggestions(false);
            setActiveIndex(-1);
            (event.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          // Commit the typed tag synchronously so a concurrent action (such as
          // clicking Save) sees it; otherwise the delayed commit would land
          // after the save and lose the tag.
          if (input.trim()) {
            addTag(input);
          } else {
            window.setTimeout(() => setShowSuggestions(false), 120);
          }
        }}
      />
      {showSuggestions && pool.length > 0 ? (
        <div id={suggestionsId} className="notes-tag-suggestions" role="listbox" aria-label={t("Add tag")}>
          {visiblePool.map((name, index) => (
            <button
              key={name}
              type="button"
              className="notes-tag-suggestion"
              role="option"
              id={`${suggestionsId}-option-${index}`}
              aria-selected={index === activeIndex}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                addTag(name);
                inputRef.current?.focus();
              }}
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
  const sourceOnly = store((state) => state.sourceOnly);
  const query = store((state) => state.query);
  const applyFilter = store((state) => state.applyFilter);
  const selectNote = store((state) => state.selectNote);
  const notebookNameById = new Map(
    snapshot.notebooks.map((notebook) => [notebook.id, notebook.title]),
  );
  const title = selectedTag
    ? `${t("Tag")} #${selectedTag}`
    : sourceOnly
      ? t("Web clips")
      : t("Search results");
  return (
    <section className="notes-results">
      <h1 className="notes-results-title">
        {title}
      </h1>
      <div className="notes-results-meta">
        <span aria-live="polite">
          {snapshot.notes.length} {t("notes")}
        </span>
        <button
          type="button"
          className="ui-button ui-button--ghost"
          onClick={() => void applyFilter({})}
        >
          {t("Show all notes")}
        </button>
      </div>
      {snapshot.notes.length === 0 ? (
        <p className="notes-results-empty">
          {selectedTag
            ? t("No notes match this tag yet.")
            : sourceOnly
              ? t("No web clips yet. Capture a public page to collect it here.")
              : t("No notes match your search.")}
        </p>
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow-key navigation container for the results list; items remain individually keyboard-activatable */}
      <div
        className="notes-results-list"
        onKeyDown={(event) => {
          if (!(event.target as HTMLElement).matches(".notes-result-item")) return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(".notes-result-item"),
          );
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            if (items.length === 0) return;
            (event.key === "Home" ? items[0] : items[items.length - 1])?.focus();
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const index = items.indexOf(event.target as HTMLElement);
          if (index === -1) return;
          items[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
        }}
      >
        {snapshot.notes.map((note) => (
          // biome-ignore lint/a11y/useSemanticElements: ARIA button pattern preserved from the vanilla results list
          <div
            key={note.id}
            role="button"
            tabIndex={0}
            className="notes-result-item"
            onClick={() => void selectNote(note)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              if ((event.target as HTMLElement).closest?.("button")) return;
              event.preventDefault();
              void selectNote(note);
            }}
          >
            {note.icon ? <span className="notes-result-icon">{note.icon}</span> : null}
            <span className="notes-result-main">
              <strong>
                <HighlightedText text={note.title} query={query} />
              </strong>
              {notebookNameById.get(note.notebookId) ? (
                <span className="notes-result-notebook">
                  {notebookNameById.get(note.notebookId)}
                </span>
              ) : null}
              {note.snippet ? (
                <span className="notes-result-snippet">
                  <HighlightedText text={stripMarkdown(note.snippet)} query={query} />
                </span>
              ) : null}
              {note.tags && note.tags.length > 0 ? (
                <span className="notes-result-tags">
                  {note.tags.map((tag) => (
                    <span key={tag} className="notes-result-tag">
                      {tagIcon(tag)} {tag}
                    </span>
                  ))}
                </span>
              ) : null}
              <span>{formatDate(note.updatedAt)}</span>
            </span>
            <PinButton store={store} note={note} />
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
    <>
      <FirstRunGuide
        storageKey="notes"
        title={t("Your local Markdown library")}
        steps={[
          t("Create a notebook, then write or capture notes."),
          t("Organize with tags and folders, or drag notes between notebooks."),
          t("Bring notes into a conversation, export, or publish them."),
        ]}
        ctaLabel={t("Start writing")}
        onCta={() => {
          if (snapshot.notebooks.length) void newNote();
          else setMode("new-notebook");
        }}
      />
    <section className="notes-state-panel notes-empty-library ui-card">
      <div className="notes-empty-hero">
        <span className="notes-empty-hero-icon" aria-hidden="true">
          {snapshot.notebooks.length ? "📓" : "🗂️"}
        </span>
        <h1>{snapshot.notebooks.length ? t("No note selected") : t("Your local Notes library")}</h1>
        <p>
          {snapshot.notebooks.length
            ? t("Choose a note from the function area or create a new one.")
            : t(
                "Create a notebook to start your local-first Markdown library: write notes, capture web pages, organize with tags, bring notes into a conversation, or publish them as a blog.",
              )}
        </p>
        <div className="notes-empty-actions">
          {snapshot.notebooks.length ? (
            <>
              <button
                type="button"
                className="ui-button ui-button--primary"
                title={`${t("New note")} (Ctrl+N)`}
                onClick={() => void newNote()}
              >
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
      {!snapshot.notebooks.length ? (
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
      ) : null}
    </section>
    </>
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
          <span className="notes-error-inline">
            {trashError}
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() => void store.getState().loadTrash()}
            >
              {t("Retry")}
            </button>
          </span>
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

function backlinkKindLabel(kind: string): string {
  if (kind === "wikilink") return t("Wiki link");
  if (kind === "reference") return t("Note reference");
  return kind;
}

export function wikilinkMarkdown(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    if (inFence) {
      result.push(line);
      continue;
    }
    result.push(
      line.replace(/(`[^`\n]*`|\[\[[^\]\n]+\]\])/g, (match) => {
        if (match.startsWith("`")) return match;
        const label = match.slice(2, -2).trim();
        return `[${label}](zicode-note://${encodeURIComponent(label)})`;
      }),
    );
  }
  return result.join("\n");
}

export function markUnresolvedWikilinks(root: HTMLElement, notes: NoteSummary[]): void {
  const titles = new Set(notes.map((note) => note.title.toLowerCase()));
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    'a[href^="zicode-note://"]',
  )) {
    const raw = anchor.getAttribute("href")?.replace("zicode-note://", "") ?? "";
    const title = decodeURIComponent(raw).toLowerCase();
    if (!titles.has(title)) {
      anchor.classList.add("notes-wikilink-unresolved");
      anchor.title = t("This note does not exist yet");
    }
  }
}

function NoteEditor({ store }: { store: NotesStore }) {
  const note = store((state) => state.selectedNote) as Note;
  const draftTitle = store((state) => state.draftTitle);
  const draftIcon = store((state) => state.draftIcon);
  const draftContent = store((state) => state.draftContent);
  const draftTags = store((state) => state.draftTags);
  const backlinks = store((state) => state.backlinks);
  const similarNotes = store((state) => state.similarNotes);
  const snapshotNotes = store((state) => state.snapshot.notes);
  const preview = store((state) => state.preview);
  const dirty = store((state) => state.dirty);
  const saveDisabled = store((state) => state.saveDisabled);
  const saveState = store((state) => state.saveState);
  const deleteArmed = store((state) => state.deleteArmed);
  const error = store((state) => state.error);
  const setDraft = store((state) => state.setDraft);
  const setPreview = store((state) => state.setPreview);
  const openNote = store((state) => state.openNote);
  const setDeleteArmed = store((state) => state.setDeleteArmed);
  const resetDeleteArmed = store((state) => state.resetDeleteArmed);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const outlineListRef = useRef<HTMLOListElement | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  const [copySourceError, setCopySourceError] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [activeLinkIndex, setActiveLinkIndex] = useState(0);
  const isNarrow = useIsNarrowViewport();
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!moreOpen) return;
    moreMenuRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const onMoreButton =
        target instanceof Element && !!target.closest(".notes-more-btn");
      if (!moreMenuRef.current?.contains(target) && !onMoreButton) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const menu = moreMenuRef.current;
      if (!menu) return;
      const focusables = Array.from(
        menu.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !menu.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !menu.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      moreButtonRef.current?.focus();
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!isNarrow) setMoreOpen(false);
  }, [isNarrow]);

  useEffect(() => {
    return () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    const flushAutosave = () => {
      void store.getState().saveIfDirty();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    window.addEventListener("blur", flushAutosave);
    window.addEventListener("pagehide", flushAutosave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", flushAutosave);
      window.removeEventListener("pagehide", flushAutosave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [store]);

  useEffect(() => {
    if (preview && previewRef.current) {
      previewRef.current.innerHTML = renderMarkdown(wikilinkMarkdown(draftContent));
      rewriteAttachmentUrls(previewRef.current, store);
      initImageLightbox(previewRef.current);
      initAttachmentViewer(previewRef.current);
      initCodeCopyDelegation(previewRef.current);
      markUnresolvedWikilinks(previewRef.current, snapshotNotes);
      setOutline(buildHeadingOutline(previewRef.current));
    }
  }, [preview, draftContent, store, snapshotNotes]);

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
    if (!activeOutlineId) return;
    const list = outlineListRef.current;
    if (!list) return;
    // Only follow the active heading inside an independently scrollable
    // outline panel (the desktop sticky sidebar). On narrow layouts the
    // outline is a static block below the article, so scrolling it into
    // view on open would yank the reader away from the note toolbar and
    // content (the toolbar ends up tucked under the session header).
    const listStyle = getComputedStyle(list);
    const independentlyScrollable =
      list.scrollHeight > list.clientHeight + 1 &&
      (listStyle.overflowY === "auto" || listStyle.overflowY === "scroll");
    if (!independentlyScrollable) return;
    const item = Array.from(
      list.querySelectorAll<HTMLElement>("li[data-outline-id]"),
    ).find(
      (entry) => entry.getAttribute("data-outline-id") === activeOutlineId,
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [activeOutlineId]);

  useEffect(() => {
    if (store.getState().focusTitleOnNextRender) {
      store.setState({ focusTitleOnNextRender: false });
      const title = titleRef.current;
      if (title) {
        title.focus();
        title.select();
      }
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
  const [hasSelection, setHasSelection] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection's only state dependency is preview, which is listed; the function is recreated each render so the captured copy is current.
  useEffect(() => {
    const sync = () => {
      const value = selection();
      currentSelectionRef.current = value;
      setHasSelection(Boolean(value));
    };
    sync();
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, [preview]);

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

  const linkSuggestions = linkOpen
    ? snapshotNotes
        .filter((candidate) => candidate.id !== note.id)
        .filter((candidate) => {
          const needle = linkQuery.trim().toLowerCase();
          return !needle || candidate.title.toLowerCase().includes(needle);
        })
        .sort((left, right) => left.title.localeCompare(right.title))
        .slice(0, 8)
    : [];

  const detectLink = (value: string, cursor: number) => {
    const match = value.slice(0, cursor).match(/\[\[([^\]\n]*)$/);
    if (match) {
      setLinkQuery(match[1]);
      setLinkOpen(true);
      setActiveLinkIndex(0);
    } else {
      setLinkQuery("");
      setLinkOpen(false);
      setActiveLinkIndex(0);
    }
  };

  const insertLink = (title: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? 0;
    const match = draftContent.slice(0, cursor).match(/\[\[([^\]\n]*)$/);
    if (!match) return;
    const start = cursor - match[0].length;
    const next = `${draftContent.slice(0, start)}[[${title}]]${draftContent.slice(cursor)}`;
    setDraft({ content: next });
    setLinkQuery("");
    setLinkOpen(false);
    setActiveLinkIndex(0);
    const cursorAfter = start + title.length + 4;
    window.requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursorAfter, cursorAfter);
    });
  };

  const applyMarkdownEdit = (edit: MarkdownEdit) => {
    setDraft({ content: edit.next });
    window.requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      const selection = edit.selection ?? { start: edit.cursor, end: edit.cursor };
      el.setSelectionRange(selection.start, selection.end);
    });
  };

  const wrapSelection = (wrapper: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      wrapMarkdownSelection(
        draftContent,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
        wrapper,
      ),
    );
  };

  const wrapCodeBlock = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      wrapMarkdownCodeBlock(
        draftContent,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      ),
    );
  };

  const insertPrefix = (prefix: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      insertMarkdownLinePrefix(draftContent, textarea.selectionStart ?? 0, prefix),
    );
  };

  const insertTable = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      insertMarkdownTable(
        draftContent,
        textarea.selectionStart ?? 0,
        [t("Column 1"), t("Column 2")],
      ),
    );
  };

  const insertLinkMarkdown = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      insertMarkdownLink(
        draftContent,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      ),
    );
  };

  const csvToTable = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = draftContent.slice(start, end);
    if (!selected.trim()) {
      applyMarkdownEdit(
        insertMarkdownTable(draftContent, start, [t("Column 1"), t("Column 2")]),
      );
      return;
    }
    const table = csvToMarkdownTable(selected);
    applyMarkdownEdit(
      table
        ? replaceSelection(draftContent, start, end, table)
        : insertMarkdownTable(draftContent, start, [t("Column 1"), t("Column 2")]),
    );
  };

  const renderSecondaryActions = (role?: string) => (
    <>
      <ToolbarButton
        label={hasSelection ? t("Discuss selection") : t("Discuss in Chat")}
        icon={ICONS.chat}
        className="notes-use-in-chat"
        variant="ui-button--secondary"
        role={role}
        hint={`Ctrl+Enter · ${t("Selected text or whole note")}`}
        disabled={!draftContent.trim()}
        title={
          !draftContent.trim() ? t("The input is empty or incomplete.") : undefined
        }
        onClick={() => {
          setMoreOpen(false);
          void store.getState().discussInChat(
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
        role={role}
        onClick={() => {
          setMoreOpen(false);
          void store.getState().attachFile();
        }}
      />
      <ToolbarButton
        label={t("Download Markdown")}
        icon={ICONS.download}
        className="notes-download-note"
        variant="ui-button--ghost"
        hint="Ctrl+Shift+D"
        role={role}
        disabled={!draftContent.trim()}
        onClick={() => {
          setMoreOpen(false);
          void store.getState().downloadNote();
        }}
      />
      <ToolbarButton
        label={copiedMarkdown ? t("Copied") : t("Copy Markdown")}
        icon={ICONS.copy}
        className="notes-copy-note"
        variant="ui-button--ghost"
        hint="Ctrl+Shift+C"
        role={role}
        disabled={!draftContent.trim()}
        onClick={() => {
          setMoreOpen(false);
          void store.getState().copyNote();
          setCopiedMarkdown(true);
          if (copyTimer.current) clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCopiedMarkdown(false), 2000);
        }}
      />
      <ToolbarButton
        label={t("Duplicate note")}
        icon={ICONS.duplicate}
        className="notes-duplicate-note"
        variant="ui-button--ghost"
        hint="Ctrl+D"
        role={role}
        disabled={!draftContent.trim()}
        onClick={() => {
          setMoreOpen(false);
          void store.getState().duplicateNote();
        }}
      />
    </>
  );

  const renderDeleteButton = (role?: string) => (
    <ToolbarButton
      label={deleteArmed ? t("Confirm delete") : t("Delete")}
      icon={ICONS.trash}
      className={`notes-delete${deleteArmed ? " notes-delete-armed" : ""}`}
      variant="ui-button--danger"
      role={role}
      onClick={() => {
        if (deleteArmed) setMoreOpen(false);
        armedDelete();
      }}
    />
  );

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
            hint="Ctrl+E"
            onClick={() => setPreview(false)}
          />
          <ToolbarButton
            label={t("Preview")}
            icon={ICONS.preview}
            className="notes-preview-tab"
            variant={preview ? "ui-button--secondary" : "ui-button--ghost"}
            ariaPressed={preview}
            hint="Ctrl+E"
            onClick={() => setPreview(true)}
          />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA group pattern preserved from the vanilla note actions */}
        <div className="notes-editor-actions" role="group" aria-label={t("Note actions")}>
          {isNarrow ? (
            <>
              <ToolbarButton
                label={t("Save")}
                icon={ICONS.save}
                className="notes-save"
                variant="ui-button--primary"
                disabled={saveDisabled || !dirty}
                busy={saveState === "saving"}
                hint="Ctrl+S"
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
              <button
                ref={moreButtonRef}
                type="button"
                className="ui-button ui-button--ghost notes-more-btn"
                aria-label={t("More actions")}
                title={t("More actions")}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-controls="notes-more-menu"
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Icon svg={ICONS.more} />
                <span className="notes-btn-label">{t("More")}</span>
              </button>
            </>
          ) : (
            <>
              {renderSecondaryActions()}
              <ToolbarButton
                label={t("Save")}
                icon={ICONS.save}
                className="notes-save"
                variant="ui-button--primary"
                disabled={saveDisabled || !dirty}
                busy={saveState === "saving"}
                hint="Ctrl+S"
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
              {renderDeleteButton()}
            </>
          )}
        </div>
      </div>
      {isNarrow && moreOpen ? (
        // biome-ignore lint/a11y/useSemanticElements: popover group of action buttons; role=group is the closest generic landmark
        <div
          id="notes-more-menu"
          className="notes-more-menu"
          role="menu"
          aria-label={t("More actions")}
          ref={moreMenuRef}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const items = Array.from(
              moreMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                "button:not([disabled])",
              ) ?? [],
            );
            if (items.length === 0) return;
            event.preventDefault();
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? (current + 1) % items.length
                : (current - 1 + items.length) % items.length;
            items[next]?.focus();
          }}
        >
          {renderSecondaryActions("menuitem")}
          {renderDeleteButton("menuitem")}
        </div>
      ) : null}
      {error ? (
        <div className="notes-error-banner" role="alert">
          {(error as Error & { code?: string }).code === "version_conflict" ? (
            <span className="notes-error-inline">
              {t("This note changed elsewhere. Reload it before editing again.")}
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => void store.getState().selectNote(note)}
              >
                {t("Refresh")}
              </button>
            </span>
          ) : (
            error.message
          )}
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
          ref={titleRef}
          className="notes-title-input"
          value={draftTitle}
          placeholder={t("Note title")}
          aria-label={t("Note title")}
          enterKeyHint="next"
          autoComplete="off"
          autoCapitalize="sentences"
          maxLength={200}
          spellCheck
          onChange={(event) => setDraft({ title: event.target.value })}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (isImeComposing(event, composingRef.current)) return;
            if (event.key === "Enter" && !preview) {
              contentRef.current?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        <PinButton store={store} note={note} />
      </div>
      <p className="notes-editor-stats">
        <span title={t("Character count")}>
          {draftContent.length} {t("characters")}
        </span>
        {estimateReadingMinutes(draftContent) > 0 ? (
          <span title={t("Reading time")}>
            {" · "}≈ {estimateReadingMinutes(draftContent)} {t("min read")}
          </span>
        ) : null}
      </p>
      <TagEditor
        store={store}
        tags={draftTags}
        onChange={(tags) => setDraft({ tags })}
      />
      {note.updatedAt ? (
        <p className="notes-edited-at">
          {t("Last edited")}: {formatRelativeTime(note.updatedAt)}
        </p>
      ) : null}
      {note.source?.url ? (
        <div className="notes-source">
          <p>
            {t("Source")}:{" "}
            <a href={note.source.url} target="_blank" rel="noreferrer">
              {note.source.url}
            </a>
            <button
              type="button"
              className="notes-source-copy"
              aria-label={t("Copy source URL")}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(note.source?.url ?? "")
                  .then(() => {
                    setCopiedSource(true);
                    setCopySourceError(false);
                    window.setTimeout(() => setCopiedSource(false), 1600);
                  })
                  .catch(() => {
                    setCopySourceError(true);
                    window.setTimeout(() => setCopySourceError(false), 1600);
                  });
              }}
            >
              {copiedSource ? t("Copied") : copySourceError ? t("Copy failed") : t("Copy")}
            </button>
          </p>
          {[note.source.siteName, note.source.author].filter(Boolean).length > 0 ? (
            <p className="notes-source-meta">
              {[note.source.siteName, note.source.author].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {note.source.publishedAt ? (
            <p className="notes-source-meta">
              {t("Published")}: {formatDate(note.source.publishedAt)}
            </p>
          ) : null}
          {note.source.capturedAt ? (
            <p className="notes-source-meta">
              {t("Captured")}: {formatDate(note.source.capturedAt)}
            </p>
          ) : null}
        </div>
      ) : null}
      {preview ? (
        <div className="notes-preview-wrap">
          {!draftContent.trim() ? (
            <p className="notes-preview-empty">{t("Nothing to preview yet")}</p>
          ) : null}
          <article
            ref={previewRef}
            className="notes-preview markdown-body"
            onClick={(event) => {
              const target = event.target as Element;
              const anchor = target.closest<HTMLAnchorElement>(
                'a[href^="zicode-note://"]',
              );
              if (!anchor) return;
              event.preventDefault();
              const title = decodeURIComponent(
                anchor.getAttribute("href")?.replace("zicode-note://", "") ?? "",
              );
              const match = snapshotNotes.find(
                (candidate) => candidate.title.toLowerCase() === title.toLowerCase(),
              );
              if (match) void openNote(match.notebookId, match.id);
            }}
            onMouseUp={() => {
              currentSelectionRef.current = selection();
            }}
            onKeyUp={() => {
              currentSelectionRef.current = selection();
            }}
            onTouchEnd={() => {
              currentSelectionRef.current = selection();
            }}
          />
          {outline.length > 0 ? (
            <nav className="notes-outline" aria-label={t("Outline")}>
              <div className="notes-outline-header">
                <h2>{t("Outline")}</h2>
                <button
                  type="button"
                  className="notes-outline-toggle"
                  aria-expanded={!outlineCollapsed}
                  aria-controls="notes-outline-list"
                  title={
                    outlineCollapsed ? t("Expand outline") : t("Collapse outline")
                  }
                  aria-label={
                    outlineCollapsed
                      ? `${t("Expand outline")} (${outline.length})`
                      : `${t("Collapse outline")} (${outline.length})`
                  }
                  onClick={() => setOutlineCollapsed((value) => !value)}
                >
                  <span className="notes-outline-chevron" aria-hidden="true">
                    <svg
                      viewBox="0 0 12 12"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {outlineCollapsed ? (
                        <path d="M4 2l4 4-4 4" />
                      ) : (
                        <path d="M2 4l4 4 4-4" />
                      )}
                    </svg>
                  </span>
                </button>
              </div>
              <ol
                id="notes-outline-list"
                ref={outlineListRef}
                hidden={outlineCollapsed}
                onKeyDown={(event) => {
                    const items = Array.from(
                      outlineListRef.current?.querySelectorAll<HTMLButtonElement>(
                        "button",
                      ) ?? [],
                    );
                    if (items.length === 0) return;
                    if (event.key === "Home") {
                      event.preventDefault();
                      items[0]?.focus();
                      return;
                    }
                    if (event.key === "End") {
                      event.preventDefault();
                      items[items.length - 1]?.focus();
                      return;
                    }
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
                      return;
                    }
                    event.preventDefault();
                    const current = items.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                    const next =
                      event.key === "ArrowDown"
                        ? (current + 1) % items.length
                        : (current - 1 + items.length) % items.length;
                    items[next]?.focus();
                  }}
              >
                {outline.map((entry) => (
                  <li
                    key={entry.id}
                    data-outline-id={entry.id}
                    className={`notes-outline-level-${entry.level}${
                      entry.id === activeOutlineId ? " active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      title={entry.text}
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
        <>
        <div className="notes-format-bar" role="toolbar" aria-label={t("Markdown formatting")}>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Bold (Ctrl+B)")}
            aria-label={t("Bold (Ctrl+B)")}
            onClick={() => wrapSelection("**")}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Italic (Ctrl+I)")}
            aria-label={t("Italic (Ctrl+I)")}
            onClick={() => wrapSelection("*")}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Heading")}
            aria-label={t("Heading")}
            onClick={() => insertPrefix("## ")}
          >
            H
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Inline code")}
            aria-label={t("Inline code")}
            onClick={() => wrapSelection("`")}
          >
            {"<>"}
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Code block (Ctrl+Shift+K)")}
            aria-label={t("Code block (Ctrl+Shift+K)")}
            onClick={wrapCodeBlock}
          >
            {"{ }"}
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Quote")}
            aria-label={t("Quote")}
            onClick={() => insertPrefix("> ")}
          >
            ❝
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Bullet list")}
            aria-label={t("Bullet list")}
            onClick={() => insertPrefix("- ")}
          >
            ••
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Task list")}
            aria-label={t("Task list")}
            onClick={() => insertPrefix("- [ ] ")}
          >
            ☑
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Table")}
            aria-label={t("Table")}
            onClick={insertTable}
          >
            ▦
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Link")}
            aria-label={t("Link")}
            onClick={insertLinkMarkdown}
          >
            🔗
          </button>
          <button
            type="button"
            className="notes-format-btn"
            title={t("Convert CSV selection to table")}
            aria-label={t("Convert CSV selection to table")}
            onClick={csvToTable}
          >
            ⇶
          </button>
        </div>
        <textarea
          ref={contentRef}
          className="notes-content-input"
          value={draftContent}
          placeholder={t("Write Markdown…")}
          aria-label={t("Note content")}
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck
          wrap="soft"
          onChange={(event) => {
            const textarea = event.target as HTMLTextAreaElement;
            setDraft({ content: textarea.value });
            detectLink(textarea.value, textarea.selectionStart ?? 0);
          }}
          onSelect={() => {
            currentSelectionRef.current = selection();
          }}
          onKeyUp={() => {
            currentSelectionRef.current = selection();
          }}
          onMouseUp={() => {
            currentSelectionRef.current = selection();
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setLinkOpen(false);
              setLinkQuery("");
              setActiveLinkIndex(0);
            }, 120);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (isImeComposing(event, composingRef.current)) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
              event.preventDefault();
              wrapSelection("**");
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
              event.preventDefault();
              wrapSelection("*");
            } else if (
              (event.ctrlKey || event.metaKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === "k"
            ) {
              event.preventDefault();
              wrapCodeBlock();
            } else if (event.key === "Escape") {
              event.preventDefault();
              if (linkOpen) {
                setLinkOpen(false);
                setLinkQuery("");
                setActiveLinkIndex(0);
              } else {
                (event.target as HTMLTextAreaElement).blur();
              }
            } else if (linkOpen && linkSuggestions.length > 0 && event.key === "ArrowDown") {
              event.preventDefault();
              setActiveLinkIndex((current) => (current + 1) % linkSuggestions.length);
            } else if (linkOpen && linkSuggestions.length > 0 && event.key === "ArrowUp") {
              event.preventDefault();
              setActiveLinkIndex(
                (current) => (current - 1 + linkSuggestions.length) % linkSuggestions.length,
              );
            } else if (
              linkOpen &&
              linkSuggestions.length > 0 &&
              (event.key === "Tab" || event.key === "Enter")
            ) {
              event.preventDefault();
              insertLink(linkSuggestions[activeLinkIndex]?.title ?? linkSuggestions[0].title);
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !(event.ctrlKey || event.metaKey)
            ) {
              const textarea = event.currentTarget as HTMLTextAreaElement;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              if (start !== end) return;
              const lineStart = draftContent.lastIndexOf("\n", start - 1) + 1;
              const line = draftContent.slice(lineStart, start);
              const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
              if (!listMatch) return;
              const [, indent, marker, content] = listMatch;
              event.preventDefault();
              if (!content) {
                setDraft({
                  content: `${draftContent.slice(0, lineStart)}${draftContent.slice(start)}`,
                });
                window.setTimeout(() => {
                  textarea.selectionStart = textarea.selectionEnd = lineStart;
                }, 0);
                return;
              }
              const numbered = marker.match(/^(\d+)([.)])$/);
              const nextMarker = numbered
                ? `${Number(numbered[1]) + 1}${numbered[2]}`
                : marker;
              const inserted = `\n${indent}${nextMarker} `;
              setDraft({
                content: `${draftContent.slice(0, start)}${inserted}${draftContent.slice(end)}`,
              });
              const cursor = start + inserted.length;
              window.setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = cursor;
              }, 0);
            } else if (event.key === "Tab") {
              event.preventDefault();
              const textarea = event.currentTarget as HTMLTextAreaElement;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              if (start === end) {
                if (event.shiftKey) {
                  const lineStart = draftContent.lastIndexOf("\n", start - 1) + 1;
                  const leading =
                    draftContent
                      .slice(lineStart)
                      .match(/^ {1,2}/)?.[0]?.length ?? 0;
                  if (leading > 0) {
                    setDraft({
                      content: `${draftContent.slice(
                        0,
                        lineStart,
                      )}${draftContent.slice(lineStart + leading)}`,
                    });
                    const cursor = Math.max(lineStart, start - leading);
                    window.setTimeout(() => {
                      textarea.selectionStart = textarea.selectionEnd = cursor;
                    }, 0);
                  }
                } else {
                  setDraft({
                    content: `${draftContent.slice(0, start)}  ${draftContent.slice(start)}`,
                  });
                  const cursor = start + 2;
                  window.setTimeout(() => {
                    textarea.selectionStart = textarea.selectionEnd = cursor;
                  }, 0);
                }
                return;
              }
              const blockStart = draftContent.lastIndexOf("\n", start - 1) + 1;
              const lineEnd = draftContent.indexOf("\n", end);
              const blockEnd = lineEnd === -1 ? draftContent.length : lineEnd;
              const block = draftContent.slice(blockStart, blockEnd);
              const nextBlock = event.shiftKey
                ? block
                    .split("\n")
                    .map((line) => line.replace(/^ {1,2}/, ""))
                    .join("\n")
                : block
                    .split("\n")
                    .map((line) => `  ${line}`)
                    .join("\n");
              setDraft({
                content: `${draftContent.slice(0, blockStart)}${nextBlock}${draftContent.slice(
                  blockEnd,
                )}`,
              });
              const cursor = event.shiftKey
                ? Math.max(blockStart, start - 2)
                : start + 2;
              window.setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = cursor;
              }, 0);
            }
          }}
        ></textarea>
        {linkOpen && linkSuggestions.length > 0 ? (
          <div
            className="notes-link-suggestions"
            role="listbox"
            aria-label={t("Link to note")}
          >
            {linkSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className={`notes-link-suggestion${
                  index === activeLinkIndex ? " is-active" : ""
                }`}
                role="option"
                aria-selected={index === activeLinkIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveLinkIndex(index)}
                onClick={() => insertLink(suggestion.title)}
              >
                <span className="notes-link-suggestion-icon" aria-hidden="true">
                  {suggestion.icon || DEFAULT_NOTE_ICON}
                </span>
                <span>{suggestion.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        </>
      )}
      {backlinks.length > 0 ? (
        <nav className="notes-backlinks" aria-label={t("Backlinks")}>
          <h2>{t("Backlinks")}</h2>
          <ul>
            {backlinks.map((backlink) => (
              <li key={`${backlink.notebookId}-${backlink.noteId}`}>
                <button
                  type="button"
                  className="notes-backlink"
                  title={backlink.title}
                  onClick={() => void openNote(backlink.notebookId, backlink.noteId)}
                >
                  <span className="notes-backlink-title">{backlink.title}</span>
                  <span className="notes-backlink-kind">
                    {backlinkKindLabel(backlink.kind)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {similarNotes.length > 0 ? (
        <nav className="notes-backlinks" aria-label={t("Similar notes")}>
          <h2>{t("Similar notes")}</h2>
          <ul>
            {similarNotes.map((similar) => (
              <li key={`${similar.notebookId}-${similar.noteId}`}>
                <button
                  type="button"
                  className="notes-backlink"
                  title={similar.title}
                  onClick={() => void openNote(similar.notebookId, similar.noteId)}
                >
                  <span className="notes-backlink-title">{similar.title}</span>
                  <span className="notes-backlink-kind">
                    {similar.sharedTags.join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
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
  busy,
  hint,
  role,
  title,
  onClick,
}: {
  label: string;
  icon: string;
  className: string;
  variant: string;
  disabled?: boolean;
  ariaPressed?: boolean;
  busy?: boolean;
  hint?: string;
  role?: string;
  title?: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      role={role}
      className={`ui-button ${variant} ${className}`.trim()}
      disabled={disabled}
      aria-pressed={ariaPressed}
      aria-busy={busy}
      aria-label={hint ? `${label} (${hint})` : label}
      title={title ?? (hint ? `${label} (${hint})` : label)}
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
    if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|pdf|txt|md|csv|json)$/i.test(attachmentId)) continue;
    const url = store.getState().attachmentUrl(note, attachmentId);
    if (attribute === "href") {
      const kind = (attachmentId.split(".").pop() || "").toLowerCase();
      const name = (target.textContent || "").trim() || `attachment.${kind}`;
      target.setAttribute("href", url);
      target.setAttribute("data-attachment-view", "1");
      target.setAttribute("data-attachment-name", name);
      target.setAttribute("data-attachment-kind", kind);
      target.removeAttribute("target");
      target.removeAttribute("rel");
      target.classList.add("notes-attachment-link");
      target.textContent = "";
      const icon = document.createElement("span");
      icon.className = "notes-attachment-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = attachmentIconFor(kind);
      const label = document.createElement("span");
      label.className = "notes-attachment-label";
      label.textContent = name;
      target.append(icon, label);
    } else {
      target.setAttribute("src", url);
      target.addEventListener("error", () => {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.className = "notes-attachment-fallback";
        link.textContent = target.getAttribute("alt") || t("Open attachment");
        target.replaceWith(link);
      });
    }
  }
}
