export function createBrowserAddressEditor(input) {
  let activeId, currentUrl = "", draft = false, composing = false, editVersion = 0, inputVersion = 0;

  function update() {
    if (!draft && !composing && input.value !== currentUrl) input.value = currentUrl;
  }

  input.addEventListener("input", () => {
    draft = input.value !== currentUrl;
    inputVersion = ++editVersion;
  });
  input.addEventListener("compositionstart", () => { composing = true; inputVersion = ++editVersion; });
  input.addEventListener("compositionend", () => {
    composing = false;
    draft = input.value !== currentUrl;
    inputVersion = ++editVersion;
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || composing) return;
    inputVersion = 0;
    if (!draft) return;
    event.preventDefault();
    event.stopPropagation();
    draft = false;
    editVersion++;
    update();
    input.select();
  });

  function hasEditedSince(version) {
    return version !== undefined && inputVersion > version;
  }

  return {
    get editVersion() { return editVersion; },
    hasEditedSince,
    sync(tab, keepEditsAfter) {
      currentUrl = tab?.url === "about:blank" ? "" : tab?.url ?? "";
      if (activeId !== tab?.id) {
        activeId = tab?.id;
        if (hasEditedSince(keepEditsAfter)) draft = input.value !== currentUrl;
        else {
          draft = false;
          composing = false;
          inputVersion = 0;
        }
      }
      update();
    },
    submission(text = input.value) {
      if (!composing) return { text: text.trim(), editVersion };
    },
    accepted(submission) {
      if (editVersion === submission.editVersion && !composing) {
        draft = false;
        inputVersion = 0;
      }
    },
  };
}
