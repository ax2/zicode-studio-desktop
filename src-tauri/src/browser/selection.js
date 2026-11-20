(() => {
  const limit = 8192;
  const empty = { url: location.href, text: '', truncated: false };
  const selection = getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed) return empty;
  const range = selection.getRangeAt(0);
  const editable = 'form,input,textarea,select,button,[contenteditable]';
  // A focused input or child frame can retain an unrelated main-document selection.
  // The owner-bound read must not reuse it when translating from that target.
  if (document.activeElement?.closest(`${editable},iframe,frame`)) return empty;
  const elementOf = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const visible = node => {
    const element = elementOf(node);
    return element && !element.closest(`${editable},[hidden],[inert],[aria-hidden="true"],script,style,template`) &&
      element.getClientRects().length &&
      element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
  };
  if (!visible(range.startContainer) || !visible(range.endContainer)) return empty;
  const controls = elementOf(range.commonAncestorContainer)?.querySelectorAll(editable);
  if (controls && (controls.length > 4000 || Array.from(controls).some(element => range.intersectsNode(element)))) return empty;
  const text = selection.toString().trim();
  if (text.length > limit) return { ...empty, truncated: true };
  return { ...empty, text };
})()
