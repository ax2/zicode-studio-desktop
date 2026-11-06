import { afterEach, expect, it, vi } from "vitest";
import { getByRole } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { createBrowserFind } from "./browser-find.js";
let find;
afterEach(async () => { if (find) await find.destroy(); find = null; vi.useRealTimers(); document.body.replaceChildren(); });
function setup(control, getTab = () => ({ id: "a" }), available = () => true) {
  vi.useFakeTimers(); find = createBrowserFind({ control, getTab, available }); document.body.append(find.element); find.open();
  return { input: getByRole(find.element, "searchbox"), button: name => getByRole(find.element, "button", { name: t(name) }), counter: getByRole(find.element, "status") };
}
async function type(input, value) { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); await vi.advanceTimersByTimeAsync(150); }
it("finds through the native boundary, reports counts, advances and stops without storing queries", async () => {
  let active = 1; const control = vi.fn(async request => { if (request.kind === "findStatus") return { count: 3, active }; if (request.kind === "findStep") active += request.backward ? -1 : 1; });
  const ui = setup(control); await type(ui.input, "domain"); expect(control).toHaveBeenCalledWith({ kind: "findStart", tab: "a", text: "domain", caseSensitive: false }); expect(ui.counter.textContent).toBe("1 / 3");
  ui.button("Next match").click(); await vi.advanceTimersByTimeAsync(0); expect(ui.counter.textContent).toBe("2 / 3");
  ui.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); await vi.advanceTimersByTimeAsync(0); expect(ui.counter.textContent).toBe("1 / 3");
  ui.button("Match case").click(); await vi.advanceTimersByTimeAsync(150); expect(control).toHaveBeenCalledWith({ kind: "findStart", tab: "a", text: "domain", caseSensitive: true });
  await find.close(); const calls = control.mock.calls.length; await vi.advanceTimersByTimeAsync(2000); expect(control.mock.calls.length).toBe(calls); expect(find.element.hidden).toBe(true); expect(control).toHaveBeenLastCalledWith({ kind: "findStop", tab: "a" });
});
it("clears search and disables unmatched navigation, with readable native errors and retry", async () => {
  const control = vi.fn(async request => request.kind === "findStatus" ? { active: 0, count: 0 } : undefined); const ui = setup(control);
  await type(ui.input, "missing"); expect(ui.counter.textContent).toBe(t("No matches")); expect(ui.button("Next match").disabled).toBe(true);
  control.mockRejectedValueOnce(Error("Search unavailable")); await type(ui.input, "try"); expect(ui.counter.textContent).toBe("Search unavailable");
  await type(ui.input, ""); expect(ui.counter.textContent).toBe(""); expect(control).toHaveBeenLastCalledWith({ kind: "findStop", tab: "a" });
  await type(ui.input, "again"); expect(ui.counter.textContent).toBe(t("No matches"));
});
it("serializes pending native work, discards late results and stops the old tab on close", async () => {
  let resolve, id = "a"; const control = vi.fn(request => request.kind === "findStart" ? new Promise(done => { resolve = done; }) : Promise.resolve({ count: 9, active: 4 }));
  const ui = setup(control, () => ({ id })); await type(ui.input, "old"); await type(ui.input, "superseded"); const closed = find.close(); id = "b"; resolve(); await closed;
  expect(control.mock.calls.map(([r]) => r.kind)).toEqual(["findStart", "findStop"]); expect(find.element.hidden).toBe(true); expect(ui.counter.textContent).not.toBe("4 / 9");
  find.open(); expect(ui.input.value).toBe(""); expect(find.element.hidden).toBe(false);
});
it("debounces composition, supports Ctrl+F and Escape, and respects inactive or modal surfaces", async () => {
  let available = true; const control = vi.fn(async request => request.kind === "findStatus" ? { count: 1, active: 1 } : undefined); const ui = setup(control, () => ({ id: "a" }), () => available);
  ui.input.value = "中"; ui.input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); await vi.advanceTimersByTimeAsync(200); expect(control).not.toHaveBeenCalled();
  ui.input.dispatchEvent(new CompositionEvent("compositionend")); await vi.advanceTimersByTimeAsync(150); expect(ui.counter.textContent).toBe("1 / 1");
  ui.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await vi.advanceTimersByTimeAsync(0); expect(find.element.hidden).toBe(true);
  available = false; document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true })); expect(find.element.hidden).toBe(true);
  available = true; const key = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }); document.dispatchEvent(key); expect(key.defaultPrevented).toBe(true); expect(document.activeElement).toBe(ui.input);
});

it("restores native page focus only after manual dismissal completes", async () => {
  const restoreFocus = vi.fn(async () => {}), control = vi.fn(async () => {});
  vi.useFakeTimers(); find = createBrowserFind({ control, getTab: () => ({ id: "a" }), available: () => true, restoreFocus }); document.body.append(find.element); find.open();
  getByRole(find.element, "searchbox").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await vi.advanceTimersByTimeAsync(0); expect(restoreFocus).toHaveBeenCalledWith("a");
  expect(control.mock.invocationCallOrder.at(-1)).toBeLessThan(restoreFocus.mock.invocationCallOrder[0]);
  restoreFocus.mockClear(); find.open(); await find.close(); expect(restoreFocus).not.toHaveBeenCalled();
});
it.each(["reopened", "tab changed", "blocked"])("never steals focus after a delayed dismiss when %s", async state => {
  let finish, id = "a", available = true;
  const restoreFocus = vi.fn(async () => {}), control = vi.fn(() => new Promise(done => { finish = done; }));
  vi.useFakeTimers(); find = createBrowserFind({ control, getTab: () => ({ id }), available: () => available, restoreFocus }); document.body.append(find.element); find.open();
  getByRole(find.element, "button", { name: t("Close page search") }).click(); await vi.advanceTimersByTimeAsync(0);
  if (state === "reopened") find.open(); else if (state === "tab changed") id = "b"; else available = false;
  finish(); await vi.advanceTimersByTimeAsync(0); expect(restoreFocus).not.toHaveBeenCalled();
  control.mockResolvedValue(undefined);
});

