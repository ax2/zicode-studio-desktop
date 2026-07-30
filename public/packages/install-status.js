export function summarizePackageError(err) {
  const raw = String(err?.message || err || "unknown error");
  if (raw.includes("EACCES") || raw.includes("permission denied")) {
    return "Permission denied in the ZiCode Studio Desktop package directory.";
  }
  return raw;
}

export function getPackageInstallFailure(err, operation = "install") {
  const fullMessage = String(err?.message || err || "unknown error");
  const isUninstall = operation === "uninstall";
  return {
    title: isUninstall ? "Uninstall failed" : "Install failed",
    note: isUninstall
      ? "ZiCode Studio Desktop could not remove this extension package. Check the error details, then try again."
      : "This extension requires npm. Make sure npm is installed and available to ZiCode Studio Desktop, then try again.",
    detail: summarizePackageError(fullMessage),
  };
}

export function renderPackageInstallFailure(status, err, operation = "install") {
  if (!status) return;
  const failure = getPackageInstallFailure(err, operation);
  status.hidden = false;
  status.classList.add("is-error");
  status.title = "";
  status.replaceChildren();

  const title = document.createElement("div");
  title.className = "settings-extension-status-title";
  title.textContent = failure.title;
  status.appendChild(title);

  const npmNote = document.createElement("div");
  npmNote.className = "settings-extension-status-note";
  npmNote.textContent = failure.note;
  status.appendChild(npmNote);

  const detail = document.createElement("div");
  detail.className = "settings-extension-status-detail";
  detail.textContent = failure.detail;
  status.appendChild(detail);
}
