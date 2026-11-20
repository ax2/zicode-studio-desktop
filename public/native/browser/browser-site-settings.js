import { t } from "../../i18n.js";

const kinds = ["Other permission", "Microphone", "Camera", "Location", "Notifications", "Sensors",
  "Clipboard read", "Automatic downloads", "File access", "Autoplay", "Local fonts", "MIDI devices", "Window management"];

export function showSiteSettings({ origin, request, onClose }) {
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, click) => {
    const node = el("button", t(label));
    node.dataset.i18nText = label;
    node.type = "button"; node.className = "ui-button ui-button--secondary";
    node.addEventListener("click", click);
    return node;
  };
  const dialog = el("dialog");
  dialog.className = "browser-history-dialog ui-panel";
  dialog.setAttribute("aria-label", t("Site permissions and storage"));
  const list = el("div"), actions = el("fieldset"), confirm = el("section"), status = el("p");
  status.setAttribute("role", "status");
  confirm.hidden = true;
  const clear = button("Clear site storage", () => prompt("Remove this site's local storage, databases, offline caches and service workers? Cookies are kept.", { type: "clearStorage" }, clear));
  const cookies = button("Clear host cookies", () => prompt("Clear cookies belonging only to this host across its ports? This may sign you out. Shared domain cookies are kept.", { type: "clearHostCookies" }, cookies));
  const close = button("Close", () => dialog.close());
  actions.append(el("legend", t("Saved site permissions")), list, clear, cookies);
  dialog.append(el("h2", t("Site permissions and storage")), el("p", origin), actions, confirm, status, close);
  function prompt(message, action, source) {
    actions.disabled = true; confirm.hidden = false;
    const cancel = button("Cancel", () => { confirm.hidden = true; actions.disabled = false; source.focus(); });
    const apply = button("Confirm", async () => {
      confirm.hidden = true; close.focus();
      try {
        await request({ ...action, confirmed: true });
        if (dialog.open) { await load(); status.textContent = t("Site settings updated"); }
      } catch (error) { status.textContent = t(String(error?.message ?? error)); }
      finally { actions.disabled = false; }
    });
    confirm.replaceChildren(el("p", origin), el("p", t(message)), cancel, apply);
    cancel.focus();
  }
  async function load() {
    const saved = await request({ type: "list" });
    list.replaceChildren();
    if (!saved.length) list.append(el("p", t("No saved permissions for this site")));
    for (const { permission, allowed } of saved) {
      const row = el("p");
      row.append(el("span", t(kinds[permission] ?? "Other permission") + " · " + t(allowed ? "Allowed" : "Permission denied")));
      if (allowed) {
        const revoke = button("Revoke permission", () => prompt("Revoke this permission for the displayed site?", { type: "revoke", permission }, revoke));
        row.append(revoke);
      }
      list.append(row);
    }
  }
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  load().catch(error => { status.textContent = t(String(error?.message ?? error)); });
}
