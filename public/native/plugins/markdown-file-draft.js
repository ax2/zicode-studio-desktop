import { t } from "../../i18n.js";
import { loadMarkdownDraft } from "./markdown-draft-load.js";

// A parent-owned explicit copy operation; replacing a nonempty draft needs its own choice.
export function createMarkdownFileDraft({ container, readInput, getDraft, onLoaded, isCurrent }) {
  const panel = document.createElement("section"), controls = document.createElement("div"), prompt = document.createElement("div");
  const notice = document.createElement("p"), status = document.createElement("p"), question = document.createElement("p");
  panel.className = "ui-panel"; controls.className = "ui-toolbar"; prompt.className = "ui-panel";
  status.setAttribute("role", "status");
  function button(key, action) {
    const element = document.createElement("button"); element.type = "button"; element.className = "ui-button ui-button--secondary";
    element.addEventListener("click", action); return { element, key };
  }
  let active = true, visible = false, revision = 0, resource = null, busy = false, asking = false, statusKey = "";
  const valid = token => active && visible && token === revision && resource && isCurrent();
  const load = button("Load as editable copy", () => {
    if (!valid(revision) || busy) return;
    if (getDraft().length) { asking = true; render(); keep.element.focus({ preventScroll: true }); }
    else void adopt();
  });
  const cancel = button("Cancel loading copy", () => { revision++; busy = false; asking = false; statusKey = "Loading canceled. The file and previous draft are unchanged."; render(); });
  const replace = button("Replace draft and load file", () => void adopt());
  const keep = button("Keep current draft", () => { asking = false; statusKey = "Current draft kept. The selected file is unchanged."; render(); load.element.focus({ preventScroll: true }); });
  const buttons = [load, cancel, replace, keep];
  function render() {
    panel.hidden = !visible; prompt.hidden = !asking; cancel.element.hidden = !busy;
    panel.setAttribute("aria-busy", String(busy)); load.element.setAttribute("aria-expanded", String(asking));
    for (const item of buttons) item.element.textContent = t(item.key);
    load.element.disabled = busy || !resource; replace.element.disabled = busy || !resource;
    notice.textContent = t("Confirm file sharing, then load an editable Markdown copy. Maximum 2 MiB; the original file is unchanged.");
    question.textContent = t("Replace the current Markdown draft with this file? Keep the draft to cancel.");
    status.textContent = statusKey ? t(statusKey) : "";
  }
  async function adopt() {
    const token = revision, current = resource;
    if (!valid(token) || busy) return;
    busy = true; asking = false; statusKey = "Loading editable copy…"; render();
    try {
      const text = await loadMarkdownDraft({ resource: current, read: (offset, length) => readInput(current, offset, length, () => valid(token)), isCurrent: () => valid(token) });
      if (valid(token)) onLoaded(text);
    } catch {
      if (valid(token)) statusKey = "Could not load this copy. Check UTF-8 encoding, the 2 MiB limit and sharing permission. The previous draft is kept.";
    } finally {
      if (active && token === revision) {
        if (!valid(token)) statusKey = "Loading canceled. The file and previous draft are unchanged.";
        busy = false; render();
      }
    }
  }
  controls.append(load.element, cancel.element); prompt.append(question, replace.element, keep.element); panel.append(notice, controls, prompt, status); container.append(panel);
  const locale = () => render(); window.addEventListener("zicode:locale-changed", locale); render();
  return {
    setResource(value) { revision++; resource = value; busy = false; asking = false; statusKey = ""; render(); },
    setVisible(value) { visible = value; if (!value) { revision++; resource = null; busy = false; asking = false; } render(); },
    destroy() { active = false; revision++; window.removeEventListener("zicode:locale-changed", locale); panel.remove(); },
  };
}
