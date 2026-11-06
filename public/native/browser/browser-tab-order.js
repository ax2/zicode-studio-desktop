import { t } from "../../i18n.js";

export function moveBrowserTab(tabs, { id, target, after = false, step }) {
  const from = tabs.findIndex(tab => tab.id === id);
  if (from < 0) return tabs;
  if (step !== undefined) {
    if (![1, -1].includes(step) || from + step < 0 || from + step >= tabs.length) return tabs;
    target = tabs[from + step].id; after = step > 0;
  }
  if (target === id || !tabs.some(tab => tab.id === target)) return tabs;
  const next = tabs.filter(tab => tab.id !== id);
  const index = next.findIndex(tab => tab.id === target) + Number(after);
  next.splice(index, 0, tabs[from]);
  return next.every((tab, i) => tab === tabs[i]) ? tabs : next;
}

// Only drags started on this chrome tablist can reorder. External/page drops are ignored.
export function setupBrowserTabOrdering(host, { onMove, onFinish }) {
  let source = null, destination = null, pointer = null, frame = null, lastTime = null;
  const rowOf = element => {
    const row = element?.closest?.("[data-browser-tab-id]");
    return row && host.contains(row) ? row : null;
  };
  const clearMarker = () => { for (const row of host.querySelectorAll("[data-drop-side]")) delete row.dataset.dropSide; };
  const mark = (row, x) => {
    clearMarker(); destination = null;
    if (!row || row.dataset.browserTabId === source) return;
    const rect = row.getBoundingClientRect(), after = x > rect.left + rect.width / 2;
    row.dataset.dropSide = after ? "after" : "before";
    destination = { target: row.dataset.browserTabId, after };
  };
  const stopScroll = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; lastTime = null; pointer = null; };
  const tick = time => {
    frame = null; if (!source || !pointer) return;
    const rect = host.getBoundingClientRect(), edge = Math.min(rect.height, rect.width / 3);
    const direction = pointer.x < rect.left + edge ? -1 : pointer.x > rect.right - edge ? 1 : 0;
    const elapsed = lastTime === null ? 16 : Math.min(time - lastTime, 32); lastTime = time;
    if (direction) {
      host.scrollLeft += direction * elapsed * 0.4;
      mark(rowOf(document.elementFromPoint(pointer.x, pointer.y)), pointer.x);
      frame = requestAnimationFrame(tick);
    }
  };
  const cancel = () => {
    const wasDragging = source !== null;
    source = null; destination = null; stopScroll(); clearMarker(); host.classList.remove("browser-tabs--dragging");
    if (wasDragging) onFinish?.();
  };
  host.addEventListener("dragstart", event => {
    const title = event.target.closest?.('[role="tab"]'), row = rowOf(title);
    if (!row || !event.dataTransfer) { event.preventDefault(); return; }
    source = row.dataset.browserTabId;
    event.dataTransfer.setData("application/x-zicode-browser-tab", source); event.dataTransfer.effectAllowed = "move";
    host.classList.add("browser-tabs--dragging");
  });
  host.addEventListener("dragover", event => {
    if (!source) return;
    event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    pointer = { x: event.clientX, y: event.clientY }; mark(rowOf(event.target), event.clientX);
    if (frame === null) frame = requestAnimationFrame(tick);
  });
  host.addEventListener("dragleave", event => {
    if (!host.contains(event.relatedTarget)) { stopScroll(); clearMarker(); destination = null; }
  });
  host.addEventListener("drop", event => {
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    mark(rowOf(event.target), event.clientX);
    const change = destination ? { id: source, ...destination } : null;
    cancel(); if (change) onMove(change);
  });
  host.addEventListener("dragend", cancel);
  host.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (source && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    const row = event.target.matches?.('[role="tab"]') ? rowOf(event.target) : null;
    if (!row || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    onMove({ id: row.dataset.browserTabId, step: event.key === "ArrowRight" ? 1 : -1 });
  });
  return {
    get dragging() { return source !== null; }, cancel,
    decorate(row, title, id) {
      row.dataset.browserTabId = id; title.draggable = true;
      title.setAttribute("aria-keyshortcuts", "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight");
      title.setAttribute("aria-description", t("Drag to reorder. When focused, Alt+Shift+Left or Right moves this tab."));
    },
    focus(id) {
      const row = [...host.children].find(row => row.dataset.browserTabId === id);
      const title = row?.querySelector('[role="tab"]'); title?.focus({ preventScroll: true }); title?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  };
}
