import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { commandWindow, revealCommand } from "./command-window";
import type { PaletteCommand } from "./commandPaletteLogic";

export function useCommandWindow(commands: PaletteCommand[], selected: number, ref: RefObject<HTMLDivElement | null>) {
  const [geometry, setGeometry] = useState({ top: 0, height: 280, row: 56 });
  const geometryRef = useRef(geometry);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const update = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const next = {
      top: element.scrollTop,
      height: element.clientHeight || geometryRef.current.height,
      row: element.querySelector<HTMLElement>(".command-item")?.offsetHeight || geometryRef.current.row,
    };
    geometryRef.current = next;
    setGeometry(previous => previous.top === next.top && previous.height === next.height && previous.row === next.row ? previous : next);
  }, [ref]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filtered catalog resets scroll even when selection is unchanged.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    update();
  }, [commands, ref, update]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only selection/catalog changes reveal; manual scrolling must not snap back.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || selected < 0) return;
    const current = geometryRef.current;
    element.scrollTop = revealCommand(selected, element.scrollTop, element.clientHeight || current.height, current.row);
    update();
  }, [selected, commands, ref, update]);
  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const element = ref.current;
      if (!element) return;
      update();
      const current = geometryRef.current;
      element.scrollTop = revealCommand(selectedRef.current, current.top, current.height, current.row);
      update();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, update]);
  const range = commandWindow(commands.length, geometry.top, geometry.height, geometry.row);
  const navigationStart = (direction: 1 | -1) => {
    const { top, height, row } = geometryRef.current;
    if (selected >= 0 && selected * row >= top && (selected + 1) * row <= top + height) return selected;
    return direction === 1 ? Math.floor(top / row) - 1 : Math.min(commands.length, Math.ceil((top + height) / row));
  };
  return { ...range, onScroll: update, navigationStart, selectedMounted: selected >= range.start && selected < range.end,
    selectedVisible: selected >= 0 && selected * geometry.row >= geometry.top && (selected + 1) * geometry.row <= geometry.top + geometry.height };
}
