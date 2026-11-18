// Modal launchers can disappear when the compact navigation menu closes.
export function restorePaletteFocus(previous: HTMLElement | null, trigger: HTMLElement, doc: Document = document) {
  const visible = (element: HTMLElement | null): element is HTMLElement => {
    if (!element?.isConnected || element.closest('[hidden], [inert], .hidden, .plugin-surface-hidden')) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    return true;
  };
  const destination = [previous, trigger,
    doc.querySelector<HTMLElement>('[data-plugin-id="core.commands"]'),
    doc.querySelector<HTMLElement>('[data-mobile-activity-more]')].find(visible);
  destination?.focus();
}
