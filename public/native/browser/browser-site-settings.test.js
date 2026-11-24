import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getByRole, getByText, queryByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { showSiteSettings } from "./browser-site-settings.js";
import { setupBrowserApp } from "./browser-app.js";

const revokeName = permission => `${t("Revoke permission")} · ${t(permission)}`;
const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
let app;
beforeEach(() => { Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable:true, value() { this.open = true; }}); });
afterEach(async () => {
  await app?.canDeactivate();
  app = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
  else delete HTMLDialogElement.prototype.showModal;
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

it("shows the exact site and permission before one explicit revocation", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 900, height: 600 });
  const origin = "https://example.test:8443";
  const tab = { id: "permission-tab", url: "https://previous.test/", title: "Previous page" };
  const request = vi.fn(async action => action.type === "list" ? [
    { permission: 1, allowed: true },
    { permission: 2, allowed: true },
    { permission: 3, allowed: false },
  ] : null);
  const nativeControls = [];
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: tab.id, tabs: [tab] } };
    const control = args?.request;
    if (control?.kind === "status") return { surfaceRevision: 0, tabs: [tab] };
    if (control?.kind === "url") return { url: `${origin}/site` };
    if (control?.kind === "snapshot") return "data:image/jpeg;base64,AA==";
    if (control?.kind === "siteSettings") { nativeControls.push(control); return request(control.action); }
    return {};
  });
  const host = document.createElement("main");
  document.body.append(host);
  app = setupBrowserApp({ invoke });
  app.renderContent(host);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_control", { request: expect.objectContaining({ kind: "present" }) }));
  const menu = host.querySelector(".browser-options");
  menu.open = true;
  getByRole(menu, "button", { name: t("Site permissions and storage") }).click();
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

it("reports a failed revocation without saying the permission was changed", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce([{ permission: 2, allowed: true }])
    .mockRejectedValueOnce(Error("Site changed. Open site settings again."));
  showSiteSettings({ origin: "https://example.test", request, onClose: vi.fn() });
  const name = revokeName("Camera");
  const revoke = await waitFor(() => getByRole(document.body, "button", { name }));
  revoke.click();
  getByRole(document.body, "button", { name: t("Confirm") }).click();
  await waitFor(() => expect(getByRole(document.body, "status").textContent).toBe(t("Site changed. Open site settings again.")));
  expect(getByRole(document.body, "button", { name }).disabled).toBe(false);
  expect(request.mock.calls).toEqual([[{ type: "list" }], [{ type: "revoke", permission: 2, confirmed: true }]]);
});
