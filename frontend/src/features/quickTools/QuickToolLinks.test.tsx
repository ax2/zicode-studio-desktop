import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QuickToolLinks } from "./QuickToolLinks";

afterEach(cleanup);
async function menu() {
  const view = render(<><QuickToolLinks compact /><button type="button" data-outside>Outside</button></>);
  await act(async () => window.dispatchEvent(new CustomEvent("zicode:quick-tools-changed", {
    detail: { items: [{ id: "one", title: "One" }, { id: "two", title: "Two" }] },
  })));
  const details = view.container.querySelector("details") as HTMLDetailsElement;
  const summary = details.querySelector("summary") as HTMLElement;
  const buttons = [...details.querySelectorAll("button")];
  return { view, details, summary, buttons, outside: view.container.querySelector("[data-outside]") as HTMLButtonElement };
}

it("opens with arrows, navigates through actions, and restores focus with Escape", async () => {
  const { details, summary, buttons } = await menu();
  summary.focus(); fireEvent.keyDown(summary, { key: "ArrowDown" });
  expect(details.open).toBe(true); expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0], { key: "ArrowUp" }); expect(document.activeElement).toBe(buttons.at(-1));
  fireEvent.keyDown(buttons.at(-1) as HTMLButtonElement, { key: "Home" }); expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0], { key: "End" }); expect(document.activeElement).toBe(buttons.at(-1));
  const prevented = !fireEvent.keyDown(buttons.at(-1) as HTMLButtonElement, { key: "Escape" });
  expect(prevented).toBe(true); expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
});

it("dismisses on outside pointers and focus departure without stealing focus", async () => {
  const { details, summary, buttons, outside } = await menu();
  details.open = true; buttons[0].focus();
  fireEvent.pointerDown(outside); outside.focus();
  expect(details.open).toBe(false); expect(document.activeElement).toBe(outside);
  details.open = true; summary.focus(); outside.focus();
  expect(details.open).toBe(false); expect(document.activeElement).toBe(outside);
});

it("keeps composition keys untouched and closes when the target changes", async () => {
  const { details, buttons, summary } = await menu();
  details.open = true; buttons[0].focus();
  fireEvent.keyDown(buttons[0], { key: "Escape", isComposing: true });
  expect(details.open).toBe(true);
  window.dispatchEvent(new Event("zicode:tool-target-changed"));
  expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
});

it("closes after selecting a shortcut or management without changing inline Home behavior", async () => {
  const { details, buttons, summary, view } = await menu();
  details.open = true; buttons[0].focus(); fireEvent.click(buttons[0]);
  expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
  view.rerender(<QuickToolLinks />);
  expect(view.container.querySelector("details")).toBeNull();
});
