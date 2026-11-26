import { t } from "../../i18n.js";

export function createBrowserUserAgentSettings(control) {
  const details = document.createElement("details");
  details.className = "browser-user-agent";
  const title = document.createElement("summary");
  title.textContent = t("User-Agent for new tabs");
  const fields = document.createElement("div"); fields.className = "browser-user-agent-fields";
  const input = document.createElement("input");
  input.className = "ui-input"; input.maxLength = 512; input.spellcheck = false;
  input.setAttribute("aria-label", title.textContent);
  const hint = document.createElement("small");
  hint.textContent = t("Uses the engine default when empty. Reopen existing tabs to use the new setting.");
  const status = document.createElement("span"); status.setAttribute("role", "status");
  const save = document.createElement("button"), reset = document.createElement("button");
  save.type = reset.type = "button";
  for (const button of [save, reset]) button.className = "ui-button ui-button--secondary";
  save.textContent = t("Save"); reset.textContent = t("Restore default User-Agent");
  let busy = false;
  let loaded = false;
  let savedUserAgent = "";
  input.disabled = save.disabled = reset.disabled = true;
  async function request(action) {
    const saving = action.kind === "setUserAgent";
    if (busy || (saving && !loaded)) return;
    const keepDraft = !saving && input.value !== savedUserAgent;
    busy = true;
    if (!saving) loaded = false;
    input.disabled = save.disabled = reset.disabled = true;
    status.textContent = "";
    try {
      const saved = await control(action);
      loaded = true;
      savedUserAgent = saved ?? "";
      if (!keepDraft) input.value = savedUserAgent;
      if (saving) status.textContent = t("User-Agent saved for new tabs");
    } catch (error) {
      status.textContent = t(String(error?.message ?? error));
    } finally {
      busy = false;
      input.disabled = save.disabled = reset.disabled = !loaded;
    }
  }
  details.addEventListener("toggle", () => { if (details.open) void request({ kind: "getUserAgent" }); });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (!save.disabled) save.click();
  });
  save.addEventListener("click", () => void request({ kind: "setUserAgent", value: input.value || null }));
  reset.addEventListener("click", () => void request({ kind: "setUserAgent", value: null }));
  fields.append(input, hint, save, reset, status); details.append(title, fields);
  return details;
}
