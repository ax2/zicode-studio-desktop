import { useEffect, useRef } from "react";
import { t } from "../../shared/i18n";
import { highlightSegments, ICONS, type NoteSummary } from "./notesLogic";
import type { NotesStore } from "./notesStore";

export function Icon({ svg }: { svg: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = svg;
  }, [svg]);
  return <span ref={ref} className="notes-btn-icon" aria-hidden="true" />;
}

export function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <span translate="no">
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
    </span>
  );
}

export function PinButton({ store, note }: { store: NotesStore; note: NoteSummary }) {
  const pinned = store((state) => state.pinnedReferences.some((entry) => entry.id === note.id && entry.notebookId === note.notebookId));
  return (
    <button
      type="button"
      className={`notes-pin-btn${pinned ? " is-pinned" : ""}`}
      title={pinned ? t("Unpin from quick access") : t("Pin to quick access")}
      aria-label={pinned ? t("Unpin from quick access") : t("Pin to quick access")}
      aria-pressed={pinned}
      onClick={(event) => {
        event.stopPropagation();
        store.getState().togglePinned(note.id, note.notebookId);
      }}
    >
      <Icon svg={ICONS.pin} />
    </button>
  );
}
