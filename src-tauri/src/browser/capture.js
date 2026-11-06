(() => {
  const excluded = 'script,style,noscript,template,input,textarea,select,option,[contenteditable], [hidden], [aria-hidden="true"]';
  const allowed = node => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest(excluded)) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let text = '', visited = 0, truncated = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++visited > 12000) { truncated = true; break; }
    if (!allowed(node)) continue;
    const part = (node.nodeValue || '').trim();
    if (!part) continue;
    const remaining = 48000 - text.length;
    if (part.length + 1 > remaining) { text += part.slice(0, Math.max(0, remaining)); truncated = true; break; }
    text += part + '\n';
  }
  const selection = getSelection();
  // A selection intersecting an editable/form region is not shared.
  let selected = '';
  if (selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const safe = allowed(range.startContainer) && allowed(range.endContainer) &&
      ![...document.querySelectorAll('input,textarea,select,[contenteditable]')].some(element => range.intersectsNode(element));
    if (safe) selected = selection.toString().slice(0, 8192);
  }
  return { title: document.title.slice(0, 512), url: location.href, text, selection: selected, truncated };
})()
