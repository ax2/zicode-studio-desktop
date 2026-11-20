import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { showBrowserTabGroup } from "./browser-tab-group-dialog.js";

const dialogMethods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
afterEach(() => {
  document.body.replaceChildren();
  for (const [key, descriptor] of dialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else delete HTMLDialogElement.prototype[key];
  }
});

it("keeps the editor and input after a failed save, and renames the existing identity", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
  const tab = { id: "tab", group: { id: crypto.randomUUID(), name: "Old" } };
  const save = vi.fn().mockRejectedValueOnce(new Error("Write failed")).mockResolvedValueOnce(undefined);
  const close = vi.fn();
  const dialog = showBrowserTabGroup({ tab, tabs: [tab], onSave: save, onClose: close });
  const name = getByRole(dialog, "textbox");
  expect(name.value).toBe("Old");
  fireEvent.input(name, { target: {value:" 新名字 "} });
  fireEvent.submit(name.form);
  await waitFor(() => expect(getByRole(dialog, "alert").textContent).toBe("Write failed"));
  expect(close).not.toHaveBeenCalled();
  fireEvent.submit(name.form);
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith({ id:tab.group.id, name:"新名字" });
});
