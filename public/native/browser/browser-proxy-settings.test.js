import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import { createBrowserProxySettings } from "./browser-proxy-settings.js";
import { t } from "../../i18n.js";

afterEach(() => document.body.replaceChildren());

function mount(control) {
  const panel = createBrowserProxySettings(control);
  const form = document.createElement("form");
  const submitted = vi.fn(event => event.preventDefault());
  form.addEventListener("submit", submitted);
  form.append(panel);
  document.body.append(form);
  panel.open = true;
  return { panel, submitted, input: panel.querySelector("input"), status: panel.querySelector("[role=status]") };
}

it("shows the active route separately and marks saved changes as pending a full restart", async () => {
  const active = "http://127.0.0.1:8781";
  const saved = "http://proxy.example.org:8181";
  const control = vi.fn(async request => ({ active, saved: request.kind === "getHttpProxy" ? active : request.value }));
  const { panel, input, status, submitted } = mount(control);
  await waitFor(() => expect(input.value).toBe(active));
  expect(panel.textContent).toContain(t("Current browser proxy"));
  expect(status.textContent).toBe(t("Saved proxy is active"));

  input.value = saved;
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(status.textContent).toBe(t("Quit Studio completely, then reopen it to apply the saved proxy.")));
  expect(control).toHaveBeenLastCalledWith({ kind: "setHttpProxy", value: saved });
  expect(panel.textContent).toContain(active);
  expect(input.value).toBe(saved);
  expect(submitted).not.toHaveBeenCalled();

  panel.querySelectorAll("button")[1].click();
  await waitFor(() => expect(input.value).toBe(""));
  expect(control).toHaveBeenLastCalledWith({ kind: "setHttpProxy", value: null });
  expect(status.textContent).toBe(t("Quit Studio completely, then reopen it to apply the saved proxy."));
  expect(panel.textContent).toContain(active);
});

it("keeps the active setting and typed address after the Host rejects a proxy", async () => {
  const control = vi.fn(async request => {
    if (request.kind === "setHttpProxy") throw Error("Rejected");
    return { active: null, saved: null };
  });
  const { panel, input, status } = mount(control);
  await waitFor(() => expect(status.textContent).toBe(t("Saved proxy is active")));
  expect(panel.textContent).toContain(t("System proxy"));
  input.value = "http://user:pass@proxy.example.org:8181";
  panel.querySelector("button").click();
  await waitFor(() => expect(status.textContent).toBe("Rejected"));
  expect(input.value).toContain("@");
  expect(panel.textContent).toContain(t("System proxy"));
  expect(input.disabled).toBe(false);
});
