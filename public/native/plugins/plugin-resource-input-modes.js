import { t } from "../../i18n.js";
import { createTextResourceSelection } from "./plugin-text-resource-selection.js";
import { createMarkdownFileDraft } from "./markdown-file-draft.js";

// Text mode is offered only for an exact ordered set of Host-labelled text inputs.
export function createResourceInputModes(options, createFiles, mimeTypes, executionProfile) {
  const { resourceLabels = [], minResources, maxResources, container, onResource } = options;
  const markdown = executionProfile === "resource.wasi.markdown.v1" && maxResources === 1 && resourceLabels[0] === "Markdown text";
  const plainText = Array.isArray(mimeTypes) && mimeTypes.length === 1 && mimeTypes[0] === "text/plain";
  if (minResources !== maxResources || resourceLabels.length !== maxResources ||
      (!markdown && !plainText)) return createFiles(options);
  const toolbar = document.createElement("div"); toolbar.className = "ui-toolbar";
  const body = document.createElement("div"); container.append(toolbar, body);
  let current, mode, active = true, draft = [];
  const importFile = markdown && options.markdownDraftMode && typeof options.readInput === "function" ? createMarkdownFileDraft({ container,
    readInput: options.readInput, getDraft: () => draft[0] ?? "", isCurrent: options.isCurrent,
    onLoaded: text => { draft = [text]; select(0); } }) : null;
  const forward = value => { importFile?.setResource(mode === 1 ? value : null); onResource(value); };
  const buttons = ["Paste text", "Choose files"].map((label, index) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "ui-button ui-button--secondary";
    button.addEventListener("click", () => select(index)); toolbar.append(button);
    return { button, label };
  });
  function select(index) {
    if (!active || mode === index) return;
    if (mode === 0) draft = current.getValues();
    current?.destroy(); forward(null); body.replaceChildren(); mode = index;
    importFile?.setVisible(index === 1);
    current = (index === 0 ? createTextResourceSelection : createFiles)({ ...options, container: body, initialValues: draft, onResource: forward });
    render();
  }
  function render() {
    for (const [index, item] of buttons.entries()) {
      item.button.textContent = t(item.label); item.button.setAttribute("aria-pressed", String(index === mode));
    }
  }
  const locale = () => render(); window.addEventListener("zicode:locale-changed", locale);
  select(0);
  return { getInputOptions: () => markdown && options.markdownDraftMode ? { sourceMode: mode === 0 ? "draft" : "file" } : {}, destroy() {
    active = false; current.destroy(); importFile?.destroy(); window.removeEventListener("zicode:locale-changed", locale); toolbar.remove(); body.remove();
  } };
}
