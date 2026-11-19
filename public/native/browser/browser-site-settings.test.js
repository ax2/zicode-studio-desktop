import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { showSiteSettings } from "./browser-site-settings.js";

const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => { Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable:true, value() { this.open = true; }}); });
afterEach(() => {
  document.body.replaceChildren();
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
  const click = name => getByRole(document.body, "button", {name: t(name)}).click();
  await waitFor(() => expect(getByRole(document.body, "button", {name: t("Revoke permission")})).toBeTruthy());
  click(label);
  expect(document.activeElement.textContent).toBe(t("Cancel"));
  click("Cancel");
  expect(request.mock.calls).toEqual([[{type:"list"}]]);
  click(label); click("Confirm");
  await waitFor(() => expect(getByRole(document.body, "status").textContent).toBe(t("Site settings updated")));
  expect(request.mock.calls).toEqual([[{type:"list"}],[{...action, confirmed:true}],[{type:"list"}]]);
});
