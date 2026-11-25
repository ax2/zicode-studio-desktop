import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getByRole, getByText, queryByRole, waitFor } from "@testing-library/dom";
import { getLocale, setLocale, t } from "../../i18n.js";
import { showSiteSettings } from "./browser-site-settings.js";
import { setupBrowserApp } from "./browser-app.js";

const revokeName = permission => `${t("Revoke permission")} · ${t(permission)}`;
const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
let app;
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  } });
});
afterEach(async () => {
  await app?.canDeactivate();
  app = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
  else delete HTMLDialogElement.prototype.showModal;
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else delete HTMLDialogElement.prototype.close;
});

it.each([
  ["Clear site storage", { type: "clearStorage" }],
  ["Clear host cookies", { type: "clearHostCookies" }],
  ["Revoke permission", { type: "revoke", permission: 2 }],
])("requires explicit confirmation before %s and requests only the selected operation", async (label, action) => {
  const request = vi.fn(async ({type}) => type === "list" ? [{permission: 2, allowed: true}] : null);
  showSiteSettings({origin: "https://example.test", request, onClose: vi.fn()});
  const click = name => getByRole(document.body, "button", { name: name === "Revoke permission" ? revokeName("Camera") : t(name) }).click();
  await waitFor(() => expect(getByRole(document.body, "button", { name: revokeName("Camera") })).toBeTruthy());
  click(label);
  expect(document.activeElement.textContent).toBe(t("Cancel"));
  click("Cancel");
  expect(request.mock.calls).toEqual([[{type:"list"}]]);
  click(label); click("Confirm");
  const success = action.type === "revoke" ? `${t("Site permission revoked")} · ${t("Camera")}` : t("Site settings updated");
  await waitFor(() => expect(getByRole(document.body, "status").textContent).toBe(success));
  expect(request.mock.calls).toEqual([[{type:"list"}],[{...action, confirmed:true}],[{type:"list"}]]);
});

it.each([
  ["Clear site storage", "Remove this site's local storage, databases, offline caches and service workers? Cookies are kept."],
  ["Clear host cookies", "Clear cookies belonging only to this host across its ports? This may sign you out. Shared domain cookies are kept."],
  ["Revoke permission", "Revoke this permission for the displayed site?"],
])("uses Escape to cancel only confirmation for %s and describes both review buttons", async (label, message) => {
  const origin = "https://example.test:8443";
  const request = vi.fn(async () => [{ permission: 2, allowed: true }]);
  const closed = vi.fn();
  showSiteSettings({ origin, request, onClose: closed });
  const source = await waitFor(() => getByRole(document.body, "button", {
    name: label === "Revoke permission" ? revokeName("Camera") : t(label),
  }));
  const dialog = source.closest("dialog");
  source.click();
  const review = dialog.querySelector("section");
  const apply = getByRole(review, "button", { name: t("Confirm") });
  const cancel = getByRole(review, "button", { name: t("Cancel") });
  const requestCancel = () => {
    if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
  };

  expect(document.activeElement).toBe(cancel);
  const key = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  cancel.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(true);
  expect(dialog.open).toBe(true);
  expect(review.hidden).toBe(true);
  expect(document.activeElement).toBe(source);
  apply.click();
  expect(request.mock.calls).toEqual([[{ type: "list" }]]);
  expect(closed).not.toHaveBeenCalled();

  source.click();
  for (const name of ["Cancel", "Confirm"]) {
    const button = getByRole(review, "button", { name: t(name) });
    const details = document.getElementById(button.getAttribute("aria-describedby"));
    expect(details.textContent).toContain(origin);
    expect(details.textContent).toContain(t(message));
    if (label === "Revoke permission") expect(details.textContent).toContain(t("Camera"));
  }
  cancel.click(); // A review replaced after cancellation cannot affect the new one.
  expect(review.hidden).toBe(false);
  requestCancel();
  requestCancel();
  expect(dialog.open).toBe(false);
  expect(closed).toHaveBeenCalledOnce();
  expect(request.mock.calls).toEqual([[{ type: "list" }]]);
});

async function mountSiteSettings({ readUrl, twoTabs = false } = {}) {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 900, height: 600 });
  const origin = "https://example.test:8443";
  const tab = { id: "permission-tab", url: "https://previous.test/", title: "Previous page" };
  const peer = { id: "other-tab", url: "https://other.test/", title: "Other page" };
  const tabs = twoTabs ? [tab, peer] : [tab];
  const request = vi.fn(async action => action.type === "list" ? [
    { permission: 1, allowed: true },
    { permission: 2, allowed: true },
    { permission: 3, allowed: false },
  ] : null);
  const nativeControls = [];
  let receiveEvent;
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: tab.id, tabs } };
    if (command === "browser_bookmarks") return { bookmarks: [], folders: [] };
    const control = args?.request;
    if (control?.kind === "status") return { surfaceRevision: 0, tabs };
    if (control?.kind === "url") return readUrl ? readUrl() : { url: origin + "/site" };
    if (control?.kind === "snapshot") return "data:image/jpeg;base64,AA==";
    if (control?.kind === "fullscreen") return { fullscreen: false };
    if (control?.kind === "siteSettings") { nativeControls.push(control); return request(control.action); }
    return {};
  });
  const host = document.createElement("main");
  document.body.append(host);
  app = setupBrowserApp({ invoke, listen: async (_, listener) => { receiveEvent = listener; return () => {}; } });
  app.renderContent(host);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_control", { request: expect.objectContaining({ kind: "present" }) }));
  const menu = host.querySelector(".browser-options");
  const open = () => {
    menu.open = true;
    getByRole(menu, "button", { name: t("Site permissions and storage") }).click();
  };
  const emit = payload => receiveEvent({ payload });
  const navigate = () => emit({ kind: "navigationStarted", tab: tab.id });
  return { origin, tab, peer, host, request, nativeControls, open, navigate, emit };
}

it("shows the exact site and permission before one explicit revocation", async () => {
  const { origin, tab, request, nativeControls, open } = await mountSiteSettings();
  open();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  await waitFor(() => expect(getByText(dialog, `${t("Microphone")} · ${t("Allowed")}`)).toBeTruthy());
  expect(getByText(dialog, `${t("Camera")} · ${t("Allowed")}`)).toBeTruthy();
  expect(getByText(dialog, `${t("Location")} · ${t("Permission denied")}`)).toBeTruthy();
  expect(queryByRole(dialog, "button", { name: revokeName("Location") })).toBeNull();
  const revoke = getByRole(dialog, "button", { name: revokeName("Microphone") });
  revoke.click();
  const review = dialog.querySelector("section");
  expect(getByText(review, origin)).toBeTruthy();
  expect(getByText(review, t("Microphone"))).toBeTruthy();
  expect(request.mock.calls).toEqual([[{ type: "list" }]]);
  getByRole(review, "button", { name: t("Cancel") }).click();
  expect(document.activeElement).toBe(revoke);
  expect(request).toHaveBeenCalledOnce();

  revoke.click();
  const confirm = getByRole(review, "button", { name: t("Confirm") });
  confirm.click();
  confirm.click();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request.mock.calls).toEqual([
    [{ type: "list" }],
    [{ type: "revoke", permission: 1, confirmed: true }],
    [{ type: "list" }],
  ]);
  expect(nativeControls).toEqual(request.mock.calls.map(([action]) => ({
    kind: "siteSettings", tab: tab.id, expectedOrigin: origin, action,
  })));
});

it("keeps a successful revocation visible when permission readback fails and retries only the read", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce([{ permission: 2, allowed: true }])
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(Error("Profile lookup failed"))
    .mockResolvedValueOnce([{ permission: 2, allowed: false }]);
  showSiteSettings({ origin: "https://example.test", request, onClose: vi.fn() });
  const revoke = await waitFor(() => getByRole(document.body, "button", { name: revokeName("Camera") }));
  revoke.click();
  getByRole(document.body, "button", { name: t("Confirm") }).click();
  await waitFor(() => expect(getByRole(document.body, "alert").textContent).toContain(t("Could not read saved site permissions.")));
  expect(getByRole(document.body, "status").textContent).toBe(`${t("Site permission revoked")} · ${t("Camera")}`);
  expect(queryByRole(document.body, "button", { name: revokeName("Camera") })).toBeNull();
  getByRole(document.body, "button", { name: t("Retry reading permissions") }).click();
  expect(getByText(document.body, t("Loading saved site permissions…"))).toBeTruthy();
  await waitFor(() => expect(getByText(document.body, `${t("Camera")} · ${t("Permission denied")}`)).toBeTruthy());
  expect(queryByRole(document.body, "alert")).toBeNull();
  expect(request.mock.calls).toEqual([
    [{ type: "list" }],
    [{ type: "revoke", permission: 2, confirmed: true }],
    [{ type: "list" }],
    [{ type: "list" }],
  ]);
});

it.each([false, true])("handles keyboard focus after a repeated permission read failure (moved focus: %s)", async movedFocus => {
  let rejectRetry;
  const request = vi.fn()
    .mockRejectedValueOnce(Error("First read failed"))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRetry = reject; }))
    .mockResolvedValueOnce([{ permission: 2, allowed: true }]);
  showSiteSettings({ origin: "https://example.test", request, onClose: vi.fn() });
  const getRetry = () => getByRole(document.body, "button", { name: t("Retry reading permissions") });
  const retry = await waitFor(getRetry);
  const dialog = retry.closest("dialog");
  retry.focus();
  retry.click();
  expect(document.activeElement).toBe(getByRole(dialog, "button", { name: t("Close") }));
  if (movedFocus) {
    dialog.tabIndex = -1;
    dialog.focus();
  }
  rejectRetry(Error("Second read failed"));
  const replacement = await waitFor(getRetry);
  expect(replacement).not.toBe(retry);
  expect(document.activeElement).toBe(movedFocus ? dialog : replacement);
  expect(getByRole(dialog, "alert").textContent).toContain("Second read failed");

  replacement.click();
  await waitFor(() => expect(getByText(dialog, t("Camera").concat(" · ", t("Allowed")))).toBeTruthy());
  expect(dialog.open).toBe(true);
  expect(request.mock.calls).toEqual([[{ type: "list" }], [{ type: "list" }], [{ type: "list" }]]);
});

it("invalidates a settings panel rejected because the native site changed", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce([{ permission: 2, allowed: true }])
    .mockRejectedValueOnce(Error("Site changed. Open site settings again."));
  showSiteSettings({ origin: "https://example.test", request, onClose: vi.fn() });
  const name = revokeName("Camera");
  const revoke = await waitFor(() => getByRole(document.body, "button", { name }));
  revoke.click();
  getByRole(document.body, "button", { name: t("Confirm") }).click();
  await waitFor(() => expect(getByRole(document.body, "alert").textContent).toBe(t("Site changed. Open site settings again.")));
  expect(queryByRole(document.body, "button", { name })).toBeNull();
  expect(getByRole(document.body, "button", { name: t("Clear host cookies") }).closest("fieldset").disabled).toBe(true);
  expect(request.mock.calls).toEqual([[{ type: "list" }], [{ type: "revoke", permission: 2, confirmed: true }]]);
});

it("drops a pending site settings open when its tab starts a new navigation", async () => {
  let resolve;
  const readUrl = vi.fn(() => new Promise(done => { resolve = done; }));
  const { open, navigate, origin, request } = await mountSiteSettings({ readUrl });
  open();
  await waitFor(() => expect(readUrl).toHaveBeenCalledOnce());
  navigate();
  resolve({ url: origin });
  await app.finishWindowWrites();
  expect(queryByRole(document.body, "dialog", { name: t("Site permissions and storage") })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("discards an outstanding confirmation and its actions when the active page navigates", async () => {
  const { open, navigate, request } = await mountSiteSettings();
  open();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  const revoke = await waitFor(() => getByRole(dialog, "button", { name: revokeName("Camera") }));
  revoke.click();
  const confirm = getByRole(dialog, "button", { name: t("Confirm") });
  navigate();
  expect(getByRole(dialog, "alert").textContent).toBe(t("Site changed. Open site settings again."));
  expect(queryByRole(dialog, "button", { name: t("Confirm") })).toBeNull();
  confirm.click();
  expect(request.mock.calls).toEqual([[{ type: "list" }]]);
  expect(document.activeElement.textContent).toBe(t("Close"));
});

it("closes the site settings dialog when leaving the browser", async () => {
  const { open, request } = await mountSiteSettings();
  open();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  const revoke = await waitFor(() => getByRole(dialog, "button", { name: revokeName("Microphone") }));
  revoke.click();
  expect(await app.canDeactivate()).toBe(true);
  expect(dialog.isConnected).toBe(false);
  expect(request.mock.calls).toEqual([[{ type: "list" }]]);
});

it("keeps a late list response from restoring controls for the old site", async () => {
  const { open, navigate, request } = await mountSiteSettings();
  let reply;
  request.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  open();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ type: "list" }));
  navigate();
  reply([{ permission: 2, allowed: true }]);
  await Promise.resolve();
  expect(queryByRole(dialog, "button", { name: revokeName("Camera") })).toBeNull();
  expect(getByRole(dialog, "alert").textContent).toBe(t("Site changed. Open site settings again."));
  expect(getByRole(dialog, "button", { name: t("Clear site storage") }).closest("fieldset").disabled).toBe(true);
});

const block = (tab, permission_kind) => ({ kind: "permissionBlocked", tab: tab.id, permission_kind });
const blockedMessage = (...names) =>
  t("Permissions blocked in this tab · {permissions}").replace("{permissions}", names.map(name => t(name)).join(" · "));

it("keeps permission feedback on the tab that requested it without replacing the current tab's message", async () => {
  const { tab, peer, host, emit } = await mountSiteSettings({ twoTabs: true });
  const chromeStatus = host.querySelector('.browser-footer [role="status"]');
  const switchTo = async title => {
    getByRole(host, "tab", { name: title }).click();
    await app.finishWindowWrites();
  };
  await switchTo(peer.title);
  await switchTo(tab.title);
  emit(block(peer, 2));
  expect(chromeStatus.textContent).toBe("");
  emit(block(tab, 3));
  expect(chromeStatus.textContent).toBe(blockedMessage("Location"));
  await switchTo(peer.title);
  expect(chromeStatus.textContent).toBe(blockedMessage("Camera"));

  emit({ kind: "navigationBlocked", tab: peer.id });
  emit(block(peer, 1));
  expect(chromeStatus.textContent).toBe(t("This browser action is not available yet"));
});

it("lists each blocked permission once, updates the open panel and drops feedback on reload", async () => {
  const { tab, host, open, navigate, request, emit } = await mountSiteSettings();
  emit(block(tab, 2));
  emit(block(tab, 2));
  open();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  expect(getByText(dialog, blockedMessage("Camera"))).toBeTruthy();
  emit(block(tab, 1));
  expect(getByText(dialog, blockedMessage("Microphone", "Camera"))).toBeTruthy();
  emit(block(tab, 999));
  emit(block(tab, 998));
  expect(getByText(dialog, blockedMessage("Other permission", "Microphone", "Camera"))).toBeTruthy();
  const locale = getLocale();
  try {
    setLocale("en");
    expect(getByText(dialog, "Permissions blocked in this tab · Other permission · Microphone · Camera")).toBeTruthy();
    setLocale("zh-CN");
    expect(getByText(dialog, "此标签页已拒绝的权限请求 · 其他权限 · 麦克风 · 摄像头")).toBeTruthy();
  } finally {
    setLocale(locale);
  }
  expect(request.mock.calls).toEqual([[{ type: "list" }]]);

  navigate();
  expect(dialog.textContent).not.toContain(t("Other permission"));
  expect(host.querySelector('.browser-footer [role="status"]').textContent).toBe("");
  getByRole(dialog, "button", { name: t("Close") }).click();
  emit({ kind: "navigationFinished", tab: tab.id, success: true, documentRevision: "reloaded" });
  open();
  const fresh = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  expect(fresh.textContent).not.toContain(t("Other permission"));
});


it("reports a pending site change and returns keyboard focus to the operation on failure", async () => {
  let fail;
  const request = vi.fn(async ({ type }) => type === "list" ? [] : new Promise((_, reject) => { fail = reject; }));
  showSiteSettings({ origin: "https://example.test", request, onClose: vi.fn() });
  const dialog = getByRole(document.body, "dialog", { name: t("Site permissions and storage") });
  const clear = getByRole(dialog, "button", { name: t("Clear site storage") });
  const status = getByRole(dialog, "status");
  await waitFor(() => expect(clear.matches(":disabled")).toBe(false));
  clear.click();
  const confirm = getByRole(dialog, "button", { name: t("Confirm") });
  confirm.click();
  expect(status.textContent).toBe(t("Applying site settings…"));
  expect(clear.matches(":disabled")).toBe(true);
  confirm.click();
  expect(request.mock.calls).toEqual([[{ type: "list" }], [{ type: "clearStorage", confirmed: true }]]);
  fail(new Error("Storage could not be cleared"));
  await waitFor(() => expect(status.textContent).toBe("Storage could not be cleared"));
  expect(document.activeElement).toBe(clear);
  expect(clear.matches(":disabled")).toBe(false);
});

it.each(["change", "readback"])("does not show the old site's success after navigation during %s", async phase => {
  let completeChange, completeReadback;
  const { open, navigate, request } = await mountSiteSettings();
  request.mockResolvedValueOnce([]);
  request.mockImplementationOnce(() => new Promise(done => { completeChange = done; }));
  request.mockImplementationOnce(() => new Promise(done => { completeReadback = done; }));
  open();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: t("Site permissions and storage") }));
  const clear = getByRole(dialog, "button", { name: t("Clear host cookies") });
  const status = getByRole(dialog, "status");
  await waitFor(() => expect(clear.matches(":disabled")).toBe(false));
  clear.click();
  getByRole(dialog, "button", { name: t("Confirm") }).click();

  if (phase === "readback") {
    completeChange(null);
    await waitFor(() => expect(completeReadback).toBeTypeOf("function"));
    expect(status.textContent).toBe(t("Site settings updated"));
  }
  navigate();
  expect(getByRole(dialog, "alert").textContent).toBe(t("Site changed. Open site settings again."));
  if (phase === "change") completeChange(null);
  else completeReadback([]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(status.textContent).toBe("");
  expect(clear.matches(":disabled")).toBe(true);
  expect(document.activeElement.textContent).toBe(t("Close"));
  expect(request).toHaveBeenCalledTimes(phase === "change" ? 2 : 3);
});
