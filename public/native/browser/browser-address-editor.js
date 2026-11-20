export function createBrowserAddressEditor(input) {
  let activeId, currentUrl = "", draft = false, composing = false, editVersion = 0;

  function update() {
    if (!draft && !composing && input.value !== currentUrl) input.value = currentUrl;
  }

  input.addEventListener("input", () => {
    draft = input.value !== currentUrl;
    editVersion++;
  });
  input.addEventListener("compositionstart", () => { composing = true; });
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

  return {
    sync(tab) {
      if (activeId !== tab?.id) {
        activeId = tab?.id;
        draft = false;
        composing = false;
      }
      currentUrl = tab?.url === "about:blank" ? "" : tab?.url ?? "";
      update();
    },
    submission() {
      if (!composing) return { text: input.value.trim(), editVersion };
    },
    accepted(submission) {
      if (editVersion === submission.editVersion && !composing) draft = false;
    },
  };
}
