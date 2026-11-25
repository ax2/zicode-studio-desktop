import { t } from "../../i18n.js";

export function createBrowserProxySettings(control) {
  const panel = document.createElement("details");
  panel.className = "browser-proxy browser-regular-option";

  const title = document.createElement("summary");
  title.textContent = t("Browser proxy");
  title.dataset.i18nText = "Browser proxy";

  const fields = document.createElement("div");
  fields.className = "browser-proxy-fields";
  const input = document.createElement("input");
  input.className = "ui-input";
  input.maxLength = 266;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "http://127.0.0.1:8080";
  input.setAttribute("aria-label", t("HTTP proxy address"));
  input.setAttribute("data-i18n-aria-label", "HTTP proxy address");

  const hint = document.createElement("small");
  hint.dataset.i18nText = "Use a single HTTP proxy for requests in this browser profile. Leave blank to use the system proxy.";
  hint.textContent = t(hint.dataset.i18nText);
  const draftHint = document.createElement("small");
  draftHint.dataset.i18nText = "Proxy address has unsaved changes.";
  draftHint.textContent = t(draftHint.dataset.i18nText);
  draftHint.hidden = true;
  const activeLabel = document.createElement("span");
  activeLabel.dataset.i18nText = "Current browser proxy";
  activeLabel.textContent = t("Current browser proxy");
  const activeValue = document.createElement("span");
  const activeRow = document.createElement("small");
  activeRow.hidden = true;
  activeRow.append(activeLabel, " · ", activeValue);

  const save = document.createElement("button");
  const reset = document.createElement("button");
  for (const [button, label] of [[save, "Save"], [reset, "Use system proxy"]]) {
    button.type = "button";
    button.className = "ui-button ui-button--secondary";
    button.dataset.i18nText = label;
    button.textContent = t(label);
    button.disabled = true;
  }

  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const showStatus = (key) => {
    status.dataset.i18nText = key;
    status.textContent = t(key);
  };
  let busy = false;
  let loaded = false;
  let composing = false;
  let savedAddress = "";
  const refreshDraftHint = () => { draftHint.hidden = input.value === savedAddress; };
  input.disabled = true;
  async function request(action) {
    const reading = action.kind === "getHttpProxy";
    if (busy || (!reading && !loaded)) return;
    const keepDraft = reading && input.value !== savedAddress;
    busy = true;
    if (reading) loaded = false;
    input.disabled = save.disabled = reset.disabled = true;
    showStatus("");
    try {
      const { active, saved } = await control(action);
      loaded = true;
      activeRow.hidden = false;
      if (active) delete activeValue.dataset.i18nText;
      else activeValue.dataset.i18nText = "System proxy";
      activeValue.textContent = active ?? t("System proxy");
      savedAddress = saved ?? "";
      if (!keepDraft) input.value = savedAddress;
      refreshDraftHint();
      showStatus(active === saved
        ? "Saved proxy is active"
        : "Quit Studio completely, then reopen it to apply the saved proxy.");
    } catch (error) {
      if (reading) activeRow.hidden = true;
      showStatus(String(error?.message ?? error));
    } finally {
      busy = false;
      input.disabled = save.disabled = reset.disabled = !loaded;
    }
  }

  panel.addEventListener("toggle", () => {
    if (panel.open) void request({ kind: "getHttpProxy" });
  });
  input.addEventListener("input", refreshDraftHint);
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; });
  input.addEventListener("blur", () => { composing = false; });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    if (!save.disabled) save.click();
  });
  save.addEventListener("click", () => void request({ kind: "setHttpProxy", value: input.value.trim() || null }));
  reset.addEventListener("click", () => void request({ kind: "setHttpProxy", value: null }));
  fields.append(input, hint, draftHint, activeRow, save, reset, status);
  panel.append(title, fields);
  return panel;
}
