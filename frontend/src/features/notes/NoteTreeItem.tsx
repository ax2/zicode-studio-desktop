import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../shared/i18n";
import { NoteManageButton } from "./NoteManageButton";
import { HighlightedText, PinButton } from "./NotesControls";
import { DEFAULT_NOTE_ICON, DEFAULT_NOTEBOOK_ICON, formatDate, type NoteSummary } from "./notesLogic";
import type { NotesStore } from "./notesStore";
import { referenceKey } from "./shortcut-repository";

export function NoteTreeItem({ store, note }: { store: NotesStore; note: NoteSummary }) {
  const selectedNote = store((state) => state.selectedNote);
  const query = store((state) => state.query);
  const selectNote = store((state) => state.selectNote);
  const openMovePopover = store((state) => state.openMovePopover);
  const selectMode = store((state) => state.selectMode);
  const selectedNoteIds = store((state) => state.selectedNoteIds);
  const isSelected = selectedNoteIds.includes(referenceKey(note));
  const [moveAnchor, setMoveAnchor] = useState<HTMLButtonElement | null>(null);
  const closeMove = useCallback(() => {
    setMoveAnchor(null);
    store.getState().closeMovePopover();
  }, [store]);
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
      className={`notes-list-item notes-tree-note${selectedNote && referenceKey(selectedNote) === referenceKey(note) ? " active" : ""}${
        isSelected ? " notes-selected" : ""
      }`}
      draggable={false}
      onClick={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (selectMode) {
          store.getState().toggleNoteSelected(note);
          return;
        }
        void selectNote(note);
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (!event.currentTarget.contains(target) || target.closest?.("button")) return;
        beginPointerDrag(event);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement;
        if (!event.currentTarget.contains(target) || target.closest?.("button")) return;
        event.preventDefault();
        if (selectMode) {
          store.getState().toggleNoteSelected(note);
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
        <strong title={note.title} translate="no">
          <HighlightedText text={note.title} query={query} />
        </strong>
        <span>
          {formatDate(note.updatedAt)}
          {note.source ? ` · ${t("Web clip")}` : ""}
        </span>
      </span>
      <span className="notes-row-actions">
        <PinButton store={store} note={note} />
        <NoteManageButton store={store} note={note} onMove={anchor => {
          setMoveAnchor(anchor);
          openMovePopover(note);
        }} />
      </span>
      {moveAnchor ? <MovePopover store={store} note={note} anchor={moveAnchor} onClose={closeMove} /> : null}
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
  title.setAttribute("translate", "no");
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
  anchor,
  onClose,
}: {
  store: NotesStore;
  note: NoteSummary;
  anchor: HTMLButtonElement;
  onClose(): void;
}) {
  const notebooks = store((state) => state.snapshot.notebooks);
  const destinations = notebooks.filter((notebook) => notebook.id !== note.notebookId);
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const place = () => {
      const origin = anchor.getBoundingClientRect();
      const { width, height } = panel.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const below = origin.bottom + gap;
      const above = origin.top - gap - height;
      const lowerEdge = window.innerHeight - margin - height;
      const top = below <= lowerEdge || above < margin ? Math.min(below, lowerEdge) : above;
      const left = Math.min(origin.left, window.innerWidth - margin - width);
      const next = { top: Math.max(margin, top), left: Math.max(margin, left) };
      setPosition(current => current.top === next.top && current.left === next.left ? current : next);
    };
    place();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    observer?.observe(panel);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    (panel.querySelector<HTMLButtonElement>(".notes-move-popover-item") ?? panel).focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        anchor.focus({ preventScroll: true });
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
      );
      if (focusables.length === 0) {
        onClose();
        anchor.focus({ preventScroll: true });
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outsideList = !focusables.some(button => button === active);
      if (event.shiftKey) {
        if (active === first || outsideList) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || outsideList) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      panel.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="notes-move-popover" role="dialog" aria-label={t("Move to notebook")} tabIndex={-1}
      style={position}>
      <strong className="notes-move-popover-title">
        {t("Move to notebook")} · <span translate="no">{note.title}</span>
      </strong>
      <div className="notes-move-popover-list">
        {destinations.map((notebook) => (
          <button
            key={notebook.id}
            type="button"
            className="notes-move-popover-item"
            onClick={() => {
              onClose();
              anchor.focus({ preventScroll: true });
              void store.getState().moveNoteTo(note.notebookId, note.id, notebook.id);
            }}
          >
            <span className="notes-nav-item-icon">{notebook.icon || DEFAULT_NOTEBOOK_ICON}</span>
            <span className="notes-nav-item-label" translate="no">{notebook.title}</span>
          </button>
        ))}
        {!destinations.length ? (
          <p className="notes-nav-message">{t("No other notebooks")}</p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
