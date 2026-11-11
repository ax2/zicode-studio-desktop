import { t } from "../../i18n.js";
import { createBrowserTabIcon } from "./browser-tab-icon.js";

export function showBrowserTabSearch({ tabs, active, getIcon, onSelect, onClose }) {
  const element = (tag, className = "", text = "") => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const dialog = element("dialog", "browser-tab-search-dialog ui-panel");
  dialog.setAttribute("aria-label", t("Search tabs"));
  const input = element("input", "ui-input");
  input.type = "search";
  input.placeholder = t("Search tab titles or addresses");
  input.setAttribute("aria-label", input.placeholder);
  const results = element("div", "browser-tab-search-results");
  const message = element("p", "browser-tab-search-status");
  message.setAttribute("role", "status");
  const close = element("button", "ui-button ui-button--secondary ui-button--sm", t("Close"));
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  let matches = [], chosen, busy = false;

  async function choose(id) {
    if (busy || !id) return;
    busy = true;
    message.textContent = "";
    try {
      await onSelect(id);
      chosen = id;
      if (dialog.open) dialog.close();
    } catch (error) {
      message.textContent = t(String(error?.message ?? error));
    } finally {
      busy = false;
    }
  }

  function render() {
    const words = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    matches = tabs.filter(tab => {
      const text = `${tab.title ?? ""} ${tab.url}`.toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
    results.replaceChildren();
    message.textContent = matches.length ? "" : t("No matching tabs");
    for (const tab of matches) {
      const title = element("span", "browser-tab-search-title", tab.title || tab.url);
      const url = element("span", "browser-tab-search-url", tab.url);
      const details = element("span", "browser-tab-search-details");
      details.append(title, url);
      const button = element("button", "ui-button ui-button--ghost browser-tab-search-result");
      button.type = "button";
      button.title = tab.url;
      if (tab.id === active) button.setAttribute("aria-current", "true");
      button.append(createBrowserTabIcon(tab.url, getIcon(tab.id)), details);
      button.addEventListener("click", () => void choose(tab.id));
      results.append(button);
    }
    results.scrollTop = 0;
  }

  input.addEventListener("input", render);
  dialog.addEventListener("keydown", event => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target === input && event.key === "Enter") {
      event.preventDefault();
      void choose(matches[0]?.id);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...results.children];
    if (!buttons.length) return;
    const current = buttons.indexOf(event.target);
    if (current < 0 && event.target !== input) return;
    event.preventDefault();
    if (current < 0) (event.key === "ArrowDown" ? buttons[0] : buttons.at(-1)).focus();
    else (buttons[current + (event.key === "ArrowDown" ? 1 : -1)] ?? input).focus();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose(chosen);
  }, { once: true });
  dialog.append(element("h2", "", t("Search tabs")), input, results, message, close);
  document.body.append(dialog);
  render();
  dialog.showModal();
  input.focus();
  return dialog;
}
