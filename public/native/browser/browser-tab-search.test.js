import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { showBrowserTabSearch } from "./browser-tab-search.js";
import { t } from "../../i18n.js";

const descriptors = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
afterEach(() => {
  document.body.replaceChildren();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else delete HTMLDialogElement.prototype[name];
  }
});

function mockDialog() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  } });
}

it("filters across title and address and switches by the exact tab identity", async () => {
  mockDialog();
  const onSelect = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
  const dialog = showBrowserTabSearch({
    getTabs: () => [
      { id: "first", title: "文档", url: "https://alpha.example.org/" },
      { id: "second", title: "文档", url: "https://beta.example.org/" },
    ],
    getActive: () => "first", getIcon: () => undefined, onSelect, onClose,
  });
  const input = getByRole(dialog, "searchbox");
  expect(document.activeElement).toBe(input);
  expect(dialog.querySelector("[aria-current]")?.title).toBe("https://alpha.example.org/");
  fireEvent.input(input, { target: { value: "absent" } });
  expect(getByRole(dialog, "status").textContent).toBe(t("No matching tabs"));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.input(input, { target: { value: "文档 BETA" } });
  const target = dialog.querySelector(".browser-tab-search-result");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(target);
  fireEvent.keyDown(target, { key: "ArrowUp" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("second"));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("second");
});

it.each(["Enter", "ArrowDown", "ArrowUp"])("leaves the IME's trailing %s at the search input", async key => {
  mockDialog();
  const onSelect = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const dialog = showBrowserTabSearch({
    getTabs: () => [
      { id: "first", title: "简介", url: "https://example.test/overview" },
      { id: "second", title: "测试参考", url: "https://example.test/reference" },
    ],
    getActive: () => "first", getIcon: () => undefined, onSelect, onClose,
  });
  const input = getByRole(dialog, "searchbox");
  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: "测试" } });
  fireEvent.compositionEnd(input);
  const phase = { key, keyCode: 229, isComposing: false };
  expect(fireEvent.keyDown(input, phase)).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);

  const match = dialog.querySelector(".browser-tab-search-result");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(match);
  fireEvent.keyDown(match, { key: "ArrowUp" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("second"));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("second");
});

it("removes a closed result without selecting another tab or losing the query", async () => {
  mockDialog();
  const popup = { id: "popup", title: "Reference popup", url: "https://example.test/popup" };
  const guide = { id: "guide", title: "Reference guide", url: "https://example.test/guide" };
  let tabs = [popup, guide];
  const onSelect = vi.fn().mockRejectedValueOnce(new Error("Browser tab is no longer available")).mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  const dialog = showBrowserTabSearch({ getTabs: () => tabs, getActive: () => "source", getIcon: () => undefined, onSelect, onClose });
  const input = getByRole(dialog, "searchbox");
  fireEvent.input(input, { target: { value: "Reference" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const closedResult = document.activeElement;
  expect(closedResult.title).toBe(popup.url);

  tabs = [guide];
  fireEvent.click(closedResult);
  await waitFor(() => expect(getByRole(dialog, "status").textContent).toBe(t("Browser tab is no longer available")));
  expect(input.value).toBe("Reference");
  expect(document.activeElement).toBe(input);
  expect([...dialog.querySelectorAll(".browser-tab-search-result")].map(button => button.title)).toEqual([guide.url]);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("popup");
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith("guide"));
  expect(onSelect.mock.calls).toEqual([["popup"], ["guide"]]);
});
