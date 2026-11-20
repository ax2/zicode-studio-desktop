import { t } from "../../i18n.js";

export const browserPinLimit = 4;

export function groupBrowserTabs(tabs) {
  const grouped = new Map();
  const blocks = [];
  for (const tab of tabs.filter(item => !item.pinned)) {
    if (!tab.group) { blocks.push([tab]); continue; }
    if (!grouped.has(tab.group.id)) {
      const block = [];
      grouped.set(tab.group.id, block);
      blocks.push(block);
    }
    grouped.get(tab.group.id).push(tab);
  }
  return [...tabs.filter(tab => tab.pinned), ...blocks.flat()];
}

export function setBrowserTabGroup(tabs, id, group) {
  const tab = tabs.find(item => item.id === id);
  if (!tab || tab.pinned || tab.popupOpener) return tabs;
  if (group && group.id === tab.group?.id) {
    return tabs.map(item => item.group?.id === group.id ? { ...item, group } : item);
  }
  const next = tabs.filter(item => item !== tab);
  const last = group ? next.findLastIndex(item => item.group?.id === group.id) : -1;
  next.splice(last < 0 ? tabs.indexOf(tab) : last + 1, 0, { ...tab, group });
  return groupBrowserTabs(next);
}

export function toggleBrowserTabPin(tabs, id) {
  const tab = tabs.find(item => item.id === id);
  if (!tab || (!tab.pinned && tabs.filter(item => item.pinned).length >= browserPinLimit)) return tabs;
  const next = tabs.filter(item => item.id !== id);
  const changed = { ...tab, pinned: !tab.pinned };
  delete changed.group;
  next.splice(next.filter(item => item.pinned).length, 0, changed);
  return next;
}

export function moveBrowserTab(tabs, { id, target, after = false, step }) {
  const from = tabs.findIndex(tab => tab.id === id);
  if (from < 0) return tabs;
  if (step !== undefined) {
    if (![1, -1].includes(step) || from + step < 0 || from + step >= tabs.length) return tabs;
    target = tabs[from + step].id; after = step > 0;
  }
  const peer = tabs.find(tab => tab.id === target);
  if (target === id || !peer || Boolean(peer.pinned) !== Boolean(tabs[from].pinned)) return tabs;
  const next = tabs.filter(tab => tab.id !== id);
  const index = next.findIndex(tab => tab.id === target) + Number(after);
  const source = tabs[from];
  const moved = !peer.popupOpener && !source.popupOpener && source.group?.id !== peer.group?.id
    ? { ...source, group: peer.group } : source;
  next.splice(index, 0, moved);
  return next.every((tab, i) => tab === tabs[i]) ? tabs : groupBrowserTabs(next);
}

// Only drags started on this chrome tablist can reorder. External/page drops are ignored.
export function setupBrowserTabOrdering(host, { onMove, onFinish }) {
  let source = null, destination = null, pointer = null, frame = null, lastTime = null;
  const rowOf = element => {
    const row = element?.closest?.("[data-browser-tab-id]");
    return row && host.contains(row) ? row : null;
  };
  const clearMarker = () => { for (const row of host.querySelectorAll("[data-drop-side]")) delete row.dataset.dropSide; };
  const vertical = () => host.getAttribute("aria-orientation") === "vertical";
  const mark = (row, x, y) => {
    clearMarker(); destination = null;
    if (!row || row.dataset.browserTabId === source) return;
    const origin = [...host.children].find(item => item.dataset.browserTabId === source);
    if (!origin || row.hasAttribute("data-pinned") !== origin.hasAttribute("data-pinned")) return;
    const rect = row.getBoundingClientRect();
    const after = vertical() ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2;
    row.dataset.dropSide = after ? "after" : "before";
    destination = { target: row.dataset.browserTabId, after };
  };
  const stopScroll = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; lastTime = null; pointer = null; };
  const tick = time => {
    frame = null; if (!source || !pointer) return;
    const rect = host.getBoundingClientRect();
    const position = vertical() ? pointer.y - rect.top : pointer.x - rect.left;
    const length = vertical() ? rect.height : rect.width;
    const edge = Math.min(vertical() ? rect.width : rect.height, length / 3);
    const direction = position < edge ? -1 : position > length - edge ? 1 : 0;
    const elapsed = lastTime === null ? 16 : Math.min(time - lastTime, 32); lastTime = time;
    if (direction) {
      if (vertical()) host.scrollTop += direction * elapsed * 0.4;
      else host.scrollLeft += direction * elapsed * 0.4;
      mark(rowOf(document.elementFromPoint(pointer.x, pointer.y)), pointer.x, pointer.y);
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
    pointer = { x: event.clientX, y: event.clientY }; mark(rowOf(event.target), event.clientX, event.clientY);
    if (frame === null) frame = requestAnimationFrame(tick);
  });
  host.addEventListener("dragleave", event => {
    if (!host.contains(event.relatedTarget)) { stopScroll(); clearMarker(); destination = null; }
  });
  host.addEventListener("drop", event => {
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    mark(rowOf(event.target), event.clientX, event.clientY);
    const change = destination ? { id: source, ...destination } : null;
    cancel(); if (change) onMove(change);
  });
  host.addEventListener("dragend", cancel);
  host.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (source && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    const row = event.target.matches?.('[role="tab"]') ? rowOf(event.target) : null;
    const [back, forward] = vertical() ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (!row || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || ![back, forward].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    onMove({ id: row.dataset.browserTabId, step: event.key === forward ? 1 : -1 });
  });
  return {
    get dragging() { return source !== null; }, cancel,
    decorate(row, title, id) {
      row.dataset.browserTabId = id; title.draggable = true;
      title.setAttribute("aria-keyshortcuts", vertical() ? "Alt+Shift+ArrowUp Alt+Shift+ArrowDown" : "Alt+Shift+ArrowLeft Alt+Shift+ArrowRight");
      title.setAttribute("aria-description", t(vertical() ? "Drag to reorder. When focused, Alt+Shift+Up or Down moves this tab." : "Drag to reorder. When focused, Alt+Shift+Left or Right moves this tab."));
    },
  };
}
