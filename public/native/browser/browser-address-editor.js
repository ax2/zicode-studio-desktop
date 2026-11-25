export function createBrowserAddressEditor(input) {
  let activeId, currentUrl = "", draft = false, composing = false, editVersion = 0;

  function update() {
    if (!draft && !composing && input.value !== currentUrl) input.value = currentUrl;
  }

  input.addEventListener("input", () => {
    draft = input.value !== currentUrl;
    editVersion++;
  });
  input.addEventListener("compositionstart", () => { composing = true; editVersion++; });
  input.addEventListener("compositionend", () => {
    composing = false;
    draft = input.value !== currentUrl;
    editVersion++;
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || composing || !draft) return;
    event.preventDefault();
    event.stopPropagation();
    draft = false;
    editVersion++;
    update();
    input.select();
  });

  function hasEditedSince(version) {
    return version !== undefined && editVersion !== version && (draft || composing);
  }

  return {
    get editVersion() { return editVersion; },
    hasEditedSince,
    sync(tab, keepEditsAfter) {
      if (activeId !== tab?.id) {
        activeId = tab?.id;
        if (!hasEditedSince(keepEditsAfter)) {
          draft = false;
          composing = false;
        }
      }
      currentUrl = tab?.url === "about:blank" ? "" : tab?.url ?? "";
      update();
    },
    submission(text = input.value) {
      if (!composing) return { text: text.trim(), editVersion };
    },
    accepted(submission) {
      if (editVersion === submission.editVersion && !composing) draft = false;
    },
  };
}
