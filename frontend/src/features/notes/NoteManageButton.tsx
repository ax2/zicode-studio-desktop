import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../shared/i18n";
import type { NoteSummary } from "./notesLogic";
import type { NotesStore } from "./notesStore";

export function NoteManageButton({ store, note, onMove }: { store: NotesStore; note: NoteSummary; onMove(rect: DOMRect): void }) {
  const [open, setOpen] = useState(false), [armed, setArmed] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setArmed(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const panel = menu.current, anchor = button.current;
    if (panel && anchor) {
      const rect = anchor.getBoundingClientRect(), size = panel.getBoundingClientRect();
      setPosition({ top: Math.max(0, Math.min(rect.bottom, window.innerHeight - size.height)), left: Math.max(0, Math.min(rect.right - size.width, window.innerWidth - size.width)) });
      panel.querySelector<HTMLButtonElement>("button")?.focus();
    }
    const outside = (event: Event) => { if (event.target instanceof Node && !panel?.contains(event.target) && !anchor?.contains(event.target)) { setOpen(false); setArmed(false); } };
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); setArmed(false); anchor?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside); document.addEventListener("keydown", onEscape);
    const resize = () => { setOpen(false); setArmed(false); };
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", onEscape); window.removeEventListener("resize", resize); };
  }, [open]);
  return <>
    <button ref={button} type="button" className="ui-icon-button ui-icon-button--ghost notes-manage-btn" aria-label={t("Manage note")} title={t("Manage note")} aria-haspopup="menu" aria-expanded={open}
      onClick={event => { event.stopPropagation(); setOpen(!open); setArmed(false); }}>⋯</button>
    {open && createPortal(<div ref={menu} className="notes-manage-popover ui-panel" role="menu" aria-label={t("Manage note")} style={position}
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      <button type="button" role="menuitem" className="ui-button ui-button--ghost" onClick={() => { const rect = button.current?.getBoundingClientRect(); close(); if (rect) onMove(rect); }}>{t("Move to notebook")}</button>
      <button type="button" role="menuitem" className="ui-button ui-button--danger" onClick={() => { if (!armed) { setArmed(true); return; } close(); void store.getState().deleteNoteFromList(note); }}>{armed ? t("Confirm delete") : t("Delete note")}</button>
    </div>, document.body)}
  </>;
}
