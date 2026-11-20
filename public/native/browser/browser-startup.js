import { t } from "../../i18n.js";

// Browser chrome can mount before native metadata and its first surface are ready.
// Keep only that chrome inert; the app navigation and window controls stay usable.
export function createBrowserStartup({ root, controls, viewport, retry }) {
  const message = document.createElement("div"); message.className = "browser-startup";
  const text = document.createElement("p"); text.setAttribute("role", "status");
  const again = document.createElement("button"); again.type = "button"; again.className = "ui-button ui-button--secondary"; again.textContent = t("Retry");
  message.append(text, again);
  let pending = true;
  function lock(locked) { for (const control of controls) { if (control.inert !== locked) control.inert = locked; } }
  function begin() {
    pending = true; root.setAttribute("aria-busy", "true"); lock(true);
    text.textContent = t("Restoring browser…"); again.hidden = true; again.disabled = true; viewport.replaceChildren(message);
  }
  again.addEventListener("click", () => { if (again.disabled) return; begin(); retry(); });
  begin();
  return {
    pending: () => pending,
    ready() { if (!pending) return; pending = false; root.setAttribute("aria-busy", "false"); lock(false); message.remove(); },
    fail(error, retryable = true) {
      pending = true; root.setAttribute("aria-busy", "false"); lock(true);
      text.textContent = String(error?.message ?? error); again.hidden = !retryable; again.disabled = !retryable; viewport.replaceChildren(message);
    },
  };
}
