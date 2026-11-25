import { t } from "../../i18n.js";

export const SITE_SETTINGS_CHANGED = "Site changed. Open site settings again.";

const kinds = ["Other permission", "Microphone", "Camera", "Location", "Notifications", "Sensors",
  "Clipboard read", "Automatic downloads", "File access", "Autoplay", "Local fonts", "MIDI devices", "Window management"];

export function browserPermissionKind(permission) {
  return permission >= 0 && permission < kinds.length ? permission : 0;
}

export function blockedPermissionText(permissions) {
  if (!permissions?.size) return "";
  const names = [...permissions].sort((left, right) => left - right).map(permission => t(kinds[permission]));
  return t("Permissions blocked in this tab · {permissions}").replace("{permissions}", names.join(" · "));
}

export function showSiteSettings({ origin, blockedPermissions, request, onClose }) {
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
  dialog.className = "browser-history-dialog browser-site-settings ui-panel";
  dialog.setAttribute("aria-label", t("Site permissions and storage"));
  const list = el("div"), actions = el("fieldset"), confirm = el("section"), status = el("p");
  status.setAttribute("role", "status");
  status.tabIndex = list.tabIndex = -1;
  let stale = false, cancelReview;
  const blocked = el("p");
  function setBlockedPermissions(permissions) {
    const text = stale ? "" : blockedPermissionText(permissions);
    blocked.hidden = !text;
    blocked.textContent = text;
  }
  setBlockedPermissions(blockedPermissions);
  confirm.hidden = true;
  const clear = button("Clear site storage", () => prompt("Remove this site's local storage, databases, offline caches and service workers? Cookies are kept.", { type: "clearStorage" }, clear));
  const cookies = button("Clear host cookies", () => prompt("Clear cookies belonging only to this host across its ports? This may sign you out. Shared domain cookies are kept.", { type: "clearHostCookies" }, cookies));
  const close = button("Close", () => dialog.close());
  actions.append(el("legend", t("Saved site permissions")), list, clear, cookies);
  dialog.append(el("h2", t("Site permissions and storage")), el("p", origin), blocked, actions, confirm, status, close);
  const errorText = error => t(String(error?.message ?? error));
  function invalidate() {
    if (stale || !dialog.open) return;
    stale = true;
    setBlockedPermissions();
    clearReview();
    actions.disabled = true;
    status.textContent = "";
    list.setAttribute("aria-busy", "false");
    const changed = el("p", t(SITE_SETTINGS_CHANGED));
    changed.setAttribute("role", "alert");
    list.replaceChildren(changed);
    close.focus();
  }
  function invalidatedBy(error) {
    if (String(error?.message ?? error) === SITE_SETTINGS_CHANGED) invalidate();
    return stale;
  }
  function clearReview() {
    cancelReview = undefined;
    confirm.hidden = true;
    confirm.replaceChildren();
  }
  function prompt(message, action, source, permissionName) {
    if (stale || !dialog.open || actions.disabled) return;
    actions.disabled = true; confirm.hidden = false;
    const discard = () => {
      if (stale || !dialog.open || cancelReview !== discard) return;
      clearReview();
      actions.disabled = false;
      source.focus();
    };
    cancelReview = discard;
    const cancel = button("Cancel", discard);
    const apply = button("Confirm", async () => {
      if (stale || !dialog.open || cancelReview !== discard) return;
      clearReview();
      status.textContent = t("Applying site settings…");
      status.focus({ preventScroll: true });
      let failed = false;
      try {
        await request({ ...action, confirmed: true });
        if (!dialog.open || stale) return;
        status.textContent = permissionName
          ? `${t("Site permission revoked")} · ${permissionName}` : t("Site settings updated");
        await load();
      } catch (error) {
        if (!dialog.open || invalidatedBy(error)) return;
        failed = true;
        status.textContent = errorText(error);
      } finally {
        actions.disabled = stale;
        if (dialog.open && !stale && document.activeElement === status) {
          (failed ? source : close).focus({ preventScroll: true });
        }
      }
    });
    const details = el("div");
    details.id = "browser-site-settings-review";
    details.append(el("p", origin));
    if (permissionName) details.append(el("p", permissionName));
    details.append(el("p", t(message)));
    cancel.setAttribute("aria-describedby", details.id);
    apply.setAttribute("aria-describedby", details.id);
    confirm.replaceChildren(details, cancel, apply);
    cancel.focus();
  }
  async function load(restoreRetryFocus = false) {
    if (stale || !dialog.open) return;
    let nextRetry;
    actions.disabled = true;
    list.setAttribute("aria-busy", "true");
    list.replaceChildren(el("p", t("Loading saved site permissions…")));
    if (restoreRetryFocus) list.focus({ preventScroll: true });
    try {
      const saved = await request({ type: "list" });
      if (!dialog.open || stale) return;
      list.replaceChildren();
      if (!saved.length) list.append(el("p", t("No saved permissions for this site")));
      for (const { permission, allowed } of saved) {
        const name = t(kinds[permission] ?? "Other permission");
        const row = el("p");
        row.append(el("span", `${name} · ${t(allowed ? "Allowed" : "Permission denied")}`));
        if (allowed) {
          const revoke = button("Revoke permission", () => prompt("Revoke this permission for the displayed site?", { type: "revoke", permission }, revoke, name));
          revoke.setAttribute("aria-label", `${t("Revoke permission")} · ${name}`);
          row.append(revoke);
        }
        list.append(row);
      }
    } catch (error) {
      if (!dialog.open || invalidatedBy(error)) return;
      const failure = el("p", `${t("Could not read saved site permissions.")} ${errorText(error)}`);
      failure.setAttribute("role", "alert");
      const retry = button("Retry reading permissions", () => {
        void load(document.activeElement === retry);
      });
      nextRetry = retry;
      list.replaceChildren(failure, retry);
    } finally {
      list.setAttribute("aria-busy", "false");
      actions.disabled = stale;
      if (restoreRetryFocus && dialog.open && !stale && document.activeElement === list) {
        (nextRetry ?? close).focus({ preventScroll: true });
      }
    }
  }
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || !cancelReview) return;
    event.preventDefault();
    event.stopPropagation();
    cancelReview();
  });
  dialog.addEventListener("cancel", event => {
    if (!event.cancelable || !cancelReview) return;
    event.preventDefault();
    cancelReview();
  });
  dialog.addEventListener("close", () => { clearReview(); dialog.remove(); onClose(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  void load();
  return { invalidate, setBlockedPermissions, close() { if (dialog.open) dialog.close(); } };
}
