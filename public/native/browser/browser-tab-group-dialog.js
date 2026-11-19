import { t } from "../../i18n.js";

export function showBrowserTabGroup({ tab, tabs, onSave, onClose }) {
  const dialog = document.createElement("dialog");
  dialog.className = "browser-tab-search-dialog ui-panel";
  dialog.setAttribute("aria-label", t("Tab group"));
  const heading = document.createElement("h2");
  heading.textContent = t("Tab group");
  const select = document.createElement("select");
  select.className = "ui-input";
  select.setAttribute("aria-label", t("Tab group"));
  const groups = new Map(tabs.filter(item => item.group).map(item => [item.group.id, item.group]));
  select.add(new Option(t("No tab group"), ""));
  for (const group of groups.values()) select.add(new Option(group.name, group.id));
  select.add(new Option(t("Create tab group"), "new"));
  select.value = tab.group?.id ?? (groups.size ? "" : "new");
  const name = document.createElement("input");
  name.className = "ui-input";
  name.placeholder = t("Tab group name");
  name.setAttribute("aria-label", name.placeholder);
  name.maxLength = 64;
  const update = () => {
    name.hidden = select.value !== "new" && (!tab.group || select.value !== tab.group.id);
    name.required = !name.hidden;
    name.value = groups.get(select.value)?.name ?? "";
    name.setCustomValidity("");
  };
  select.addEventListener("change", update);
  name.addEventListener("input", () => name.setCustomValidity(""));
  const form = document.createElement("form");
  form.className = "browser-tab-group-form";
  const save = document.createElement("button"), cancel = document.createElement("button");
  save.className = "ui-button ui-button--primary";
  save.textContent = t("Save");
  cancel.className = "ui-button ui-button--secondary";
  cancel.type = "button";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", () => dialog.close());
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (save.disabled) return;
    if (!name.hidden && !name.value.trim()) {
      name.setCustomValidity(t("Enter a tab group name"));
      name.reportValidity();
      return;
    }
    const group = select.value === "new" ? { id: crypto.randomUUID(), name: name.value.trim() }
      : !select.value ? null : { ...groups.get(select.value), name: name.hidden ? groups.get(select.value).name : name.value.trim() };
    save.disabled = cancel.disabled = true;
    try { await onSave(group); if (dialog.open) dialog.close(); }
    catch (cause) { error.textContent = t(String(cause.message ?? cause)); }
    finally { save.disabled = cancel.disabled = false; }
  });
  const footer = document.createElement("div");
  footer.append(cancel, save);
  form.append(select, name, footer, error);
  dialog.append(heading, form);
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  update();
  document.body.append(dialog);
  dialog.showModal();
  (name.hidden ? select : name).focus();
  return dialog;
}
