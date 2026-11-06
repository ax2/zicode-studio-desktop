import { t } from "../../i18n.js";

// The trusted selection controller owns grants/order; this renders names and role labels only.
export function renderResourceFileList(list, { files, labels = [], busy, onMove }) {
  list.replaceChildren();
  for (const [index, file] of files.entries()) {
    const item = document.createElement("li");
    const text = document.createElement("span");
    const role = labels[index];
    text.textContent = `${role ? `${t(role)}: ` : ""}${file.name} · ${file.size} ${t("bytes")}`;
    item.append(text);
    if (labels.length && files.length > 1) {
      const controls = document.createElement("div");
      controls.className = "ui-toolbar";
      for (const [step, label, symbol] of [[-1, "Move input up", "↑"], [1, "Move input down", "↓"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ui-button ui-button--secondary ui-button--sm";
        button.textContent = symbol;
        button.setAttribute("aria-label", t(label));
        button.disabled = busy || index + step < 0 || index + step >= files.length;
        button.addEventListener("click", () => onMove(index, step));
        controls.append(button);
      }
      item.append(controls);
    }
    list.append(item);
  }
}
