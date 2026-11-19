import { t } from "../../i18n.js";

export function createBrowserUserAgentSettings(control) {
  const details = document.createElement("details");
  details.className = "browser-user-agent";
  const title = document.createElement("summary");
  title.textContent = t("User-Agent for new tabs");
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.className = "ui-input"; input.maxLength = 512; input.spellcheck = false;
  input.setAttribute("aria-label", title.textContent);
  const hint = document.createElement("small");
  hint.textContent = t("Uses the engine default when empty. Reopen existing tabs to use the new setting.");
  const status = document.createElement("span"); status.setAttribute("role", "status");
  const save = document.createElement("button"), reset = document.createElement("button");
  save.type = "submit"; reset.type = "button";
  for (const button of [save, reset]) button.className = "ui-button ui-button--secondary";
  save.textContent = t("Save"); reset.textContent = t("Restore default User-Agent");
  let generation = 0;
  async function request(action) {
    const current = ++generation;
    input.disabled = save.disabled = reset.disabled = true;
    status.textContent = "";
    try {
      const saved = await control(action);
      if (generation !== current) return;
      input.value = saved ?? "";
      if (action.kind === "setUserAgent") status.textContent = t("User-Agent saved for new tabs");
    } catch (error) {
      if (generation === current) status.textContent = t(String(error?.message ?? error));
    } finally {
      if (generation === current) input.disabled = save.disabled = reset.disabled = false;
    }
  }
  details.addEventListener("toggle", () => { if (details.open) void request({ kind: "getUserAgent" }); });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!save.disabled) void request({ kind: "setUserAgent", value: input.value || null });
  });
  reset.addEventListener("click", () => void request({ kind: "setUserAgent", value: null }));
  form.append(input, hint, save, reset, status); details.append(title, form);
  return details;
}
