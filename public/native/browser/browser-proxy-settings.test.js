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

it("leaves candidate Enter with the input method before saving or clearing a proxy", async () => {
  const active = "http://127.0.0.1:8781";
  const draft = "http://draft.example.test:8080";
  const control = vi.fn(async request => ({ active, saved: request.kind === "getHttpProxy" ? active : request.value }));
  const { panel, input, submitted } = mount(control);
  await waitFor(() => expect(input.value).toBe(active));
  const press = (options = {}) => input.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, cancelable: true, ...options,
  }));
  input.focus();
  input.dispatchEvent(new CompositionEvent("compositionstart"));
  fireEvent.input(input, { target: { value: "" } });
  expect(press()).toBe(true);
  expect(control.mock.calls).toEqual([[{ kind: "getHttpProxy" }]]);

  input.dispatchEvent(new CompositionEvent("compositionend"));
  fireEvent.input(input, { target: { value: draft } });
  expect(press({ keyCode: 229 })).toBe(true);
  expect(press({ isComposing: true })).toBe(true);
  expect(control.mock.calls).toEqual([[{ kind: "getHttpProxy" }]]);
  expect(document.activeElement).toBe(input);

  input.dispatchEvent(new CompositionEvent("compositionstart"));
  panel.querySelector("summary").focus();
  input.focus();
  expect(press()).toBe(false);
  await waitFor(() => expect(control).toHaveBeenLastCalledWith({ kind: "setHttpProxy", value: draft }));
  expect(control).toHaveBeenCalledTimes(2);
  expect(input.value).toBe(draft);
  expect(submitted).not.toHaveBeenCalled();
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

function toggleSection(panel, open) {
  return new Promise(resolve => {
    panel.addEventListener("toggle", resolve, { once: true });
    panel.open = open;
  });
}

it("keeps an unsaved address across expansion while refreshing the saved proxy state", async () => {
  const active = "http://127.0.0.1:8781";
  const nextSaved = "http://saved.example.org:8181";
  const draft = "http://draft.example.org:8888";
  const control = vi.fn()
    .mockResolvedValueOnce({ active, saved: active })
    .mockResolvedValueOnce({ active, saved: nextSaved })
    .mockResolvedValueOnce({ active, saved: draft });
  const { panel, input, status } = mount(control);
  await waitFor(() => expect(input.value).toBe(active));
  fireEvent.input(input, { target: { value: draft } });

  await toggleSection(panel, false);
  await toggleSection(panel, true);
  await waitFor(() => expect(status.textContent).toBe(t("Quit Studio completely, then reopen it to apply the saved proxy.")));
  expect(input.value).toBe(draft);
  expect(panel.textContent).toContain(active);
  const edit = panel.querySelector('[data-i18n-text="Proxy address has unsaved changes."]');
  expect(edit.hidden).toBe(false);
  expect(control.mock.calls).toEqual([
    [{ kind: "getHttpProxy" }],
    [{ kind: "getHttpProxy" }],
  ]);

  panel.querySelector("button").click();
  await waitFor(() => expect(edit.hidden).toBe(true));
  expect(control).toHaveBeenLastCalledWith({ kind: "setHttpProxy", value: draft });
  expect(input.value).toBe(draft);
});

it("keeps a draft and blocks writes after a refresh fails until the settings are read again", async () => {
  const old = "http://old.example.org:8181";
  const draft = "http://draft.example.org:8781";
  const control = vi.fn()
    .mockResolvedValueOnce({ active: null, saved: old })
    .mockRejectedValueOnce(Error("Unavailable"))
    .mockResolvedValueOnce({ active: null, saved: old });
  const { panel, input, status } = mount(control);
  await waitFor(() => expect(input.value).toBe(old));
  fireEvent.input(input, { target: { value: draft } });

  await toggleSection(panel, false);
  await toggleSection(panel, true);
  await waitFor(() => expect(status.textContent).toBe(t("Unavailable")));
  const [save, reset] = panel.querySelectorAll("button");
  expect(input.value).toBe(draft);
  expect(input.disabled).toBe(true);
  expect(save.disabled).toBe(true);
  expect(reset.disabled).toBe(true);
  save.click();
  reset.click();
  expect(control).toHaveBeenCalledTimes(2);

  await toggleSection(panel, false);
  await toggleSection(panel, true);
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.value).toBe(draft);
  expect(control.mock.calls.map(([request]) => request.kind)).toEqual([
    "getHttpProxy", "getHttpProxy", "getHttpProxy",
  ]);
});
