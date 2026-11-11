import { t } from "../../i18n.js";

// The tablist remains scrollable for dragging, touch and keyboard focus, while
// explicit arrows replace its scrollbar. Resize does not steal page focus.
export function createBrowserTabStrip(host, newTab) {
  const element = document.createElement("div"); element.className = "browser-tabs-frame";
  const arrow = (direction, label) => {
    const button = document.createElement("button"); button.type = "button";
    button.className = "ui-icon-button ui-icon-button--xs ui-icon-button--ghost browser-tabs-arrow";
    button.setAttribute("aria-label", t(label)); button.title = t(label); button.hidden = true;
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="${direction < 0 ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}"/></svg>`;
    button.addEventListener("click", () => { host.scrollBy({ left: direction * Math.max(72, host.clientWidth * 0.7), behavior: "auto" }); updateEdges(); });
    return button;
  };
  const previous = arrow(-1, "Scroll tabs left"), next = arrow(1, "Scroll tabs right");
  element.append(previous, host, next); let lastActive;
  const title = '[role="tab"]';
  const controls = [title, ".browser-tab-unmute", ".browser-tab-close"];
  const selectedRow = () => host.querySelector('[aria-selected="true"]')?.closest(".browser-tab");
  const rowOf = control => {
    const row = control?.closest?.(".browser-tab");
    return host.contains(row) ? row : null;
  };
  function updateStops(row = selectedRow()) {
    for (const item of host.children) {
      for (const control of item.querySelectorAll(controls.join(","))) {
        control.tabIndex = item === row ? 0 : -1;
      }
    }
  }
  function focusedControl() {
    const button = host.ownerDocument.activeElement;
    const row = rowOf(button);
    if (row) return { id: row.dataset.browserTabId, selector: controls.find(selector => button.matches(selector)) };
  }
  function revealRow(row) {
    if (!row || row.hasAttribute("data-pinned")) return;
    const bounds = host.getBoundingClientRect(), tab = row.getBoundingClientRect();
    const pinned = [...host.querySelectorAll(".browser-tab[data-pinned]")].at(-1);
    const left = Math.max(bounds.left, pinned?.getBoundingClientRect().right ?? bounds.left);
    if (tab.left < left) host.scrollLeft += tab.left - left;
    else if (tab.right > bounds.right) host.scrollLeft += tab.right - bounds.right;
  }
  function focusTab(id, selector = title) {
    const row = [...host.children].find(row => row.dataset.browserTabId === id);
    const button = row?.querySelector(selector) ?? (row ?? selectedRow())?.querySelector(title) ?? newTab;
    button.focus({ preventScroll: true });
    revealRow(rowOf(button));
    updateEdges();
  }
  host.addEventListener("focusin", event => updateStops(rowOf(event.target) ?? undefined));
  host.addEventListener("focusout", event => updateStops(rowOf(event.relatedTarget) ?? undefined));
  host.addEventListener("keydown", event => {
    if (event.isComposing || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || !event.target.matches(title)) return;
    const rows = [...host.children];
    const index = rows.indexOf(rowOf(event.target));
    if (index < 0) return;
    let target;
    if (event.key === "Home") target = rows[0];
    else if (event.key === "End") target = rows.at(-1);
    else if (event.key === "ArrowLeft") target = rows[(index + rows.length - 1) % rows.length];
    else if (event.key === "ArrowRight") target = rows[(index + 1) % rows.length];
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    focusTab(target.dataset.browserTabId);
  });
  function updateEdges() {
    previous.disabled = host.scrollLeft <= 1;
    next.disabled = host.scrollLeft + host.clientWidth >= host.scrollWidth - 1;
  }
  function refresh(reveal = false) {
    const focused = rowOf(host.ownerDocument.activeElement);
    updateStops(focused ?? undefined);
    if (!element.clientWidth) return;
    const rows = [...host.children], gap = parseFloat(getComputedStyle(host).columnGap) || 0;
    const minimum = rows.reduce((sum, row) => sum + (parseFloat(getComputedStyle(row).minWidth) || 0), 0) + Math.max(0, rows.length - 1) * gap;
    previous.hidden = next.hidden = minimum <= element.clientWidth + 1;
    const active = selectedRow();
    const id = active?.dataset.browserTabId;
    if (reveal || id !== lastActive) revealRow(focused ?? active);
    lastActive = id; updateEdges();
  }
  host.addEventListener("scroll", updateEdges, { passive: true });
  const resize = new ResizeObserver(() => refresh(true)); resize.observe(element);
  return { element, refresh, focusedControl, focusTab };
}
