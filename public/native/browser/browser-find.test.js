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
it("keeps native Enter activation on find toolbar buttons and steps only from the search input", async () => {
  const control = vi.fn(async request => request.kind === "findStatus" ? { count: 3, active: 2 } : undefined);
  const ui = setup(control);
  await type(ui.input, "match");
  const press = (element, shiftKey = false) => {
    element.focus();
    return element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true }));
  };

  for (const name of ["Match case", "Previous match", "Next match", "Close page search"]) {
    expect(press(ui.button(name))).toBe(true);
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(control.mock.calls.some(([request]) => request.kind === "findStep")).toBe(false);

  expect(press(ui.input)).toBe(false);
  expect(press(ui.input, true)).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(control.mock.calls.map(([request]) => request).filter(request => request.kind === "findStep")).toEqual([
    { kind: "findStep", tab: "a", backward: false },
    { kind: "findStep", tab: "a", backward: true },
  ]);
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

it("keeps IME candidate keys out of native page find and searches the committed query once", async () => {
  const control = vi.fn(async request => request.kind === "findStatus" ? { count: 3, active: 1 } : undefined);
  const ui = setup(control);
  await type(ui.input, "previous");
  const keys = () => control.mock.calls.map(([request]) => request.kind).filter(kind => kind !== "findStatus");
  const press = (key, options = {}) => ui.input.dispatchEvent(new KeyboardEvent("keydown", {
    key, bubbles: true, cancelable: true, ...options,
  }));

  ui.input.dispatchEvent(new CompositionEvent("compositionstart"));
  ui.input.value = "zhong";
  ui.input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(press("Enter")).toBe(true);
  expect(press("Escape")).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  expect(keys()).toEqual(["findStart"]);

  ui.input.value = "中文";
  ui.input.dispatchEvent(new CompositionEvent("compositionend"));
  ui.input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(press("Enter", { keyCode: 229 })).toBe(true);
  expect(press("Escape", { keyCode: 229 })).toBe(true);
  expect(press("f", { ctrlKey: true, keyCode: 229 })).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  expect(keys()).toEqual(["findStart", "findStart"]);
  expect(control).toHaveBeenCalledWith({ kind: "findStart", tab: "a", text: "中文", caseSensitive: false });
  expect(document.activeElement).toBe(ui.input);
  expect(find.element.hidden).toBe(false);

  expect(press("Enter")).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(keys().at(-1)).toBe("findStep");
  expect(press("Escape")).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(keys().at(-1)).toBe("findStop");
  expect(find.element.hidden).toBe(true);
});

it("shows PDF matches and zero results without offering directional stepping", async () => {
  let matches = { active: 1, count: 3 };
  const control = vi.fn(async request => request.kind === "findStatus" ? matches : undefined);
  vi.useFakeTimers();
  find = createBrowserFind({ control, getTab: () => ({ id: "pdf" }), available: () => true, isPdf: id => id === "pdf" });
  document.body.append(find.element);
  find.open();
  const input = getByRole(find.element, "searchbox");
  const counter = getByRole(find.element, "status");
  await type(input, "Studio reader fixture text");
  expect(control).toHaveBeenCalledWith({ kind: "findStart", tab: "pdf", text: "Studio reader fixture text", caseSensitive: false });
  expect(counter.textContent).toBe(`1 / 3 · ${t("First PDF match")}`);
  for (const name of ["Previous match", "Next match"]) {
    const button = find.element.querySelector(`[aria-label="${t(name)}"]`);
    expect(button.hidden).toBe(true);
    expect(button.disabled).toBe(true);
    button.click();
  }
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(control.mock.calls.some(([request]) => request.kind === "findStep")).toBe(false);
  matches = { active: 0, count: 0 };
  await type(input, "Missing synthetic PDF phrase");
  expect(counter.textContent).toBe(t("No matches"));
  await find.close();
  expect(control).toHaveBeenLastCalledWith({ kind: "findStop", tab: "pdf" });
});

it("returns focus from a removed stepping button when the current document is identified as PDF", async () => {
  let pdf = false;
  const control = vi.fn(async request => request.kind === "findStatus" ? { active: 1, count: 2 } : undefined);
  vi.useFakeTimers();
  find = createBrowserFind({ control, getTab: () => ({ id: "a" }), available: () => true, isPdf: () => pdf });
  document.body.append(find.element);
  find.open();
  const input = getByRole(find.element, "searchbox");
  await type(input, "Text before classification");
  const next = getByRole(find.element, "button", { name: t("Next match") });
  next.focus();
  expect(document.activeElement).toBe(next);
  pdf = true;
  find.refreshMatchControls();
  expect(next.hidden).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Text before classification");
  expect(getByRole(find.element, "status").textContent).toBe(`1 / 2 · ${t("First PDF match")}`);
  expect(control.mock.calls.filter(([request]) => request.kind === "findStart")).toHaveLength(1);
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

it("keeps a failed direction available for a manual retry without restarting the query", async () => {
  let active = 1, rejectStep = true;
  const control = vi.fn(async request => {
    if (request.kind === "findStatus") return { count: 3, active };
    if (request.kind === "findStep") {
      if (rejectStep) { rejectStep = false; throw Error("Direction unavailable"); }
      active += request.backward ? -1 : 1;
    }
  });
  const ui = setup(control);
  await type(ui.input, "unchanged");
  ui.button("Next match").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(ui.counter.textContent).toBe("Direction unavailable");
  expect(ui.button("Previous match").disabled).toBe(false);
  expect(ui.button("Next match").disabled).toBe(false);
  ui.button("Next match").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(ui.counter.textContent).toBe("2 / 3");
  expect(ui.input.value).toBe("unchanged");
  expect(control.mock.calls.filter(([request]) => request.kind === "findStart")).toHaveLength(1);
});

it.each(["poll", "after step"])("recovers a status error %s without replaying a direction", async source => {
  let active = 1, count = 3, rejectStatus = false;
  const control = vi.fn(async request => {
    if (request.kind === "findStep") {
      active++;
      rejectStatus = true;
    }
    if (request.kind === "findStatus") {
      if (rejectStatus) { rejectStatus = false; throw Error("Status unavailable"); }
      return { count, active };
    }
  });
  const ui = setup(control);
  await type(ui.input, "same");
  if (source === "poll") {
    rejectStatus = true;
    await vi.advanceTimersByTimeAsync(350);
  } else {
    ui.button("Next match").click();
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(ui.counter.textContent).toBe("Status unavailable");
  expect(ui.button("Next match").disabled).toBe(false);
  find.refreshMatchControls();
  expect(ui.counter.textContent).toBe("Status unavailable");
  await vi.advanceTimersByTimeAsync(350);
  expect(ui.counter.textContent).toBe(source === "poll" ? "1 / 3" : "2 / 3");
  expect(control.mock.calls.map(([request]) => request).filter(request => request.kind === "findStep"))
    .toHaveLength(source === "poll" ? 0 : 1);

  count = active = 0;
  await vi.advanceTimersByTimeAsync(350);
  expect(ui.counter.textContent).toBe(t("No matches"));
  expect(ui.button("Next match").disabled).toBe(true);
  expect(ui.button("Previous match").disabled).toBe(true);
  const calls = control.mock.calls.length;
  ui.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(control.mock.calls).toHaveLength(calls);
});

it("polls the first status only after native start accepted the current query", async () => {
  let rejectStatus = true;
  const control = vi.fn(async request => {
    if (request.kind === "findStart" && request.text === "cannot start") throw Error("Start unavailable");
    if (request.kind === "findStatus") {
      if (rejectStatus) { rejectStatus = false; throw Error("First status unavailable"); }
      return { count: 1, active: 1 };
    }
  });
  const ui = setup(control);
  await type(ui.input, "cannot start");
  expect(ui.counter.textContent).toBe("Start unavailable");
  await vi.advanceTimersByTimeAsync(700);
  expect(control.mock.calls.map(([request]) => request.kind)).toEqual(["findStart"]);
  await type(ui.input, "accepted");
  expect(ui.counter.textContent).toBe("First status unavailable");
  expect(ui.button("Next match").disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(350);
  expect(ui.counter.textContent).toBe("1 / 1");
});

it("ignores a late status failure after the tab or document search is closed", async () => {
  let rejectPoll, deferred = false, tab = "a";
  const control = vi.fn(async request => {
    if (request.kind === "findStatus") {
      if (deferred && request.tab === "a") return new Promise((_, reject) => { rejectPoll = reject; });
      return request.tab === "a" ? { count: 9, active: 2 } : { count: 1, active: 1 };
    }
  });
  const ui = setup(control, () => ({ id: tab }));
  await type(ui.input, "old");
  deferred = true;
  await vi.advanceTimersByTimeAsync(350);
  expect(rejectPoll).toBeTypeOf("function");
  const closing = find.close({ stopNative: false });
  tab = "b";
  find.open();
  await closing;
  rejectPoll(Error("Late old document status"));
  await type(ui.input, "new");
  expect(ui.counter.textContent).toBe("1 / 1");
  await vi.advanceTimersByTimeAsync(700);
  expect(control.mock.calls.filter(([request]) => request.kind === "findStatus" && request.tab === "a")).toHaveLength(2);
});
