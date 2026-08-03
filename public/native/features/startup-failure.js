import { t } from "../../i18n.js";

export function renderStartupFailure(
  error,
  { documentRef = globalThis.document, reload = () => globalThis.location?.reload() } = {},
) {
  if (!documentRef?.body) return null;
  documentRef.querySelector("[data-startup-failure]")?.remove();
  documentRef.body.classList.add("startup-failed");
  for (const child of documentRef.body.children) {
    child.setAttribute("inert", "");
    child.setAttribute("aria-hidden", "true");
  }
  const code = error?.code || "startup_failed";
  const copy = startupFailureCopy(code);
  const surface = documentRef.createElement("main");
  surface.className = "startup-failure";
  surface.dataset.startupFailure = code;
  surface.setAttribute("role", "alertdialog");
  surface.setAttribute("aria-modal", "true");
  surface.setAttribute("aria-labelledby", "startup-failure-title");
  surface.setAttribute("aria-live", "assertive");
  surface.removeAttribute("inert");
  surface.removeAttribute("aria-hidden");
  const card = documentRef.createElement("section");
  card.className = "startup-failure-card";
  const mark = documentRef.createElement("div");
  mark.className = "startup-failure-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "!";
  const title = documentRef.createElement("h1");
  title.id = "startup-failure-title";
  title.textContent = t(copy.title);
  const message = documentRef.createElement("p");
  message.textContent = t(copy.message);
  const guidance = documentRef.createElement("p");
  guidance.className = "startup-failure-guidance";
  guidance.textContent = t(copy.guidance);
  const retry = documentRef.createElement("button");
  retry.type = "button";
  retry.className = "ui-button ui-button--primary";
  retry.textContent = t("Retry");
  retry.addEventListener("click", reload);
  surface.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    retry.focus();
  });
  card.append(mark, title, message, guidance, retry);
  surface.append(card);
  documentRef.body.append(surface);
  retry.focus();
  return surface;
}

function startupFailureCopy(code) {
  if (code === "device_pairing_required") {
    return {
      title: "This device is not paired",
      message: "ZiCode refused the remote connection before opening a workspace.",
      guidance: "Generate a new mobile link from the trusted desktop app, then open it on this device.",
    };
  }
  if (code === "device_access_revoked") {
    return {
      title: "Access to this device was revoked",
      message: "ZiCode closed the remote connection and stopped reconnecting.",
      guidance: "Generate a new mobile link from the trusted desktop app if this device should reconnect.",
    };
  }
  if (code === "pairing_rejected" || code === "pairing_failed") {
    return {
      title: "The mobile link is no longer valid",
      message: "The pairing link expired, was already used, or could not be exchanged.",
      guidance: "Return to the trusted desktop app and generate a new mobile link.",
    };
  }
  if (code === "pairing_rate_limited") {
    return {
      title: "Too many pairing attempts",
      message: "ZiCode temporarily blocked pairing attempts from this device.",
      guidance: "Wait one minute, then generate a fresh mobile link from the trusted desktop app.",
    };
  }
  return {
    title: "ZiCode could not start",
    message: "The local Host is unavailable or the session route could not be opened.",
    guidance: "Check that ZiCode Studio Desktop is running, then try again.",
  };
}
