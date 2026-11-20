/** A remembered-open descendant is still hidden when any ancestor is closed. */
export function isTreeItemVisible(item: HTMLElement): boolean {
  let ancestor = item.parentElement?.closest("details") ?? null;
  // A notebook's own summary remains visible even while that notebook is closed.
  if (item.matches(".notes-notebook-summary")) {
    ancestor = ancestor?.parentElement?.closest("details") ?? null;
  }
  while (ancestor) {
    if (!ancestor.open) return false;
    ancestor = ancestor.parentElement?.closest("details") ?? null;
  }
  return true;
}
