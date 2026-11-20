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

it("filters across title and address and switches by the exact tab identity", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  } });
  const onSelect = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
  const dialog = showBrowserTabSearch({
    tabs: [
      { id: "first", title: "文档", url: "https://alpha.example.org/" },
      { id: "second", title: "文档", url: "https://beta.example.org/" },
    ],
    active: "first", getIcon: () => undefined, onSelect, onClose,
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
