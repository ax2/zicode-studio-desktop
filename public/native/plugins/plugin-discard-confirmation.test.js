import { afterEach, expect, it, vi } from "vitest";
import { confirmPluginDiscard } from "./plugin-discard-confirmation.js";
afterEach(() => document.body.replaceChildren());
it("uses the application confirmation and only accepts explicit true", async () => {
  document.body.innerHTML = '<div id="dialog-container" class="hidden"></div>';
  const dialog = vi.fn(async () => ({ confirmed: true }));
  expect(await confirmPluginDiscard("Discard?", dialog)).toBe(true);
  expect(dialog).toHaveBeenCalledWith({ method: "confirm", title: "Discard?" }, document.getElementById("dialog-container"));
  for (const response of [{ cancelled: true }, { confirmed: false }, { confirmed: "true" }, undefined]) {
    dialog.mockResolvedValueOnce(response);
    expect(await confirmPluginDiscard("Discard?", dialog)).toBe(false);
  }
});
it("preserves active dialogs and cancels when the dialog surface is unavailable", async () => {
  const dialog = vi.fn();
  expect(await confirmPluginDiscard("Discard?", dialog)).toBe(false);
  document.body.innerHTML = '<div id="dialog-container">existing conversation prompt</div>';
  expect(await confirmPluginDiscard("Discard?", dialog)).toBe(false);
  expect(dialog).not.toHaveBeenCalled();
  expect(document.body.textContent).toBe("existing conversation prompt");
});
