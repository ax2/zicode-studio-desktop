// Content owners opt out with translate="no"; nested product controls may opt
// back in. Code, editable values and executable text are never UI copy.
function editable(element) {
  for (let owner = element; owner; owner = owner.parentElement) {
    const value = owner.getAttribute("contenteditable")?.toLowerCase();
    if (value === "false") return false;
    if (value === "" || value === "true" || value === "plaintext-only") return true;
  }
  return false;
}

export function canTranslate(element, { text = false } = {}) {
  if (!element || element.closest("script, style")) return false;
  if (text && (element.closest("textarea") || editable(element))) return false;
  for (let owner = element; owner; owner = owner.parentElement) {
    const mode = owner.getAttribute("translate")?.toLowerCase();
    if (mode === "no") return false;
    if (mode === "" || mode === "yes") return true;
    if (text && owner.matches("pre, code")) return false;
  }
  return true;
}
