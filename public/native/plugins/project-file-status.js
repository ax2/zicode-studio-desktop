import { t } from "../../i18n.js";

const UNKNOWN = "File preparation status is unknown. Do not assume it has finished.";
export function projectFileStatusMessage(value) {
  if (value?.schemaVersion !== 1) return UNKNOWN;
  if (value.phase === "prepared" && value.executionFinished === false && value.contentRead === false && value.cancellationRequested === false) {
    return "The file has not been read. Select and confirm it again if needed.";
  }
  if (value.phase === "reading" && value.executionFinished === false && value.contentRead === null
    && typeof value.cancellationRequested === "boolean") {
    return value.cancellationRequested ? "Cancellation requested; file preparation has not ended." : "The file is still being prepared.";
  }
  if (value.phase !== "ended" || value.executionFinished !== true) return UNKNOWN;
  if (value.outcome === "published" && value.contentRead === true) {
    return "A file snapshot was created. This status does not restore the file or execute a tool.";
  }
  if (value.outcome === "cancelled" && (value.contentRead === false || value.contentRead === null)) {
    return "File preparation was cancelled and has ended.";
  }
  if (value.outcome === "failed" && value.contentRead === null) return "File preparation failed and has ended. Select and confirm again if needed.";
  if (value.outcome === "timedOut" && value.contentRead === null) return "File preparation timed out and has ended. Select and confirm again if needed.";
  return UNKNOWN;
}

// One metadata request at a time, no polling loop or persistent file journal.
export function createProjectFileStatus({ api, isCurrent, timeoutMs = 3000 }) {
  const element = document.createElement("section");
  element.className = "ui-panel";
  element.setAttribute("aria-label", t("File preparation status"));
  element.hidden = true;
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary";
  button.textContent = t("Check file preparation status");
  element.append(message, button);
  let active = true, sequence = 0, busy = false, target = null, timer;
  const valid = () => active && isCurrent();
  async function check(preview) {
    if (!valid() || typeof api?.status !== "function") return;
    if (preview) target = { owner: { ...preview.owner }, grantId: preview.grantId };
    if (!target) return;
    element.hidden = false;
    if (busy) { message.textContent = t(UNKNOWN); return; }
    const token = ++sequence, current = target;
    busy = true;
    button.disabled = true;
    message.textContent = t("Checking file preparation status…");
    let timedOut = false;
    timer = setTimeout(() => {
      timedOut = true;
      if (valid() && token === sequence) message.textContent = t(UNKNOWN);
    }, timeoutMs);
    try {
      const result = await api.status(current.owner, current.grantId);
      if (valid() && token === sequence && !timedOut) message.textContent = t(projectFileStatusMessage(result));
    } catch {
      if (valid() && token === sequence) message.textContent = t(UNKNOWN);
    } finally {
      clearTimeout(timer);
      timer = undefined;
      busy = false;
      if (valid()) button.disabled = false;
    }
  }
  button.addEventListener("click", () => { void check(); });
  return {
    element, check,
    refresh(preview) {
      if (preview && target?.grantId === preview.grantId && JSON.stringify(target.owner) === JSON.stringify(preview.owner)) void check();
    },
    clear() {
      sequence++;
      target = null;
      element.hidden = true;
      message.textContent = "";
      clearTimeout(timer);
    },
    destroy() {
      active = false;
      sequence++;
      target = null;
      clearTimeout(timer);
      element.remove();
    },
  };
}
