import { t } from "../../i18n.js";

export function createBookmarkDraftGuard(owner) {
  let fields = [], pending = null, returnFocus = null;
  const dirty = () => fields.some(([node, value]) => node.isConnected && node.value !== value);
  const restoreFocus = () => {
    if (returnFocus?.isConnected && !returnFocus.matches(":disabled")) {
      returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
  };
  return {
    track(form) {
      fields = [...(form?.querySelectorAll("input, select") ?? [])].map(node => [node, node.value]);
    },
    restoreFocus,
    dirty,
    async confirm() {
      if (pending) return false;
      if (!dirty()) return true;
      const prompt = document.createElement("dialog");
      prompt.className = "browser-bookmarks-dialog ui-panel";
      prompt.setAttribute("aria-label", t("Discard bookmark edits?"));
      const heading = document.createElement("h2");
      heading.textContent = t("Discard bookmark edits?");
      const description = document.createElement("p");
      description.textContent = t("Your changes have not been saved.");
      const actions = document.createElement("div");
      actions.className = "ui-toolbar";
      let discarded = false;
      const button = (label, variant, discard) => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = `ui-button ui-button--${variant}`;
        node.textContent = t(label);
        node.addEventListener("click", () => { discarded = discard; prompt.close(); });
        return node;
      };
      const keep = button("Keep editing", "secondary", false);
      actions.append(keep, button("Discard changes", "danger", true));
      prompt.append(heading, description, actions);
      return new Promise(resolve => {
        pending = prompt;
        const ownerClosed = () => prompt.close();
        owner.addEventListener("close", ownerClosed, { once: true });
        prompt.addEventListener("cancel", event => { event.preventDefault(); prompt.close(); });
        prompt.addEventListener("close", () => {
          prompt.remove();
          pending = null;
          owner.removeEventListener("close", ownerClosed);
          if (!discarded) returnFocus = fields[0]?.[0];
          resolve(discarded && owner.open);
        }, { once: true });
        document.body.append(prompt);
        prompt.showModal();
        keep.focus({ preventScroll: true });
      });
    },
  };
}
